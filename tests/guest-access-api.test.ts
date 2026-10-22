import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let tempRoot = '';
let server: Server;
let base = '';
let store: typeof import('../server/lib/leagueStore.ts');
const headers = (owner: string) => ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': owner === 'Brey' ? '9000' : '1000' });

before(async () => {
  const parent = path.join(root, 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  tempRoot = mkdtempSync(path.join(parent, 'guest-access-'));
  for (const folder of ['server', 'src']) cpSync(path.join(root, folder), path.join(tempRoot, folder), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const [{ default: app }, loaded] = await Promise.all([
    import(pathToFileURL(path.join(tempRoot, 'server/app.ts')).href),
    import(pathToFileURL(path.join(tempRoot, 'server/lib/leagueStore.ts')).href),
  ]);
  store = loaded;
  await store.setPin('Brey', '9000');
  await store.setPin('Joel', '1000');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

const commish = headers('Brey');
let guestToken = '';
let guestId = '';
const guestHeaders = () => ({ 'content-type': 'application/json', 'x-session': guestToken });

test('only the commissioner can issue and list guest invites', async () => {
  for (const [auth, code] of [[undefined, 401], [headers('Joel'), 403]] as const) {
    assert.equal((await fetch(`${base}/api/league/guests`, { headers: auth })).status, code);
    assert.equal((await fetch(`${base}/api/league/guests`, { method: 'POST', headers: auth, body: '{}' })).status, code);
  }
  for (const input of [{ name: '', days: 30 }, { name: 'Guest', days: 999 }, { name: 'x'.repeat(61), days: 7 }]) {
    assert.equal((await fetch(`${base}/api/league/guests`, { method: 'POST', headers: commish, body: JSON.stringify(input) })).status, 400);
  }
  const response = await fetch(`${base}/api/league/guests`, { method: 'POST', headers: commish, body: JSON.stringify({ name: 'Alex', days: 7 }) });
  assert.equal(response.status, 200);
  const invite = await response.json();
  guestId = invite.id;
  guestToken = new URL(invite.url).pathname.split('/').at(-1)!;
  assert.notEqual(guestId, guestToken, 'only the token hash identifies the stored invite');
  const listed = await (await fetch(`${base}/api/league/guests`, { headers: commish })).json();
  assert.equal(listed[0].name, 'Alex');
  assert.ok(!JSON.stringify(listed).includes(guestToken), 'listing never recovers the raw secret');
});

test('a guest signs in read-only without becoming an owner', async () => {
  const response = await fetch(`${base}/api/auth/guest/consume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: guestToken }) });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.isGuest, true);
  assert.equal(login.isCommissioner, false);
  assert.equal(login.guestName, 'Alex');
  assert.ok(Date.parse(login.expiresAt) > Date.now());
  assert.ok(login.owner.startsWith('guest:'));
  const me = await (await fetch(`${base}/api/auth/me`, { headers: guestHeaders() })).json();
  assert.equal(me.isGuest, true);
  await store.mutateState(state => { state.keepersRevealed = false; state.keepers.Joel = [{ playerKey: 'secret-keeper', playerName: 'Secret Keeper' }]; });
  const state = await (await fetch(`${base}/api/league/state`, { headers: guestHeaders() })).json();
  assert.deepEqual(state.state.keepers, {});
  assert.ok(!JSON.stringify(state).includes('Secret Keeper'), 'unrevealed keeper names stay private');
  assert.equal(state.meta.isCommissioner, false);
  assert.equal((await fetch(`${base}/api/league/games-caps`, { headers: guestHeaders() })).status, 200);
  assert.equal((await fetch(`${base}/api/league/history`, { headers: guestHeaders() })).status, 200);
});

test('guest writes, owner impersonation, and private reads are rejected before handlers run', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await fetch(`${base}/api/league/keepers/Brey`, { method, headers: { ...guestHeaders(), 'x-owner': 'Brey', 'x-pin': '9000' }, body: '{}' });
    assert.equal(result.status, 403, method);
  }
  for (const path of ['/api/league/guests', '/api/league/emails', '/api/league/dues', '/api/espn/debug']) assert.equal((await fetch(`${base}${path}`, { headers: guestHeaders() })).status, 403, path);
  assert.equal((await fetch(`${base}/api/league/act-as/Brey`, { method: 'POST', headers: guestHeaders(), body: '{}' })).status, 403);
});

test('expired guest links fail, reusable links survive local sign-out, and revocation is immediate', async () => {
  const expired = await store.createGuestAccess('Expired', 7, new Date('2020-01-01T00:00:00Z'));
  assert.equal((await store.verifySession(expired.token, new Date())).ok, false);
  assert.equal((await fetch(`${base}/api/auth/sign-out`, { method: 'POST', headers: guestHeaders(), body: '{}' })).status, 204);
  assert.equal((await store.verifySession(guestToken, new Date())).isGuest, true);
  assert.equal((await fetch(`${base}/api/league/guests/${guestId}`, { method: 'DELETE', headers: commish })).status, 204);
  assert.equal((await store.verifySession(guestToken, new Date())).ok, false);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: guestHeaders() })).status, 401);
  assert.equal((await fetch(`${base}/api/league/games-caps`, { headers: guestHeaders() })).status, 401);
  const result = await fetch(`${base}/api/auth/guest/consume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: guestToken }) });
  assert.equal(result.status, 401);
});
