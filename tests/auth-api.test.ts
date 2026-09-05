import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * Sign-in by emailed link, end to end against the local file backend.
 *
 * With no RESEND_API_KEY the mailer prints the link instead of sending it, so
 * these tests read the token the same way a person reads their inbox. That
 * also proves the no-key path works, which is how everyone runs this locally.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const commissioner = 'Brey';
const pins: Record<string, string> = { Brey: '9000', Joel: '1000', Amy: '2000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

/** Lines the mailer printed, newest last. Reset before each request for a link. */
let mailLog: string[] = [];

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

function session(token: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-session': token };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  if (response.status === 204) return { status: 204, body: null };
  return { status: response.status, body: await response.json() };
}

const asRecord = (body: unknown) => body as Record<string, unknown>;

/** Ask for a link and read the token back out of the printed line. */
async function linkFor(email: string): Promise<{ status: number; token: string | null }> {
  mailLog = [];
  const asked = await request('/api/auth/request-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const line = mailLog.find((entry) => entry.includes('sign-in link for'));
  const token = line ? (line.split('/sign-in/')[1] ?? null) : null;
  return { status: asked.status, token };
}

const consume = (token: string) =>
  request('/api/auth/consume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });

const setEmail = (owner: string, email: string) =>
  request(`/api/league/emails/${owner}`, {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ email }),
  });

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'auth-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.RESEND_API_KEY = '';
  process.env.PUBLIC_APP_URL = 'https://example.test';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    mailLog.push(args.map(String).join(' '));
    realLog(...args);
  };

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

// ─── Recording addresses ─────────────────────────────────────────────────────

test('only the commissioner may read or write the address book', async () => {
  const asMember = await request('/api/league/emails', { headers: auth('Joel') });
  assert.equal(asMember.status, 403);
  const anonymous = await request('/api/league/emails');
  assert.equal(anonymous.status, 401);
});

test('every owner appears, with no address until one is saved', async () => {
  const { status, body } = await request('/api/league/emails', { headers: auth(commissioner) });
  assert.equal(status, 200);
  const rows = body as Array<{ owner: string; email: string; confirmedAt: string | null }>;
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => row.email === '' && row.confirmedAt === null));
});

test('an address is saved, normalized, and reported unconfirmed', async () => {
  const saved = await setEmail('Joel', '  Joel@Example.COM ');
  assert.equal(saved.status, 200);
  const rows = saved.body as Array<{ owner: string; email: string; confirmedAt: string | null }>;
  const joel = rows.find((row) => row.owner === 'Joel');
  assert.equal(joel?.email, 'joel@example.com');
  assert.equal(joel?.confirmedAt, null, 'nobody has proved they can read that inbox yet');
});

test('a malformed address is refused', async () => {
  const refused = await setEmail('Amy', 'not an address');
  assert.equal(refused.status, 400);
});

test('two owners cannot share one address', async () => {
  const refused = await setEmail('Amy', 'joel@example.com');
  assert.equal(refused.status, 400);
  assert.match(String(asRecord(refused.body).error), /Joel/);
});

test('an owner may re-save the address they already have', async () => {
  const again = await setEmail('Joel', 'joel@example.com');
  assert.equal(again.status, 200);
});

// ─── Signing in ──────────────────────────────────────────────────────────────

test('an address nobody owns is answered as if a link went out', async () => {
  const { status, token } = await linkFor('stranger@example.com');
  assert.equal(status, 200, 'the sign-in page must not reveal who is in the league');
  assert.equal(token, null, 'but nothing was actually sent');
});

test('a link signs the owner in and confirms their address', async () => {
  const { status, token } = await linkFor('joel@example.com');
  assert.equal(status, 200);
  assert.ok(token, 'the mailer printed a link');

  const signedIn = await consume(token as string);
  assert.equal(signedIn.status, 200);
  const row = asRecord(signedIn.body);
  assert.equal(row.owner, 'Joel');
  assert.equal(row.isCommissioner, false);
  assert.ok(typeof row.session === 'string' && (row.session as string).length > 20);

  const me = await request('/api/auth/me', { headers: session(row.session as string) });
  assert.equal(me.status, 200);
  assert.equal(asRecord(me.body).owner, 'Joel');

  const book = await request('/api/league/emails', { headers: auth(commissioner) });
  const rows = book.body as Array<{ owner: string; confirmedAt: string | null }>;
  assert.ok(rows.find((r) => r.owner === 'Joel')?.confirmedAt, 'signing in proves the inbox');
});

test('a link works once', async () => {
  const { token } = await linkFor('joel@example.com');
  const first = await consume(token as string);
  assert.equal(first.status, 200);
  const second = await consume(token as string);
  assert.equal(second.status, 400);
  assert.match(String(asRecord(second.body).error), /already been used/);
});

test('a made-up token is refused', async () => {
  const refused = await consume('not-a-real-token');
  assert.equal(refused.status, 400);
});

test('a session authenticates the same routes a PIN does', async () => {
  const { token } = await linkFor('joel@example.com');
  const signedIn = await consume(token as string);
  const key = asRecord(signedIn.body).session as string;

  const mine = await request('/api/league/keepers/Joel', {
    method: 'PUT',
    headers: session(key),
    body: JSON.stringify({ selections: [] }),
  });
  assert.equal(mine.status, 200);

  const notMine = await request('/api/league/keepers/Amy', {
    method: 'PUT',
    headers: session(key),
    body: JSON.stringify({ selections: [] }),
  });
  assert.equal(notMine.status, 403, 'a session grants exactly what the PIN granted, no more');
});

test('a member session is refused commissioner work', async () => {
  const { token } = await linkFor('joel@example.com');
  const key = asRecord((await consume(token as string)).body).session as string;
  const refused = await request('/api/league/emails', { headers: session(key) });
  assert.equal(refused.status, 403);
});

test('the commissioner signs in by link and keeps commissioner rights', async () => {
  await setEmail(commissioner, 'brey@example.com');
  const { token } = await linkFor('brey@example.com');
  const signedIn = await consume(token as string);
  assert.equal(asRecord(signedIn.body).isCommissioner, true);
  const allowed = await request('/api/league/emails', {
    headers: session(asRecord(signedIn.body).session as string),
  });
  assert.equal(allowed.status, 200);
});

// ─── Ending a session ────────────────────────────────────────────────────────

test('signing out kills the session on the server, not just the browser', async () => {
  const { token } = await linkFor('joel@example.com');
  const key = asRecord((await consume(token as string)).body).session as string;

  const out = await request('/api/auth/sign-out', { method: 'POST', headers: session(key) });
  assert.equal(out.status, 204);

  const after = await request('/api/auth/me', { headers: session(key) });
  assert.equal(after.status, 401);
});

test('changing an address drops that owner sessions', async () => {
  const { token } = await linkFor('joel@example.com');
  const key = asRecord((await consume(token as string)).body).session as string;
  assert.equal((await request('/api/auth/me', { headers: session(key) })).status, 200);

  await setEmail('Joel', 'joel.new@example.com');
  const after = await request('/api/auth/me', { headers: session(key) });
  assert.equal(after.status, 401, 'a reassigned address must not leave the old device signed in');
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

test('a fourth link in the window is refused with a wait', async () => {
  await setEmail('Amy', 'amy@example.com');
  for (let i = 0; i < 3; i += 1) {
    const asked = await linkFor('amy@example.com');
    assert.equal(asked.status, 200, `link ${i + 1} of 3 should send`);
  }
  const refused = await linkFor('amy@example.com');
  assert.equal(refused.status, 429);
});
