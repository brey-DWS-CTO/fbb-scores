import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const dataset = rawDataset as unknown as LeagueDataset;
const commissioner = dataset.teams.find((team) => team.isCommissioner)?.owner;
assert.ok(commissioner, 'fixture needs a commissioner');
const pins = { [commissioner]: '9000', Joel: '1000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');
let tempRoot = '';
let server: Server;
let baseUrl = '';

const auth = (owner: keyof typeof pins) => ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] });
async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'projection-edits-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const [{ default: app }, store] = await Promise.all([
    import(pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href),
    import(pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href) as Promise<StoreModule>,
  ]);
  for (const [owner, pin] of Object.entries(pins)) await store.setPin(owner, pin);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

type Edit = { espnId: number; games: number | null; perGame: Record<string, number>; editedBy: string };

test('projection edits are the commissioner\'s alone', async () => {
  assert.equal((await request('/api/league/projection-edits')).status, 401);
  assert.equal((await request('/api/league/projection-edits', { headers: auth('Joel') })).status, 403);
  const put = await request('/api/league/projection-edits/7', { method: 'PUT', headers: auth('Joel'), body: JSON.stringify({ name: 'X', games: 3 }) });
  assert.equal(put.status, 403);
});

test('the first read writes the two injury estimates once; save, change and reset work', async () => {
  const first = await request('/api/league/projection-edits', { headers: auth(commissioner) });
  assert.equal(first.status, 200);
  const seeded = first.body.edits as Edit[];
  assert.deepEqual(seeded.map((edit) => [edit.espnId, edit.games]), [[3102531, 25], [3913176, 45]]);

  // Remove one seed; a second read must not bring it back.
  assert.equal((await request('/api/league/projection-edits/3913176', { method: 'DELETE', headers: auth(commissioner) })).status, 200);
  const afterDelete = (await request('/api/league/projection-edits', { headers: auth(commissioner) })).body.edits as Edit[];
  assert.deepEqual(afterDelete.map((edit) => edit.espnId), [3102531]);

  const saved = await request('/api/league/projection-edits/3112335', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ name: 'Nikola Jokic', games: 70, perGame: { '0': 30 }, note: 'MVP year' }),
  });
  assert.equal(saved.status, 200);
  assert.equal((saved.body.edit as Edit).editedBy, commissioner);

  const changed = await request('/api/league/projection-edits/3112335', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ name: 'Nikola Jokic', games: null, perGame: { '0': 31 } }),
  });
  assert.equal(changed.status, 200);
  const list = (await request('/api/league/projection-edits', { headers: auth(commissioner) })).body.edits as Edit[];
  const jokic = list.find((edit) => edit.espnId === 3112335)!;
  assert.deepEqual([jokic.games, jokic.perGame], [null, { '0': 31 }], 'a save replaces the whole edit');

  const bad = await request('/api/league/projection-edits/3112335', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ name: 'Nikola Jokic', games: 99 }),
  });
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.error), /between 0 and 82/);
});
