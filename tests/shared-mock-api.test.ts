/**
 * The mock-with-a-friend routes, end to end on the file store: asking,
 * joining, picking on the clock, running it out, quitting, and the grades
 * landing in both people's Past mocks.
 */
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
import type { SharedMockRoom } from '../src/lib/league/sharedMock.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const pins: Record<string, string> = {
  Brey: '9000',
  Ryan: '1000',
  Amy: '2000',
  Joel: '3000',
  Aaron: '4000',
  Derek: '5000',
  Kyle: '6000',
  Dustin: '7000',
  Patrick: '8000',
  Bryan: '8100',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

const dataset = rawDataset as unknown as LeagueDataset;
/** Committed players, best keeper average first: a legal pick is any one not yet taken. */
const playerKeys = dataset.players
  .slice()
  .sort((a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1))
  .map((player) => player.key);

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() };
}

const asRecord = (body: unknown) => body as Record<string, unknown>;
const roomOf = (body: unknown) => asRecord(body).room as SharedMockRoom;

const invite = (host: string, guest: string, mode: unknown = 'sharp') =>
  request('/api/league/shared-mocks', { method: 'POST', headers: auth(host), body: JSON.stringify({ with: guest, mode }) });
const join = (owner: string, id: string) =>
  request(`/api/league/shared-mocks/${id}/join`, { method: 'POST', headers: auth(owner) });
const pick = (owner: string, id: string, overall: number, playerKey: string) =>
  request(`/api/league/shared-mocks/${id}/pick`, { method: 'POST', headers: auth(owner), body: JSON.stringify({ overall, playerKey }) });
const expire = (owner: string, id: string, overall: number, playerKey: string) =>
  request(`/api/league/shared-mocks/${id}/expire`, { method: 'POST', headers: auth(owner), body: JSON.stringify({ overall, playerKey }) });
const quit = (owner: string, id: string) =>
  request(`/api/league/shared-mocks/${id}/quit`, { method: 'POST', headers: auth(owner) });
const read = (owner: string, id: string) => request(`/api/league/shared-mocks/${id}`, { headers: auth(owner) });
const list = async (owner: string) => asRecord((await request('/api/league/shared-mocks', { headers: auth(owner) })).body).rooms as SharedMockRoom[];

/** Whose pick the room's clock is on. */
const onClock = (room: SharedMockRoom) => room.board!.slots.find((slot) => slot.pick.overall === room.clock!.overall)!.pick.currentOwner;

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'shared-mock-api-'));
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

test('asking somebody opens a room only the two of them can see', async () => {
  assert.equal((await request('/api/league/shared-mocks')).status, 401);
  assert.equal((await invite('Brey', 'Brey')).status, 400);
  assert.equal((await invite('Brey', 'Nobody')).status, 400);
  assert.equal((await invite('Brey', 'Joel', 'wild')).status, 400);

  const created = await invite('Brey', 'Joel');
  assert.equal(created.status, 200);
  const room = roomOf(created.body);
  assert.deepEqual(room.people, ['Brey', 'Joel']);
  assert.deepEqual(room.joined, ['Brey']);
  assert.equal(room.startedAt, null);
  assert.equal(room.mode, 'sharp');

  // One open mock a person.
  const again = await invite('Brey', 'Amy');
  assert.equal(again.status, 409);
  assert.match(String(asRecord(again.body).error), /open with Joel/);

  // The guest sees it on their mock page; nobody else can open it.
  assert.equal((await list('Joel')).map((entry) => entry.id).includes(room.id), true);
  assert.equal((await list('Amy')).length, 0);
  const peek = await read('Amy', room.id);
  assert.equal(peek.status, 403);
  assert.match(String(asRecord(peek.body).error), /Brey and Joel/);
  assert.equal((await read('Joel', room.id)).status, 200);
  assert.equal((await read('Joel', 'with-nope')).status, 404);

  // Declining ends it. The host still sees who passed until he clears it.
  assert.equal((await quit('Joel', room.id)).status, 200);
  assert.equal(roomOf((await read('Brey', room.id)).body).endedBy, 'Joel');
  assert.equal((await list('Joel')).length, 0);
  assert.equal((await list('Brey')).length, 1);
  assert.equal((await quit('Brey', room.id)).status, 200);
  assert.equal((await list('Brey')).length, 0);
});

test('joining starts the draft on a frozen board, and only the person on the clock can pick', async () => {
  const room = roomOf((await invite('Amy', 'Ryan', 'realistic')).body);
  assert.equal((await join('Kyle', room.id)).status, 403);
  const started = roomOf((await join('Ryan', room.id)).body);
  assert.ok(started.startedAt);
  assert.ok(started.board && started.board.slots.length > 100);
  assert.ok(started.clock);
  const owner = onClock(started);
  const other = owner === 'Amy' ? 'Ryan' : 'Amy';
  const overall = started.clock!.overall;

  const wrong = await pick(other, room.id, overall, playerKeys[0]);
  assert.equal(wrong.status, 409);
  assert.match(String(asRecord(wrong.body).error), /not yours/);
  assert.equal((await pick('Kyle', room.id, overall, playerKeys[0])).status, 409);
  assert.equal((await pick(owner, room.id, overall + 1, playerKeys[0])).status, 409);
  assert.equal((await pick(owner, room.id, overall, '')).status, 400);

  const made = roomOf((await pick(owner, room.id, overall, playerKeys[0])).body);
  assert.equal(made.choices[overall], playerKeys[0]);
  assert.ok(made.clock && made.clock.overall > overall);
  assert.equal(onClock(made), other, 'the other person is up next');

  // The same player twice is refused; the clock cannot be run out early.
  const gone = await pick(other, room.id, made.clock!.overall, playerKeys[0]);
  assert.equal(gone.status, 409);
  assert.match(String(asRecord(gone.body).error), /already gone/);
  const early = await expire(other, room.id, made.clock!.overall, playerKeys[1]);
  assert.equal(early.status, 409);
  assert.match(String(asRecord(early.body).error), /not up yet/);

  // Ten minutes later, either person may run it out, and the room's pick is marked.
  await store.updateSharedMock(room.id, (value) => {
    const current = value as SharedMockRoom;
    return { ...current, clock: { ...current.clock!, startedAt: new Date(Date.now() - 10 * 60_000).toISOString() } };
  }, new Date().toISOString());
  const ran = roomOf((await expire(owner, room.id, made.clock!.overall, playerKeys[1])).body);
  assert.deepEqual(ran.auto, [made.clock!.overall]);
  assert.equal(ran.choices[made.clock!.overall], playerKeys[1]);

  // Quitting ends it for both.
  assert.equal((await quit('Amy', room.id)).status, 200);
  const after_ = roomOf((await read('Ryan', room.id)).body);
  assert.equal(after_.endedBy, 'Amy');
  assert.equal((await pick('Ryan', room.id, ran.clock!.overall, playerKeys[2])).status, 409);
  assert.equal((await quit('Ryan', room.id)).status, 200);
});

test('a finished mock saves a grade to both people\'s Past mocks', async () => {
  const room = roomOf((await invite('Derek', 'Kyle')).body);
  let current = roomOf((await join('Kyle', room.id)).body);
  let used = 0;
  while (current.clock) {
    const owner = onClock(current);
    const response = await pick(owner, room.id, current.clock.overall, playerKeys[used]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    current = roomOf(response.body);
    used += 1;
  }
  assert.ok(current.finishedAt);
  assert.equal((await list('Derek'))[0]?.finishedAt, current.finishedAt);

  const grade = (rank: number) => ({ grade: rank === 1 ? 'A+' : 'B', rank, teams: 10, points: 9000, average: 8000, standings: [], roster: [], openSlots: [], steal: null, reach: null });
  const results = [
    { owner: 'Derek', id: 'mock-abc123-7', seed: current.seed, mode: current.mode, grade: grade(1) },
    { owner: 'Kyle', id: 'mock-def456-7', seed: current.seed, mode: current.mode, grade: grade(4) },
    { owner: 'Amy', id: 'mock-xyz789-7', seed: current.seed, mode: current.mode, grade: grade(2) },
  ];
  const saved = await request(`/api/league/shared-mocks/${room.id}/results`, {
    method: 'POST', headers: auth('Kyle'), body: JSON.stringify({ results }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(asRecord(saved.body).saved, ['Derek', 'Kyle'], 'only the people at the table');

  const derek = asRecord((await request('/api/league/mock-results', { headers: auth('Derek') })).body).results as Array<Record<string, unknown>>;
  assert.equal(derek[0].id, 'mock-abc123-7');
  assert.deepEqual(derek[0].vs, ['Kyle']);
  const kyle = asRecord((await request('/api/league/mock-results', { headers: auth('Kyle') })).body).results as Array<Record<string, unknown>>;
  assert.deepEqual(kyle[0].vs, ['Derek']);
  // Sent twice, the same draft saves once.
  await request(`/api/league/shared-mocks/${room.id}/results`, { method: 'POST', headers: auth('Derek'), body: JSON.stringify({ results }) });
  assert.equal((asRecord((await request('/api/league/mock-results', { headers: auth('Derek') })).body).results as unknown[]).length, 1);
  assert.equal((await request(`/api/league/shared-mocks/${room.id}/results`, { method: 'POST', headers: auth('Amy'), body: JSON.stringify({ results }) })).status, 403);
});
