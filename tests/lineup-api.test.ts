import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(root, 'node_modules', '.tmp');
let tempRoot = '';
let server: Server;
let base = '';
let store: typeof import('../server/lib/leagueStore.js');
const headers = (owner = 'Brey') => ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': 'fixture-only' });
async function call(route: string, method = 'GET', body?: unknown, owner = 'Brey') {
  const response = await fetch(`${base}/api/league/${route}`, { method, headers: headers(owner), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'lineup-api-'));
  cpSync(path.join(root, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(root, 'src'), path.join(tempRoot, 'src'), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.ESPN_LEAGUE_ID = '123456';
  store = await import(pathToFileURL(path.join(tempRoot, 'server/lib/leagueStore.ts')).href);
  await store.setPin('Brey', 'fixture-only');
  await store.setPin('Ryan', 'fixture-only');
  const { default: app } = await import(pathToFileURL(path.join(tempRoot, 'server/app.ts')).href);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (tempRoot && path.resolve(tempRoot).startsWith(path.resolve(tempParent) + path.sep)) rmSync(tempRoot, { recursive: true, force: true });
});

test('lineup routes require authentication and default to disabled without disclosing grants', async () => {
  assert.equal((await fetch(`${base}/api/league/my-team`)).status, 401);
  const response = await call('my-team');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.executionEnabled, false);
  assert.equal(response.body.snapshot, null);
  assert.deepEqual(response.body.destinations, {});
  assert.equal((await call('lineup-access', 'GET', undefined, 'Ryan')).status, 403);
});
test('commissioner can grant own configured team only and revoke it', async () => {
  assert.equal((await call('lineup-access/Ryan', 'PUT', { enabled: true, leagueId: '123456', teamId: 1 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 1 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: 'other', teamId: 7 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 7 })).status, 200);
  assert.equal((await call('my-team')).body.enabled, true);
  assert.equal((await call('my-team')).body.executionEnabled, false);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: false })).status, 200);
  assert.equal((await call('my-team')).body.enabled, false);
});
test('client cannot select target team, and even granted access cannot enable writes', async () => {
  await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 7 });
  const request = { id: 'fixture-operation-123', playerId: 1, destinationSlotId: 'bench', revision: 'fixture' };
  assert.equal((await call('my-team/moves', 'POST', { ...request, teamId: 1 })).status, 400);
  assert.equal((await call('my-team/moves', 'POST', request)).status, 409);
  assert.deepEqual((await store.getState()).state.lineupManagement?.operations, {});
  assert.equal((await call('my-team/moves/nonexistent')).status, 409);
});
test('private lineup grants and ledger are redacted from public and member league state', async () => {
  const member = await call('state', 'GET', undefined, 'Ryan');
  assert.equal(member.status, 200);
  assert.equal('lineupManagement' in member.body.state, false);
  const publicResponse = await fetch(`${base}/api/league/state`);
  assert.equal('lineupManagement' in (await publicResponse.json()).state, false);
});
