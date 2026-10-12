import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * Every way an owner can set their own PIN, end to end against the local file
 * backend.
 *
 * Written after an owner could not set his PIN and the commissioner did it
 * for him. The cause was a sign-in that had run out, not these routes, but
 * nothing proved that until now.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const commissioner = 'Brey';
const commishPin = '9000';

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';
let mailLog: string[] = [];

const json = { 'content-type': 'application/json' };
const byPin = (owner: string, pin: string) => ({ ...json, 'x-owner': owner, 'x-pin': pin });
const bySession = (token: string) => ({ ...json, 'x-session': token });

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const verify = (owner: string, pin: string) =>
  request('/api/league/verify', { method: 'POST', headers: byPin(owner, pin), body: '{}' });

const changePin = (headers: Record<string, string>, pin: string, extra: object = {}) =>
  request('/api/league/change-pin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ pin, ...extra }),
  });

/** Sign an owner in by emailed link, the normal way, and hand back the session. */
async function sessionFor(owner: string, email: string): Promise<string> {
  const saved = await request(`/api/league/emails/${owner}`, {
    method: 'POST',
    headers: byPin(commissioner, commishPin),
    body: JSON.stringify({ email }),
  });
  assert.equal(saved.status, 200);
  mailLog = [];
  await request('/api/auth/request-link', { method: 'POST', headers: json, body: JSON.stringify({ email }) });
  const line = mailLog.find((entry) => entry.includes('sign-in link for'));
  const token = line?.split('/sign-in/')[1];
  assert.ok(token, 'a link was printed');
  const consumed = await request('/api/auth/consume', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ token }),
  });
  assert.equal(consumed.status, 200);
  return consumed.body.session as string;
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'pin-'));
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

  const load = (...parts: string[]) => pathToFileURL(path.join(tempRoot, ...parts)).href;
  const [{ default: app }, storeModule] = await Promise.all([
    import(load('server', 'app.ts')),
    import(load('server', 'lib', 'leagueStore.ts')) as Promise<StoreModule>,
  ]);
  store = storeModule;
  await store.setPin(commissioner, commishPin);

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

test('a member signed in by link sets a PIN, and it signs them in', async () => {
  const token = await sessionFor('Bryan', 'bryan@example.com');
  const set = await changePin(bySession(token), '4321');
  assert.equal(set.status, 200);
  const signIn = await verify('Bryan', '4321');
  assert.equal(signIn.status, 200);
  assert.equal(signIn.body.mustChangePin, false);
});

test('a member changes their PIN again, and the old one stops working', async () => {
  const changed = await changePin(byPin('Bryan', '4321'), '8765');
  assert.equal(changed.status, 200);
  assert.equal((await verify('Bryan', '4321')).status, 401, 'old PIN is dead');
  assert.equal((await verify('Bryan', '8765')).status, 200, 'new PIN works');
});

test('a PIN the commish sets works at once, and the member can still change it', async () => {
  const set = await request('/api/league/pins/Kyle', {
    method: 'POST',
    headers: byPin(commissioner, commishPin),
    body: JSON.stringify({ pin: '1111' }),
  });
  assert.equal(set.status, 200);
  const first = await verify('Kyle', '1111');
  assert.equal(first.status, 200);
  assert.equal(first.body.mustChangePin, false);
  assert.equal((await changePin(byPin('Kyle', '1111'), '2222')).status, 200);
  assert.equal((await verify('Kyle', '2222')).status, 200);
});

test('a temporary PIN signs in once and must be replaced', async () => {
  await request('/api/league/pins/Derek', {
    method: 'POST',
    headers: byPin(commissioner, commishPin),
    body: JSON.stringify({ pin: '5555', temp: true }),
  });
  const first = await verify('Derek', '5555');
  assert.equal(first.status, 200);
  assert.equal(first.body.mustChangePin, true);
  assert.equal((await changePin(byPin('Derek', '5555'), '6666')).status, 200);
  const after = await verify('Derek', '6666');
  assert.equal(after.body.mustChangePin, false, 'the new PIN is their own');
  assert.equal((await verify('Derek', '5555')).status, 401);
});

test('a team with no PIN claims one, once', async () => {
  const status = await request('/api/league/pin-status');
  assert.equal(status.status, 200);
  const claim = (pin: string) =>
    request('/api/league/claim-pin', { method: 'POST', headers: json, body: JSON.stringify({ owner: 'Aaron', pin }) });
  assert.equal((await claim('3030')).status, 200);
  assert.equal((await verify('Aaron', '3030')).status, 200);
  assert.equal((await claim('4040')).status, 409, 'nobody else can claim it after');
});

test('a member can only ever change their own PIN', async () => {
  const token = await sessionFor('Patrick', 'patrick@example.com');
  // The body names someone else. The server takes the owner from the sign-in.
  const tried = await changePin(bySession(token), '7777', { owner: 'Bryan' });
  assert.equal(tried.status, 200);
  assert.equal((await verify('Patrick', '7777')).status, 200, 'it changed Patrick');
  assert.equal((await verify('Bryan', '8765')).status, 200, 'Bryan is untouched');
});

test('a sign-in that has run out cannot set a PIN, and says so', async () => {
  const tried = await changePin(bySession('long-gone-session'), '1234');
  assert.equal(tried.status, 401);
  assert.match(String(tried.body.error), /expired/);
});

test('a PIN has to be 4 to 8 digits', async () => {
  const token = await sessionFor('Ryan', 'ryan@example.com');
  for (const bad of ['123', '123456789', 'abcd', '']) {
    assert.equal((await changePin(bySession(token), bad)).status, 400, `refused: "${bad}"`);
  }
});
