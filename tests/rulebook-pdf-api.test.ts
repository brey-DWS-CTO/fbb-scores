import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawRulebook from '../src/data/source/rulebook-2027.json' with { type: 'json' };
import type { Rulebook } from '../src/lib/league/rulebook.ts';
import { rulebookFingerprint } from '../src/lib/league/rulebookDiff.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const seed = rawRulebook as unknown as Rulebook;
const SEASON = seed.season;

const commissioner = 'Brey';
const pins: Record<string, string> = { Brey: '9000', Joel: '1000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

/** Fetch a PDF and hand back its status, headers, and bytes. */
async function pdf(pathname: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    disposition: response.headers.get('content-disposition') ?? '',
    bytes,
    text: bytes.toString('latin1'),
  };
}

const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';

async function publishRevision(marker: string): Promise<string> {
  const book = structuredClone(seed);
  book.articles[0].title = `League Format (${marker})`;
  const current = await store.getRulebookDraft(SEASON);
  const saved = await fetch(`${baseUrl}/api/league/rulebook/draft`, {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ book, expectedVersion: current?.version ?? 0 }),
  });
  assert.equal(saved.status, 200);
  const published = await fetch(`${baseUrl}/api/league/rulebook/publish`, {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: rulebookFingerprint(book), notes: `Revision for ${marker}` }),
  });
  assert.equal(published.status, 200);
  return String(((await published.json()) as { versionId: string }).versionId);
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'rulebook-pdf-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, storeModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
  ]);
  store = storeModule;
  for (const [owner, pin] of Object.entries(pins)) await store.setPin(owner, pin);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('before anything is published the PDF is the seed, marked as a draft, and public', async () => {
  const result = await pdf('/api/league/rulebook/pdf');
  assert.equal(result.status, 200);
  assert.match(result.type, /^application\/pdf/);
  assert.ok(isPdf(result.bytes), 'starts with the PDF magic');
  assert.match(result.disposition, /inline; filename="The Nerds Constitution 2027 rev 14\.pdf"/);
});

test('a member copy is named for them, and a stranger gets nobody', async () => {
  const joel = await pdf('/api/league/rulebook/pdf?for=Joel');
  assert.equal(joel.status, 200);
  assert.match(joel.disposition, /rev 14 - Joel Weigle\.pdf/);

  const nobody = await pdf('/api/league/rulebook/pdf?for=Mallory');
  assert.equal(nobody.status, 200);
  assert.match(nobody.disposition, /rev 14\.pdf"/, 'an unknown name is simply dropped');
});

test('the draft PDF needs the commissioner', async () => {
  const anonymous = await pdf('/api/league/rulebook/draft/pdf');
  assert.equal(anonymous.status, 401);
  const member = await pdf('/api/league/rulebook/draft/pdf', auth('Joel'));
  assert.equal(member.status, 403);
  const commish = await pdf('/api/league/rulebook/draft/pdf', auth(commissioner));
  assert.equal(commish.status, 200);
  assert.ok(isPdf(commish.bytes));
});

test('a published revision prints as itself and a past one prints as superseded', async () => {
  const first = await publishRevision('first');
  const latest = await pdf('/api/league/rulebook/pdf');
  assert.equal(latest.status, 200);
  assert.match(latest.disposition, /rev 14\.pdf/, 'the first publish is revision 14');

  const second = await publishRevision('second');
  const current = await pdf('/api/league/rulebook/pdf');
  assert.match(current.disposition, /rev 15\.pdf/);

  const old = await pdf(`/api/league/rulebook/pdf?rev=${encodeURIComponent(first)}`);
  assert.equal(old.status, 200);
  assert.match(old.disposition, /rev 14\.pdf/);
  assert.notEqual(second, first);

  const missing = await pdf('/api/league/rulebook/pdf?rev=rb-nope');
  assert.equal(missing.status, 404);
});

test('the book still renders once a signature lands on it', async () => {
  const versions = (await (await fetch(`${baseUrl}/api/league/rulebook/versions`)).json()) as Array<{
    id: string;
    fingerprint: string;
  }>;
  const current = versions[0];
  const signed = await fetch(`${baseUrl}/api/league/rulebook/sign`, {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({ versionId: current.id, fingerprint: current.fingerprint }),
  });
  assert.equal(signed.status, 200);

  const result = await pdf('/api/league/rulebook/pdf?for=Joel');
  assert.equal(result.status, 200);
  assert.ok(isPdf(result.bytes));
});
