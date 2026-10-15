import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { PropBet } from '../src/lib/league/propBets.ts';

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
let SEASON = 2027;

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface AchievementsBody {
  you: {
    earned: Record<string, string>;
    left: number;
    check: { ok: boolean; reason?: string };
    reveals: Array<{ target: string; keepers: Array<{ playerName: string }> }>;
  };
  standings: Array<{ owner: string; earned: number; revealed: number }>;
  revealed?: string;
}

const achievements = async (owner: string) =>
  (await request('/api/league/achievements', { headers: auth(owner) })).body as unknown as AchievementsBody;

const reveal = (owner: string) =>
  request('/api/league/achievements/reveal', { method: 'POST', headers: auth(owner) });

const setProp = (owner: string, input: Record<string, unknown>) =>
  request('/api/league/prop-bets', { method: 'POST', headers: auth(owner), body: JSON.stringify(input) });

async function saveMock(owner: string, id: string, grade: string) {
  await store.saveMockResult(
    { season: SEASON, owner, id, result: { id, grade: { grade } }, createdAt: new Date().toISOString() },
    10,
  );
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'achievements-api-'));
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
  SEASON = (await store.getState()).state.season;
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

beforeEach(async () => {
  await store.mutateState((draft) => {
    draft.draft.startedAt = null;
    draft.draft.closedAt = null;
    draft.draft.picks = {};
    draft.keepers = {};
    draft.keepersRevealed = false;
    draft.achievements = { earned: {}, reveals: {}, mocks: {} };
    draft.propBets = [];
  });
  for (const owner of Object.keys(pins)) {
    for (const row of await store.listMockResults(SEASON, owner)) {
      await store.deleteMockResult(SEASON, owner, row.id);
    }
  }
});

// ─── Achievements ──────────────────────────────────────────────────────────

test('signing in is required', async () => {
  assert.equal((await request('/api/league/achievements')).status, 401);
  assert.equal((await request('/api/league/achievements/reveal', { method: 'POST' })).status, 401);
});

test('past work counts: a saved A mock earns two achievements', async () => {
  await saveMock('Joel', 'mock-a-1', 'A');
  const body = await achievements('Joel');
  assert.ok(body.you.earned['first-mock']);
  assert.ok(body.you.earned['honor-roll']);
  assert.equal(body.you.left, 2);
  assert.equal(body.standings[0].owner, 'Joel');
});

test('earned sticks after the mock that earned it is deleted', async () => {
  await saveMock('Joel', 'mock-a-1', 'B');
  assert.ok((await achievements('Joel')).you.earned['first-mock']);
  await store.deleteMockResult(SEASON, 'Joel', 'mock-a-1');
  assert.ok((await achievements('Joel')).you.earned['first-mock']);
});

test('the running mock count earns MOCK ADDICT past the ten kept rows', async () => {
  await store.mutateState((draft) => {
    draft.achievements = { earned: {}, reveals: {}, mocks: { Kyle: 12 } };
  });
  const body = await achievements('Kyle');
  assert.ok(body.you.earned['ten-mocks']);
});

test('a reveal waits until another team has keepers in', async () => {
  await saveMock('Joel', 'mock-a-1', 'C');
  const body = await achievements('Joel');
  assert.equal(body.you.check.reason, 'nobody-ready');
  assert.equal((await reveal('Joel')).status, 409);
});

test('a reveal shows one random team, once, and only to the owner who spent it', async () => {
  await saveMock('Joel', 'mock-a-1', 'C');
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
  });

  const spent = await reveal('Joel');
  assert.equal(spent.status, 200);
  const body = spent.body as unknown as AchievementsBody;
  assert.equal(body.revealed, 'Amy');
  assert.equal(body.you.reveals[0].keepers[0].playerName, 'N. Jokic');
  assert.equal(body.you.left, 0);

  // Spent, so no second look.
  assert.equal((await reveal('Joel')).status, 409);

  // The poll payload never carries the ledger, and Amy's keepers stay hidden there.
  const state = (await request('/api/league/state', { headers: auth('Joel') })).body as {
    state: Record<string, unknown> & { keepers: Record<string, unknown> };
  };
  assert.equal(state.state.achievements, undefined);
  assert.equal(state.state.keepers.Amy, undefined);

  // Nobody else sees Joel's reveal.
  assert.equal((await achievements('Ryan')).you.reveals.length, 0);
});

test('the commissioner has nothing to reveal', async () => {
  await saveMock('Brey', 'mock-b-1', 'C');
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
  });
  assert.equal((await achievements('Brey')).you.check.reason, 'commish');
  assert.equal((await reveal('Brey')).status, 409);
});

test('no reveals once keepers are public', async () => {
  await saveMock('Joel', 'mock-a-1', 'C');
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
    draft.keepersRevealed = true;
  });
  assert.equal((await reveal('Joel')).status, 409);
});

// ─── Prop bets ─────────────────────────────────────────────────────────────

const warriors = { subject: 'Amy', kind: 'team', target: 'GS', line: 1.5 };

test('anyone can read props; setting one needs a sign-in', async () => {
  assert.equal((await request('/api/league/prop-bets')).status, 200);
  const anon = await request('/api/league/prop-bets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(warriors),
  });
  assert.equal(anon.status, 401);
});

test('setting a prop earns BOOKIE, and taking it down keeps it', async () => {
  const set = await setProp('Ryan', warriors);
  assert.equal(set.status, 200);
  const prop = (set.body.props as PropBet[])[0];
  assert.equal(prop.createdBy, 'Ryan');

  assert.equal((await setProp('Joel', warriors)).status, 409, 'the same prop twice');
  assert.equal((await setProp('Joel', { ...warriors, line: 2 })).status, 400, 'lines end in .5');

  const gone = await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Ryan') });
  assert.equal(gone.status, 200);
  assert.ok((await achievements('Ryan')).you.earned['prop-bet']);
});

test('members take sides; only the setter or commissioner takes a prop down', async () => {
  const prop = ((await setProp('Ryan', warriors)).body.props as PropBet[])[0];
  const take = await request(`/api/league/prop-bets/${prop.id}/take`, {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ side: 'under' }),
  });
  assert.equal(take.status, 200);
  assert.deepEqual((take.body.props as PropBet[])[0].takes.map((t) => [t.owner, t.side]), [['Amy', 'under']]);

  const bad = await request(`/api/league/prop-bets/${prop.id}/take`, {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ side: 'sideways' }),
  });
  assert.equal(bad.status, 400);

  assert.equal((await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Amy') })).status, 403);
  assert.equal((await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Brey') })).status, 200);
});

test('props lock at the draft and the board settles them', async () => {
  // One Warriors prop on every team, so whoever holds pick 1 has one.
  for (const subject of Object.keys(pins)) {
    assert.equal((await setProp('Ryan', { ...warriors, subject, line: 0.5 })).status, 200);
  }
  await store.mutateState((draft) => {
    draft.draft.startedAt = new Date().toISOString();
    draft.draft.picks = { '1': { playerKey: 'x', playerName: 'S. Curry', proTeam: 'GS', positions: ['PG'] } };
  });

  assert.equal((await setProp('Joel', { ...warriors, line: 3.5 })).status, 409);
  const body = (await request('/api/league/prop-bets')).body as {
    locked: boolean;
    tallies: Record<string, { count: number; result: string | null }>;
  };
  assert.equal(body.locked, true);
  const tallies = Object.values(body.tallies);
  assert.equal(tallies.reduce((n, t) => n + t.count, 0), 1);
  assert.deepEqual(tallies.filter((t) => t.result === 'over').length, 1);
  assert.equal(tallies.filter((t) => t.result === 'under').length, 0, 'unders wait for the draft to end');
});
