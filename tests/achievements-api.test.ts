import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import type { PropBet } from '../src/lib/league/propBets.ts';

const dataset = rawDataset as unknown as LeagueDataset;

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
    teams: Array<{ target: string; keeping: number; shown: Array<{ playerKey: string; playerName: string | null }> }>;
  };
  standings: Array<{ owner: string; earned: number; revealed: number }>;
  revealed?: { target: string; playerKey: string };
}

const achievements = async (owner: string) =>
  (await request('/api/league/achievements', { headers: auth(owner) })).body as unknown as AchievementsBody;

const reveal = (owner: string) =>
  request('/api/league/achievements/reveal', { method: 'POST', headers: auth(owner) });

const setProp = (owner: string, input: Record<string, unknown>) =>
  request('/api/league/prop-bets', { method: 'POST', headers: auth(owner), body: JSON.stringify(input) });

/** A finished mock. Rank 1 of 10 grades A+, 2 grades A, 7 grades C+. */
async function saveMock(owner: string, id: string, rank: number, extra: Record<string, unknown> = {}) {
  const { steal, ...rest } = extra;
  await store.saveMockResult(
    {
      season: SEASON,
      owner,
      id,
      result: { id, grade: { rank, teams: 10, steal: steal ?? null }, ...rest },
      createdAt: new Date().toISOString(),
    },
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
    draft.achievements = { earned: {}, reveals: {}, firstGuesses: {}, seen: {} };
    draft.propBets = [];
    draft.commishBlind = false;
  });
  for (const owner of Object.keys(pins)) {
    for (const row of await store.listMockResults(SEASON, owner)) {
      await store.deleteMockResult(SEASON, owner, row.id);
    }
    await store.clearKeeperScenario(SEASON, owner);
  }
});

// ─── Achievements ──────────────────────────────────────────────────────────

test('signing in is required', async () => {
  assert.equal((await request('/api/league/achievements')).status, 401);
  assert.equal((await request('/api/league/achievements/reveal', { method: 'POST' })).status, 401);
});

// The mock log is never trimmed, so each test below uses its own owner.

test('past work counts: a saved A mock earns two achievements', async () => {
  await saveMock('Derek', 'mock-d-1', 2);
  const body = await achievements('Derek');
  assert.ok(body.you.earned['first-mock']);
  assert.ok(body.you.earned['honor-roll']);
  assert.equal(body.you.earned.valedictorian, undefined);
  assert.equal(body.you.left, 2);
  assert.equal(body.standings[0].owner, 'Derek');
});

test('earned sticks after the mock that earned it is deleted', async () => {
  await saveMock('Dustin', 'mock-u-1', 5);
  assert.ok((await achievements('Dustin')).you.earned['first-mock']);
  await store.deleteMockResult(SEASON, 'Dustin', 'mock-u-1');
  assert.ok((await achievements('Dustin')).you.earned['first-mock']);
});

test('the never-trimmed mock log earns MOCK ADDICT past the ten kept rows', async () => {
  for (let i = 1; i <= 12; i += 1) await saveMock('Kyle', `mock-k-${i}`, 6);
  assert.equal((await store.listMockResults(SEASON, 'Kyle')).length, 10);
  const body = await achievements('Kyle');
  assert.ok(body.you.earned['ten-mocks']);
  assert.equal(body.you.earned.marathon, undefined);
});

test('THIEF and WHAT IF read the saved mock', async () => {
  await saveMock('Aaron', 'mock-r-1', 1, { steal: { name: 'X', label: '3.4', by: 16 }, tradesOn: ['pt-1'] });
  const earned = (await achievements('Aaron')).you.earned;
  assert.ok(earned.thief);
  assert.ok(earned['what-if']);
  assert.ok(earned.valedictorian, 'rank 1 of 10 is an A+');
});

test('a reveal waits until another team has keepers in', async () => {
  await saveMock('Patrick', 'mock-p-1', 7);
  const body = await achievements('Patrick');
  assert.equal(body.you.check.reason, 'nobody-ready');
  assert.equal((await reveal('Patrick')).status, 409);
});

test('a reveal shows one keeper, once, and only to the owner who spent it', async () => {
  await saveMock('Joel', 'mock-j-1', 7);
  await store.mutateState((draft) => {
    draft.keepers = {
      Amy: [
        { playerKey: 'p1', playerName: 'N. Jokic' },
        { playerKey: 'p2', playerName: 'S. Curry' },
      ],
    };
  });

  const spent = await reveal('Joel');
  assert.equal(spent.status, 200);
  const body = spent.body as unknown as AchievementsBody;
  assert.equal(body.revealed?.target, 'Amy');
  assert.equal(body.you.teams.length, 1);
  assert.equal(body.you.teams[0].keeping, 2);
  assert.equal(body.you.teams[0].shown.length, 1, 'one keeper, not the team');
  assert.ok(['N. Jokic', 'S. Curry'].includes(body.you.teams[0].shown[0].playerName ?? ''));
  assert.equal(body.you.left, 0);

  // Spent, so no second look.
  assert.equal((await reveal('Joel')).status, 409);

  // The board gets the one revealed keeper, never the other, and never the ledger.
  const shownKey = body.revealed?.playerKey;
  const state = (await request('/api/league/state', { headers: auth('Joel') })).body as {
    state: Record<string, unknown> & { keepers: Record<string, Array<{ playerKey: string }>> };
  };
  assert.equal(state.state.achievements, undefined);
  assert.deepEqual(state.state.keepers.Amy.map((k) => k.playerKey), [shownKey]);

  // Nobody else sees Joel's reveal, on the page or the board.
  assert.equal((await achievements('Ryan')).you.teams.length, 0);
  const ryan = (await request('/api/league/state', { headers: auth('Ryan') })).body as {
    state: { keepers: Record<string, unknown> };
  };
  assert.equal(ryan.state.keepers.Amy, undefined);
});

test('a whole-team reveal from the first cut gives the reveal back', async () => {
  await saveMock('Bryan', 'mock-y-1', 7);
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
    draft.achievements = {
      earned: {},
      reveals: { Bryan: [{ target: 'Amy', at: '2026-10-14T00:00:00.000Z' } as never] },
      firstGuesses: {},
      seen: {},
    };
  });
  assert.equal((await achievements('Bryan')).you.left, 1);
});

test('the commissioner has nothing to reveal', async () => {
  await saveMock('Brey', 'mock-b-1', 7);
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
  });
  assert.equal((await achievements('Brey')).you.check.reason, 'commish');
  assert.equal((await reveal('Brey')).status, 409);
});

test('no reveals once keepers are public', async () => {
  await store.mutateState((draft) => {
    draft.keepers = { Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }] };
    draft.keepersRevealed = true;
  });
  assert.equal((await reveal('Derek')).status, 409);
});

// ─── SCOUT and dues ────────────────────────────────────────────────────────

const kylePlayers = dataset.players.filter((p) => p.fantasyTeam === 'Kyle').slice(0, 2);

const guess = (owner: string, target: string, players: Array<{ key: string; name: string }>) =>
  request(`/api/league/keeper-scenario/${target}`, {
    method: 'PUT',
    headers: auth(owner),
    body: JSON.stringify({ selections: players.map((p) => ({ playerKey: p.key, playerName: p.name })) }),
  });

async function setKyleKeepers(players: Array<{ key: string; name: string }>) {
  await store.mutateState((draft) => {
    draft.keepers = { Kyle: players.map((p) => ({ playerKey: p.key, playerName: p.name })) };
  });
}

test('SCOUT: a right first guess counts', async () => {
  const [a] = kylePlayers;
  assert.equal((await guess('Joel', 'Kyle', [a])).status, 200);
  await setKyleKeepers([a]);
  assert.ok((await achievements('Joel')).you.earned.scout);
});

test('SCOUT: fixing a wrong guess later does not count', async () => {
  const [a, b] = kylePlayers;
  assert.equal((await guess('Joel', 'Kyle', [b])).status, 200);
  assert.equal((await guess('Joel', 'Kyle', [a])).status, 200, 'the fix still saves');
  await setKyleKeepers([a]);
  assert.equal((await achievements('Joel')).you.earned.scout, undefined);
});

test('SCOUT: a guess saved before tracking began counts as the first', async () => {
  const [a] = kylePlayers;
  await store.setKeeperScenarioTarget(SEASON, 'Ryan', 'Kyle', [{ playerKey: a.key, playerName: a.name }]);
  await setKyleKeepers([a]);
  assert.ok((await achievements('Ryan')).you.earned.scout);
});

test('SCOUT: the commissioner sees every keeper, so it never counts for him', async () => {
  const [a] = kylePlayers;
  assert.equal((await guess('Brey', 'Kyle', [a])).status, 200);
  await setKyleKeepers([a]);
  assert.equal((await achievements('Brey')).you.earned.scout, undefined);
});

test('PAID UP waits for the collector to confirm', async () => {
  const paid = await request('/api/league/dues/Amy', {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ action: 'paid' }),
  });
  assert.equal(paid.status, 200);
  assert.equal((await achievements('Amy')).you.earned.dues, undefined);
  const confirmed = await request('/api/league/dues/Amy', {
    method: 'POST',
    headers: auth('Brey'),
    body: JSON.stringify({ action: 'verify' }),
  });
  assert.equal(confirmed.status, 200);
  assert.ok((await achievements('Amy')).you.earned.dues);
});

test('the VAULT badge counts reveals you could spend now, for the viewer only', async () => {
  await saveMock('Derek', 'mock-d-1', 2);
  await store.mutateState((draft) => {
    draft.keepers = {
      Amy: [
        { playerKey: 'p1', playerName: 'N. Jokic' },
        { playerKey: 'p2', playerName: 'S. Curry' },
      ],
    };
  });
  await achievements('Derek');
  const meta = async (owner: string) =>
    ((await request('/api/league/state', { headers: auth(owner) })).body as unknown as { meta: { revealsReady: number } }).meta;
  assert.equal((await meta('Derek')).revealsReady, 2);
  assert.equal((await meta('Ryan')).revealsReady, 0);
});

test('CLOSE CALL: one keeper right on the first guess', async () => {
  const [a, b] = kylePlayers;
  assert.equal((await guess('Amy', 'Kyle', [a])).status, 200);
  await setKyleKeepers([a, b]);
  const earned = (await achievements('Amy')).you.earned;
  assert.ok(earned['close-call']);
  assert.equal(earned.scout, undefined);
});

test('news: fresh unlocks show once, then never again', async () => {
  await saveMock('Derek', 'mock-d-1', 2);
  const news = async () =>
    (await request('/api/league/achievements/news', { headers: auth('Derek') })).body as {
      fresh: string[];
      left: number;
      canReveal: boolean;
    };
  const first = await news();
  assert.deepEqual(first.fresh, ['first-mock', 'honor-roll']);
  assert.equal(first.left, 2);

  const seen = await request('/api/league/achievements/seen', {
    method: 'POST',
    headers: auth('Derek'),
    body: JSON.stringify({ ids: first.fresh }),
  });
  assert.equal(seen.status, 200);
  assert.deepEqual((await news()).fresh, []);

  // A new unlock later shows on its own.
  assert.equal((await setProp('Derek', { subject: 'Kyle', text: 'trades', line: 1.5 })).status, 200);
  assert.deepEqual((await news()).fresh, ['prop-bet']);
});

test('news needs a sign-in', async () => {
  assert.equal((await request('/api/league/achievements/news')).status, 401);
  assert.equal((await request('/api/league/achievements/seen', { method: 'POST' })).status, 401);
});

// ─── Commish blind mode ────────────────────────────────────────────────────

const goBlind = (owner: string, blind: boolean) =>
  request('/api/league/commish-blind', { method: 'POST', headers: auth(owner), body: JSON.stringify({ blind }) });

test('blind: only the commish can flip it', async () => {
  assert.equal((await goBlind('Joel', true)).status, 403);
  assert.equal((await goBlind('Brey', 'yes' as never)).status, 400);
});

test('blind: the commish stops seeing other keepers, and reveals work for him', async () => {
  const [a] = kylePlayers;
  await saveMock('Brey', 'mock-b-1', 7);
  await store.mutateState((draft) => {
    draft.keepers = {
      Brey: [],
      Amy: [{ playerKey: 'p1', playerName: 'N. Jokic' }],
    };
  });

  // Seeing all: Amy's keeper is right there, and no reveal.
  const before = (await request('/api/league/state', { headers: auth('Brey') })).body as {
    state: { keepers: Record<string, unknown> };
  };
  assert.ok(before.state.keepers.Amy);
  assert.equal((await reveal('Brey')).status, 409);

  assert.equal((await goBlind('Brey', true)).status, 200);
  const after = (await request('/api/league/state', { headers: auth('Brey') })).body as {
    state: { keepers: Record<string, unknown> };
    meta: { commishBlind: boolean; isCommissioner: boolean };
  };
  assert.equal(after.state.keepers.Amy, undefined);
  assert.equal(after.meta.commishBlind, true);
  assert.equal(after.meta.isCommissioner, true, 'still the commish for everything else');

  // Members never learn he went blind.
  const joel = (await request('/api/league/state', { headers: auth('Joel') })).body as { meta: { commishBlind: boolean } };
  assert.equal(joel.meta.commishBlind, false);

  const spent = await reveal('Brey');
  assert.equal(spent.status, 200);
  assert.equal((spent.body as unknown as AchievementsBody).revealed?.target, 'Amy');

  // He cannot overwrite a team he cannot see.
  const edit = await request('/api/league/keepers/Kyle', {
    method: 'PUT',
    headers: auth('Brey'),
    body: JSON.stringify({ selections: [{ playerKey: a.key, playerName: a.name }] }),
  });
  assert.equal(edit.status, 409);

  // And the log does not name anyone's keepers.
  await store.appendAudit('Amy', 'keepers.set', { target: 'Amy', selections: [{ playerKey: 'p1', playerName: 'N. Jokic' }] });
  const audit = JSON.stringify((await request('/api/league/audit', { headers: auth('Brey') })).body);
  assert.ok(!audit.includes('N. Jokic'));

  assert.equal((await goBlind('Brey', false)).status, 200);
  const back = JSON.stringify((await request('/api/league/audit', { headers: auth('Brey') })).body);
  assert.ok(back.includes('N. Jokic'), 'seeing again restores the log');
});

test('blind: SCOUT counts for the commish', async () => {
  const [a] = kylePlayers;
  assert.equal((await goBlind('Brey', true)).status, 200);
  assert.equal((await guess('Brey', 'Kyle', [a])).status, 200);
  await setKyleKeepers([a]);
  assert.ok((await achievements('Brey')).you.earned.scout);
  assert.equal((await goBlind('Brey', false)).status, 200);
});

// ─── Prop bets ─────────────────────────────────────────────────────────────

const rules = { subject: 'Kyle', text: 'times he asks about the rules', line: 3.5 };

const propsFor = async (owner: string) =>
  (await request('/api/league/prop-bets', { headers: auth(owner) })).body.props as PropBet[];

test('props need a sign-in, even to read', async () => {
  assert.equal((await request('/api/league/prop-bets')).status, 401);
  const anon = await request('/api/league/prop-bets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rules),
  });
  assert.equal(anon.status, 401);
});

test('nobody sees a prop about themselves, the commissioner included', async () => {
  assert.equal((await setProp('Ryan', rules)).status, 200);
  assert.equal((await setProp('Ryan', { ...rules, subject: 'Brey', text: 'mid draft trades he offers' })).status, 200);

  assert.equal((await propsFor('Joel')).length, 2);
  assert.deepEqual((await propsFor('Kyle')).map((p) => p.subject), ['Brey']);
  assert.deepEqual((await propsFor('Brey')).map((p) => p.subject), ['Kyle']);

  // Nor can he reach one by id, or read its words in the audit log.
  const hidden = (await propsFor('Joel')).find((p) => p.subject === 'Brey')!;
  const take = await request(`/api/league/prop-bets/${hidden.id}/take`, {
    method: 'POST',
    headers: auth('Brey'),
    body: JSON.stringify({ side: 'over' }),
  });
  assert.equal(take.status, 404);
  const audit = JSON.stringify(await store.readAudit(50));
  assert.ok(!audit.includes('mid draft trades'));
});

test('you cannot set a prop on yourself', async () => {
  assert.equal((await setProp('Kyle', rules)).status, 400);
});

test('lines have no default and must end in .5', async () => {
  assert.equal((await setProp('Joel', { ...rules, line: '' })).status, 400);
  assert.equal((await setProp('Joel', { ...rules, line: 2 })).status, 400);
});

test('setting a prop earns BOOKIE, and taking it down keeps it', async () => {
  const set = await setProp('Ryan', rules);
  assert.equal(set.status, 200);
  const prop = (set.body.props as PropBet[])[0];
  assert.equal((await setProp('Joel', rules)).status, 409, 'the same prop twice');
  const gone = await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Ryan') });
  assert.equal(gone.status, 200);
  assert.ok((await achievements('Ryan')).you.earned['prop-bet']);
});

test('members take sides; only the setter or commissioner takes a prop down', async () => {
  const prop = ((await setProp('Ryan', rules)).body.props as PropBet[])[0];
  const take = await request(`/api/league/prop-bets/${prop.id}/take`, {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ side: 'under' }),
  });
  assert.equal(take.status, 200);
  assert.deepEqual((take.body.props as PropBet[])[0].takes.map((t) => [t.owner, t.side]), [['Amy', 'under']]);
  assert.equal((await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Amy') })).status, 403);
  assert.equal((await request(`/api/league/prop-bets/${prop.id}`, { method: 'DELETE', headers: auth('Brey') })).status, 200);
});

test('sides lock at the draft; the setter or commissioner enters the result', async () => {
  const prop = ((await setProp('Ryan', rules)).body.props as PropBet[])[0];
  await store.mutateState((draft) => {
    draft.draft.startedAt = new Date().toISOString();
  });
  assert.equal((await setProp('Joel', { ...rules, line: 1.5 })).status, 409);
  const take = await request(`/api/league/prop-bets/${prop.id}/take`, {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ side: 'over' }),
  });
  assert.equal(take.status, 409);

  const settle = (owner: string, result: unknown) =>
    request(`/api/league/prop-bets/${prop.id}/result`, {
      method: 'POST',
      headers: auth(owner),
      body: JSON.stringify({ result }),
    });
  assert.equal((await settle('Amy', 4)).status, 403);
  assert.equal((await settle('Ryan', 2.5)).status, 400);
  const done = await settle('Brey', 4);
  assert.equal(done.status, 200);
  assert.equal((done.body.props as PropBet[])[0].result, 4);
});
