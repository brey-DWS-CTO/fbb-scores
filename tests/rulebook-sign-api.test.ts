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
import { ACKNOWLEDGEMENT, type RulebookSignature } from '../src/lib/league/rulebookSignatures.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const seed = rawRulebook as unknown as Rulebook;
const SEASON = seed.season;

const commissioner = 'Brey';
const pins: Record<string, string> = { Brey: '9000', Joel: '1000', Amy: '2000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() };
}

const asRecord = (body: unknown) => body as Record<string, unknown>;

/** A draft that differs from whatever is published right now. */
function uniqueBook(marker: string): Rulebook {
  const book = structuredClone(seed);
  book.articles[0].title = `League Format (${marker})`;
  return book;
}

/** Save and publish a fresh revision, returning its id and fingerprint. */
async function publishRevision(marker: string): Promise<{ versionId: string; fingerprint: string }> {
  const book = uniqueBook(marker);
  const current = await store.getRulebookDraft(SEASON);
  const saved = await request('/api/league/rulebook/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ book, expectedVersion: current?.version ?? 0 }),
  });
  assert.equal(saved.status, 200);

  const fingerprint = rulebookFingerprint(book);
  const published = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint, notes: `Revision for ${marker}` }),
  });
  assert.equal(published.status, 200);
  return { versionId: String(asRecord(published.body).versionId), fingerprint };
}

const sign = (owner: string, versionId: string, fingerprint: string) =>
  request('/api/league/rulebook/sign', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ versionId, fingerprint }),
  });

const readSignatures = (versionId?: string) =>
  request(`/api/league/rulebook/signatures${versionId ? `?versionId=${versionId}` : ''}`);

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'rulebook-sign-'));
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

// ─── Reading ───────────────────────────────────────────────────────────────

test('before anything is published there is nothing to sign', async () => {
  const { status, body } = await readSignatures();
  const row = asRecord(body);
  assert.equal(status, 200, 'signed in or not, anyone may read this');
  assert.equal(row.versionId, null);
  assert.equal((row.signed as unknown[]).length, 0);
  assert.equal(row.acknowledgement, ACKNOWLEDGEMENT);
  assert.equal((row.members as string[]).length, 10);
});

test('signing before a first publish is refused', async () => {
  const refused = await sign('Joel', 'rb-nope', 'rb_0000_0');
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'nothing-published');
});

// ─── Signing ───────────────────────────────────────────────────────────────

test('a member signs the published revision, and everyone can see it', async () => {
  const version = await publishRevision('first-signing');
  const signed = await sign('Joel', version.versionId, version.fingerprint);
  assert.equal(signed.status, 200);

  const signature = asRecord(signed.body).signature as RulebookSignature;
  assert.equal(signature.owner, 'Joel');
  assert.equal(signature.versionId, version.versionId);
  assert.equal(signature.fingerprint, version.fingerprint);
  assert.equal(signature.acknowledgement, ACKNOWLEDGEMENT);
  assert.ok(signature.signedAt, 'a signature records when it happened');

  const status = asRecord((await readSignatures()).body);
  assert.deepEqual((status.signed as RulebookSignature[]).map((s) => s.owner), ['Joel']);
  assert.ok((status.missing as string[]).includes('Amy'));
  assert.equal(status.complete, false);
});

test('nobody signs for anybody else: the signer comes from the PIN', async () => {
  const version = await publishRevision('own-name-only');
  const forged = await request('/api/league/rulebook/sign', {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({
      versionId: version.versionId,
      fingerprint: version.fingerprint,
      owner: 'Joel',
    }),
  });
  assert.equal(forged.status, 200);
  const signature = asRecord(forged.body).signature as RulebookSignature;
  assert.equal(signature.owner, 'Amy', 'the body cannot name a different signer');
});

test('signing needs a signed-in member', async () => {
  const version = await publishRevision('anon-attempt');
  const anon = await request('/api/league/rulebook/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ versionId: version.versionId, fingerprint: version.fingerprint }),
  });
  assert.equal(anon.status, 401);
});

test('the same member cannot sign the same revision twice', async () => {
  const version = await publishRevision('sign-once');
  assert.equal((await sign('Joel', version.versionId, version.fingerprint)).status, 200);
  const again = await sign('Joel', version.versionId, version.fingerprint);
  assert.equal(again.status, 409);
  assert.equal(asRecord(again.body).code, 'already-signed');
});

test('an old revision cannot be signed', async () => {
  const old = await publishRevision('older');
  await publishRevision('newer');
  const refused = await sign('Amy', old.versionId, old.fingerprint);
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'not-current');
});

test('a fingerprint that is not the one on file is refused', async () => {
  const version = await publishRevision('wrong-print');
  const refused = await sign('Amy', version.versionId, 'rb_deadbeef_z');
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'wrong-fingerprint');
});

// ─── Publishing again ──────────────────────────────────────────────────────

test('publishing a new revision means the league signs again', async () => {
  const first = await publishRevision('signed-then-replaced');
  await sign('Joel', first.versionId, first.fingerprint);
  await sign('Amy', first.versionId, first.fingerprint);
  const before = asRecord((await readSignatures()).body);
  assert.equal((before.signed as unknown[]).length, 2);

  const second = await publishRevision('after-replacement');
  const after = asRecord((await readSignatures()).body);
  assert.equal(after.versionId, second.versionId);
  assert.equal((after.signed as unknown[]).length, 0, 'signatures never carry forward');
  assert.equal((after.missing as string[]).length, 10);

  // The old revision keeps the names that signed it. Nothing is rewritten.
  const old = asRecord((await readSignatures(first.versionId)).body);
  assert.deepEqual(
    (old.signed as RulebookSignature[]).map((s) => s.owner).sort(),
    ['Amy', 'Joel'],
  );
});

test('a signature is written to the audit log', async () => {
  const version = await publishRevision('audited-signature');
  await sign('Amy', version.versionId, version.fingerprint);
  const rows = (await request('/api/league/audit', { headers: auth(commissioner) })).body as Array<{
    action: string;
    owner: string;
    detail: { versionId?: string };
  }>;
  const entry = rows.find(
    (r) => r.action === 'rulebook-sign' && r.detail?.versionId === version.versionId,
  );
  assert.ok(entry, 'the signature is logged');
  assert.equal(entry.owner, 'Amy');
});

test('a stored signature is never updated in place', async () => {
  const version = await publishRevision('immutable-row');
  await sign('Joel', version.versionId, version.fingerprint);
  const first = (await store.listRulebookSignatures(SEASON)).find(
    (s) => s.owner === 'Joel' && s.versionId === version.versionId,
  );
  assert.ok(first);
  await sign('Joel', version.versionId, version.fingerprint);
  const second = (await store.listRulebookSignatures(SEASON)).filter(
    (s) => s.owner === 'Joel' && s.versionId === version.versionId,
  );
  assert.equal(second.length, 1, 'one row per member per revision');
  assert.equal(second[0].signedAt, first.signedAt, 'the original time stands');
});
