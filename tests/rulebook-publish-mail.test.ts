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
 * Publishing a revision mails every member with an address: read it, sign it.
 * With no mail key the mailer prints who it would have written to, and the
 * test reads that, the same way tests/notify-api.test.ts does.
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

test('publishing a revision mails every member who has an address', async () => {
  mailLog = [];
  const book = structuredClone(seed);
  book.articles[0].title = 'League Format (mailed)';
  const current = await store.getRulebookDraft(SEASON);
  const saved = await request('/api/league/rulebook/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ book, expectedVersion: current?.version ?? 0 }),
  });
  assert.equal(saved.status, 200);

  const published = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: rulebookFingerprint(book), notes: 'Season 17 book.' }),
  });
  assert.equal(published.status, 200);
  await notifier.mailSettled();

  const sent = mails();
  assert.deepEqual(
    sent.map((m) => m.to).sort(),
    ['amy@example.test', 'joel@example.test'],
    'the two members with addresses, nobody else',
  );
  assert.match(sent[0].subject, /Sign the rule book: revision 14 is out/);
});
