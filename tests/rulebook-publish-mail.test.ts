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

/**
 * Publishing is quiet. The commissioner then picks who gets the "read it,
 * sign it" note, which is what lets them try it on themselves first. With no
 * mail key the mailer prints who it would have written to, and the test reads
 * that, the same way tests/notify-api.test.ts does.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const seed = rawRulebook as unknown as Rulebook;
const SEASON = seed.season;

const commissioner = 'Brey';
const pins: Record<string, string> = { Brey: '9000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');
type NotifierModule = typeof import('../server/lib/notifier.ts');

let tempRoot = '';
let store: StoreModule;
let notifier: NotifierModule;
let server: Server;
let baseUrl = '';
let mailLog: string[] = [];
const realLog = console.log;

const PREFIX = '[notify] no mail key, would send to ';

function mails(): Array<{ to: string; subject: string }> {
  return mailLog
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => {
      const rest = line.slice(PREFIX.length);
      const split = rest.indexOf(': ');
      return { to: rest.slice(0, split), subject: rest.slice(split + 2) };
    });
}

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() };
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'rulebook-mail-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.RESEND_API_KEY = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  console.log = (...args: unknown[]) => {
    mailLog.push(args.map(String).join(' '));
  };

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const notifierUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'notifier.ts')).href;
  const [{ default: app }, storeModule, notifierModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
    import(notifierUrl) as Promise<NotifierModule>,
  ]);
  store = storeModule;
  notifier = notifierModule;
  await store.setPin(commissioner, pins[commissioner]);
  await store.setOwnerEmail('Joel', 'joel@example.test', null);
  await store.setOwnerEmail('Amy', 'amy@example.test', null);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  console.log = realLog;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

const signRequest = (owners: unknown) =>
  request('/api/league/rulebook/sign-request', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ owners }),
  });

test('before a publish there is nothing to ask anyone to sign', async () => {
  const { status } = await signRequest(['Joel']);
  assert.equal(status, 409);
});

test('publishing is quiet; the sign request goes only to the members picked', async () => {
  mailLog = [];
  // Nothing has been saved as a draft yet: the editor shows the seed at v0,
  // and the first publish goes straight from it.
  assert.equal(await store.getRulebookDraft(SEASON), null);
  const published = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: rulebookFingerprint(seed), notes: 'Season 17 book.' }),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  await notifier.mailSettled();
  assert.deepEqual(mails(), [], 'publishing on its own mails nobody');

  const empty = await signRequest([]);
  assert.equal(empty.status, 400);

  const one = await signRequest(['Joel', 'Mallory']);
  assert.equal(one.status, 200);
  await notifier.mailSettled();
  assert.deepEqual(one.body, {
    versionId: (one.body as { versionId: string }).versionId,
    revision: 14,
    sent: ['Joel'],
    noAddress: [],
  });
  assert.deepEqual(mails().map((m) => m.to), ['joel@example.test'], 'a stranger is dropped, not mailed');
  assert.equal(mails()[0].subject, 'The 2026-27 Nerds Fantasy Basketball League Constitution');

  mailLog = [];
  const rest = await signRequest(['Amy', 'Ryan']);
  assert.equal(rest.status, 200);
  await notifier.mailSettled();
  const body = rest.body as { sent: string[]; noAddress: string[] };
  assert.deepEqual(body.sent, ['Amy']);
  assert.deepEqual(body.noAddress, ['Ryan'], 'picked, but no address on file');
  assert.deepEqual(mails().map((m) => m.to), ['amy@example.test']);
});

test('the commissioner can withdraw a signature so a member signs again', async () => {
  const versions = (await (await fetch(`${baseUrl}/api/league/rulebook/versions`)).json()) as Array<{
    id: string;
    fingerprint: string;
  }>;
  await store.setPin('Joel', '1000');
  const joel = { 'content-type': 'application/json', 'x-owner': 'Joel', 'x-pin': '1000' };
  const signed = await fetch(`${baseUrl}/api/league/rulebook/sign`, {
    method: 'POST',
    headers: joel,
    body: JSON.stringify({ versionId: versions[0].id, fingerprint: versions[0].fingerprint }),
  });
  assert.equal(signed.status, 200);

  const notCommish = await fetch(`${baseUrl}/api/league/rulebook/signatures/Joel`, { method: 'DELETE', headers: joel });
  assert.equal(notCommish.status, 403);

  const withdrawn = await request('/api/league/rulebook/signatures/Joel', { method: 'DELETE', headers: auth(commissioner) });
  assert.equal(withdrawn.status, 200);
  const again = await request('/api/league/rulebook/signatures/Joel', { method: 'DELETE', headers: auth(commissioner) });
  assert.equal(again.status, 404, 'nothing left to withdraw');

  const list = (await (await fetch(`${baseUrl}/api/league/rulebook/signatures`)).json()) as { missing: string[] };
  assert.ok(list.missing.includes('Joel'));

  const resigned = await fetch(`${baseUrl}/api/league/rulebook/sign`, {
    method: 'POST',
    headers: joel,
    body: JSON.stringify({ versionId: versions[0].id, fingerprint: versions[0].fingerprint }),
  });
  assert.equal(resigned.status, 200, 'and Joel may sign again');

  // A second revision carries its own number in the note.
  mailLog = [];
  const book = structuredClone(seed);
  book.articles[0].title = 'League Format (second)';
  const current = await store.getRulebookDraft(SEASON);
  await request('/api/league/rulebook/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ book, expectedVersion: current?.version ?? 0 }),
  });
  const second = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: rulebookFingerprint(book), notes: '' }),
  });
  assert.equal(second.status, 200);
  await signRequest(['Joel']);
  await notifier.mailSettled();
  assert.equal(mails()[0].subject, 'The 2026-27 Nerds Fantasy Basketball League Constitution');
});
