import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const pins: Record<string, string> = { Brey: '9000', Joel: '1000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let server: Server;
let baseUrl = '';
let store: StoreModule;

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

interface Caps {
  season: number;
  defaultCap: number;
  caps: Array<{ matchupPeriodId: number; cap: number; updatedBy: string }>;
  error?: string;
}

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: Caps }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: (await response.json()) as Caps };
}

const put = (who: string, week: number | string, cap: unknown) =>
  request(`/api/league/games-caps/${week}`, { method: 'PUT', headers: auth(who), body: JSON.stringify({ cap }) });

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'games-cap-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, loaded] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
  ]);
  store = loaded;
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

test('anyone may read the caps, and the season starts with none set', async () => {
  const { status, body } = await request('/api/league/games-caps');
  assert.equal(status, 200);
  assert.equal(body.season, 2027);
  assert.equal(body.defaultCap, 30);
  assert.deepEqual(body.caps, []);
});

test('only the commissioner sets a cap, and the change is audited', async () => {
  const member = await put('Joel', 3, 31);
  assert.equal(member.status, 403);

  const anon = await request('/api/league/games-caps/3', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cap: 31 }),
  });
  assert.equal(anon.status, 401);

  const commish = await put('Brey', 3, 31);
  assert.equal(commish.status, 200);
  assert.deepEqual(commish.body.caps.map((row) => [row.matchupPeriodId, row.cap, row.updatedBy]), [[3, 31, 'Brey']]);

  const again = await put('Brey', 3, '28');
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.caps.map((row) => [row.matchupPeriodId, row.cap]), [[3, 28]], 'one row per week');

  const other = await put('Brey', 18, 24);
  assert.deepEqual(other.body.caps.map((row) => [row.matchupPeriodId, row.cap]), [[3, 28], [18, 24]]);

  const read = await request('/api/league/games-caps');
  assert.deepEqual(read.body.caps.map((row) => row.cap), [28, 24]);

  const audit = await store.readAudit(20);
  const entries = audit.filter((row) => row.action === 'scores.gamesCap');
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].detail, { matchupPeriodId: 18, cap: 24 });
});

test('a cap outside 1 to 70, or a week that is not one, is refused', async () => {
  for (const bad of [0, 71, 30.5, 'lots', null]) {
    const { status } = await put('Brey', 4, bad);
    assert.equal(status, 400, String(bad));
  }
  assert.equal((await put('Brey', 'x', 30)).status, 400);
  assert.equal((await put('Brey', 0, 30)).status, 400);
  const read = await request('/api/league/games-caps');
  assert.ok(!read.body.caps.some((row) => row.matchupPeriodId === 4), 'nothing bad was stored');
});
