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
  tempRoot = mkdtempSync(path.join(parent, 'season-mode-'));
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

const put = (seasonMode: unknown, owner?: string) => fetch(`${base}/api/league/season-mode`, {
  method: 'POST', headers: owner ? headers(owner) : { 'content-type': 'application/json' }, body: JSON.stringify({ seasonMode }),
});

test('only the commissioner can write, and the mode must be one of two values', async () => {
  const beforeState = await store.getState();
  assert.equal((await put('off-season')).status, 401);
  assert.equal((await put('off-season', 'Joel')).status, 403);
  for (const value of ['auto', null, true, {}, 'IN SEASON']) assert.equal((await put(value, 'Brey')).status, 400);
  assert.deepEqual(await store.getState(), beforeState, 'refused writes change nothing');
});

test('the stored choice reaches all members and signed-out viewers, and is audited', async () => {
  await store.mutateState((state) => { state.draft.closedAt = '2026-10-18T23:00:00Z'; });
  for (const mode of ['off-season', 'in-season']) {
    const response = await put(mode, 'Brey');
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.state.seasonMode, mode);
    assert.equal(saved.meta.seasonMode, mode);
    assert.equal((await store.getState()).state.seasonMode, mode, 'the choice is in the shared store');
    for (const owner of [null, 'Joel', 'Brey']) {
      const seen = await fetch(`${base}/api/league/state`, { headers: owner ? headers(owner) : {} });
      const body = await seen.json();
      assert.equal(body.meta.seasonMode, mode);
    }
  }
  const response = await fetch(`${base}/api/league/audit`, { headers: headers('Brey') });
  const rows = await response.json() as Array<{ action: string; owner: string; detail: { to?: string } }>;
  const changes = rows.filter((row) => row.action === 'season.mode');
  assert.equal(changes.length, 2);
  assert.ok(changes.every((row) => row.owner === 'Brey'));
  assert.deepEqual(new Set(changes.map((row) => row.detail.to)), new Set(['off-season', 'in-season']));
});
