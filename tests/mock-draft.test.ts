import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027.json' with { type: 'json' };
import type { DatasetPlayer, LeagueDataset, LeagueDynamicState, PickSlot } from '../src/lib/keeper/types.ts';
import { DEFAULT_ROSTER, valueBoard, type RosterSettings } from '../src/lib/league/draftValue.ts';
import {
  MODE_PRESETS,
  availabilityAt,
  baseScore,
  buildMockBoard,
  defaultMockSettings,
  describeAvailability,
  describeRound,
  gaussian,
  keepersForMock,
  lineupFit,
  runSeed,
  seededRandom,
  simulateDraft,
  simulateMany,
  tendencyFor,
  type MockBoard,
  type MockDraftSettings,
} from '../src/lib/league/mockDraft.ts';
import { leagueSchedule2027 } from '../src/lib/league/scheduleData.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const OWNERS = dataset.teams.map((team) => team.owner);
const REAL = { players: fixture.players.map((entry) => ({ ...entry, projection: null })), scoringItems: [] };
const realValues = valueBoard(dataset.players, REAL, { schedule: leagueSchedule2027 });

function state(patch: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
    ...patch,
  };
}

const byName = (name: string): DatasetPlayer => {
  const found = dataset.players.find((player) => player.name === name);
  assert.ok(found, `fixture needs ${name}`);
  return found;
};
const select = (name: string) => ({ playerKey: byName(name).key, playerName: name });

function player(over: Partial<DatasetPlayer> & { key: string; espnId: number; positions: string[]; avg: number }): DatasetPlayer {
  const { avg, ...rest } = over;
  return {
    name: over.key,
    fullName: over.key,
    proTeam: 'FA',
    injuryStatus: null,
    fantasyTeam: null,
    stats2026: { total: avg * 60, avg, gp: 60 },
    api2026: null,
    prior: null,
    keeper: {
      eligible: false,
      round: null,
      rank: null,
      effectiveAvg: null,
      avgSource: 'none',
      usesPriorYear: false,
      zeroGp2026: false,
      contract: null,
      flags: [],
    },
    ...rest,
  };
}

/** A hand-built board: one owner per pick, in order, no keepers. */
function board(owners: readonly string[]): MockBoard {
  const slots = owners.map((owner, index): PickSlot => ({
    season: 2027,
    round: index + 1,
    slot: 1,
    overall: index + 1,
    originalOwner: owner,
    currentOwner: owner,
  }));
  return {
    season: 2027,
    slots: slots.map((pick) => ({ pick, keeper: null, made: null })),
    taken: [],
    rejected: [],
    assumedOwners: [],
    knownOwners: [...new Set(owners)],
  };
}

/** One team, no noise, always the best: a robot, so a test can predict it. */
function robot(owners: readonly string[], patch: Partial<MockDraftSettings['owners'][string]> = {}): MockDraftSettings {
  const settings = defaultMockSettings('sharp', owners, 3);
  for (const owner of owners) settings.owners[owner] = { noise: 0, topK: 1, ...patch };
  return settings;
}

// ─── Randomness ────────────────────────────────────────────────────────────

test('the generator repeats exactly for a seed and stays inside [0, 1)', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  const draws = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(draws, Array.from({ length: 1000 }, () => b()));
  assert.ok(draws.every((value) => value >= 0 && value < 1));
  assert.notDeepEqual(draws.slice(0, 5), Array.from({ length: 5 }, seededRandom(43)));
  assert.notEqual(runSeed(1, 0), runSeed(1, 1));
  assert.equal(runSeed(1, 5), runSeed(1, 5));
});

test('gaussian draws centre on zero with a spread of about one', () => {
  const random = seededRandom(7);
  const draws = Array.from({ length: 20000 }, () => gaussian(random));
  const mean = draws.reduce((total, value) => total + value, 0) / draws.length;
  const spread = Math.sqrt(draws.reduce((total, value) => total + (value - mean) ** 2, 0) / draws.length);
  assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
  assert.ok(Math.abs(spread - 1) < 0.03, `spread ${spread}`);
});

// ─── Keeper secrecy ────────────────────────────────────────────────────────

test('before the reveal another team real keeper never reaches the mock; the viewer own does', () => {
  const real = state({ keepers: { Dustin: [select('J. Tatum')], Brey: [select('C. Cunningham')] } });
  const sets = keepersForMock(dataset, { viewer: 'Brey', state: real, scenario: {} });
  assert.deepEqual(sets.keepers.Dustin, [], 'Tatum is hidden');
  assert.equal(sets.status.Dustin, 'assumed');
  assert.deepEqual(sets.keepers.Brey, [select('C. Cunningham')]);
  assert.equal(sets.status.Brey, 'known');

  const mock = buildMockBoard(dataset, { viewer: 'Brey', state: real, scenario: {} });
  assert.ok(!mock.taken.includes(byName('J. Tatum').key), 'Tatum is still on the board');
  assert.ok(mock.slots.filter((slot) => slot.pick.currentOwner === 'Dustin').every((slot) => slot.keeper === null));
  assert.ok(mock.taken.includes(byName('C. Cunningham').key));
  assert.deepEqual(mock.knownOwners, ['Brey']);
  assert.equal(mock.assumedOwners.length, 9);
});

test('a scenario guess fills the slot and is marked assumed, and the reveal turns real keepers known', () => {
  const real = state({ keepers: { Dustin: [select('J. Tatum')] } });
  const guessed = buildMockBoard(dataset, { viewer: 'Brey', state: real, scenario: { Dustin: [select('J. Tatum')] } });
  const dustinFirst = guessed.slots.find((slot) => slot.pick.round === 1 && slot.pick.currentOwner === 'Dustin')!;
  assert.equal(dustinFirst.keeper?.playerName, 'J. Tatum');
  assert.equal(dustinFirst.keeper?.status, 'assumed');

  const revealed = buildMockBoard(dataset, { viewer: 'Brey', state: { ...real, keepersRevealed: true }, scenario: {} });
  const known = revealed.slots.find((slot) => slot.pick.round === 1 && slot.pick.currentOwner === 'Dustin')!;
  assert.equal(known.keeper?.playerName, 'J. Tatum');
  assert.equal(known.keeper?.status, 'known');
  assert.equal(revealed.assumedOwners.length, 0);
});

test('the viewer own scenario entry is a what-if and beats their real selection', () => {
  const real = state({ keepers: { Brey: [select('C. Cunningham')] } });
  const noDeal = keepersForMock(dataset, { viewer: 'Brey', state: real, scenario: {} });
  assert.deepEqual(noDeal.keepers.Brey.map((selection) => selection.playerName), ['C. Cunningham']);
  const deal = keepersForMock(dataset, { viewer: 'Brey', state: real, scenario: { Brey: [] } });
  assert.deepEqual(deal.keepers.Brey, [], 'an empty what-if means keep nobody');
  assert.equal(deal.status.Brey, 'assumed');
});

test('an illegal keeper set is reported, not dropped in silence', () => {
  const clean = buildMockBoard(dataset, {
    viewer: 'Brey',
    state: state(),
    scenario: { Joel: [select('N. Jokic'), select('L. Doncic')] },
  });
  assert.equal(clean.rejected.length, 1);
  assert.equal(clean.rejected[0].owner, 'Joel');
  assert.equal(clean.rejected[0].status, 'assumed');
  assert.match(clean.rejected[0].errors.join(' '), /Amy's roster/);
  assert.ok(!clean.taken.includes(byName('N. Jokic').key), 'the whole set fell through, as the engine does');
  assert.ok(clean.slots.filter((slot) => slot.pick.currentOwner === 'Joel').every((slot) => slot.keeper === null));
});

// ─── Lineups ───────────────────────────────────────────────────────────────

test('a lineup seats players by moving others along, and names the slots nobody can fill', () => {
  const fit = lineupFit([['PG'], ['PG'], ['PG', 'SG'], ['C']], DEFAULT_ROSTER);
  assert.equal(fit.filled, 4, 'PG, G, SG and C');
  assert.deepEqual(fit.open, ['PF', 'SF', 'F', 'FLEX', 'FLEX', 'FLEX']);
  const guards = lineupFit([['PG'], ['PG'], ['PG'], ['PG'], ['PG'], ['PG']], DEFAULT_ROSTER);
  assert.equal(guards.filled, 5, 'PG, G and three FLEX; SG, SF, PF, C and F stay open');
  assert.deepEqual(guards.open, ['C', 'PF', 'SF', 'SG', 'F']);
});

// ─── Settings per owner ────────────────────────────────────────────────────

test('every owner starts identical and a change to one owner is a change to that owner only', () => {
  const settings = defaultMockSettings('realistic', OWNERS, 9);
  assert.deepEqual(Object.keys(settings.owners), OWNERS);
  assert.deepEqual(tendencyFor(settings, 'Kyle'), MODE_PRESETS.realistic);
  settings.owners.Kyle = { noise: 0.4, positionBias: { C: -0.2 } };
  const kyle = tendencyFor(settings, 'Kyle');
  assert.equal(kyle.noise, 0.4);
  assert.equal(kyle.adpWeight, MODE_PRESETS.realistic.adpWeight, 'the rest stays the preset');
  assert.deepEqual(kyle.positionBias, { C: -0.2 });
  assert.deepEqual(tendencyFor(settings, 'Brey'), MODE_PRESETS.realistic);
  assert.equal(tendencyFor({ ...settings, mode: 'sharp' }, 'Brey').adpWeight, 0);
});

test('an ADP follower and a value follower take different players from the same board', () => {
  const players = [
    player({ key: 'value', espnId: 1, positions: ['PG'], avg: 50 }),
    player({ key: 'room', espnId: 2, positions: ['PG'], avg: 40 }),
    player({ key: 'third', espnId: 3, positions: ['SG'], avg: 30 }),
  ];
  const snapshot = {
    players: [
      { espnId: 1, fullName: 'value', proTeam: 'FA', adp: 3, percentOwned: null, standard: null, roto: null, projection: null },
      { espnId: 2, fullName: 'room', proTeam: 'FA', adp: 1, percentOwned: null, standard: null, roto: null, projection: null },
    ],
    scoringItems: [],
  };
  const values = valueBoard(players, snapshot);
  assert.equal(values.entries[0].player.key, 'value');
  assert.equal(values.entries[0].roomRank, 3);
  const best = { valueRank: values.entries[0].rank, roomRank: values.entries[0].roomRank };
  assert.equal(baseScore(best, 0), 1);
  assert.equal(baseScore(best, 1), 3);
  assert.equal(baseScore(best, 0.5), 2);

  const sharp = simulateDraft({ board: board(['A']), values, settings: robot(['A']) });
  assert.equal(sharp.picks[0].playerKey, 'value');
  const room = simulateDraft({ board: board(['A']), values, settings: robot(['A'], { adpWeight: 1 }) });
  assert.equal(room.picks[0].playerKey, 'room');
});

test('a position bias pulls that position up for that owner alone', () => {
  const players = [
    player({ key: 'guard', espnId: 1, positions: ['PG'], avg: 50 }),
    player({ key: 'centre', espnId: 2, positions: ['C'], avg: 48 }),
  ];
  const values = valueBoard(players, null);
  const plain = simulateDraft({ board: board(['A', 'B']), values, settings: robot(['A', 'B']) });
  assert.equal(plain.picks[0].playerKey, 'guard');
  const settings = robot(['A', 'B']);
  settings.owners.A = { ...settings.owners.A, positionBias: { C: -0.6 } };
  const biased = simulateDraft({ board: board(['A', 'B']), values, settings });
  assert.equal(biased.picks[0].playerKey, 'centre', 'A likes centres');
  assert.equal(biased.picks[1].playerKey, 'guard');
});

// ─── Filling a roster ──────────────────────────────────────────────────────

const TINY: RosterSettings = {
  starters: { C: 1, PF: 0, SF: 0, SG: 0, PG: 0, F: 0, G: 0, FLEX: 1 },
  bench: 0,
  teamCount: 1,
  weeklyGameLimit: 30,
};

test('a team takes the player it still needs when the picks are running out', () => {
  // Two centres, so the centre replacement level is 8 and the first centre
  // is worth 2 over it, less than the guard's 5. Value alone says guard, guard.
  const players = [
    player({ key: 'pg1', espnId: 1, positions: ['PG'], avg: 50 }),
    player({ key: 'pg2', espnId: 2, positions: ['PG'], avg: 45 }),
    player({ key: 'c', espnId: 3, positions: ['C'], avg: 10 }),
    player({ key: 'c2', espnId: 4, positions: ['C'], avg: 8 }),
  ];
  const values = valueBoard(players, null, { roster: TINY });
  assert.deepEqual(values.entries.slice(0, 2).map((entry) => entry.player.key), ['pg1', 'c']);
  assert.equal(values.entries[1].perGame, 2);
  const result = simulateDraft({ board: board(['A', 'A']), values, settings: robot(['A']), roster: TINY });
  assert.deepEqual(result.picks.map((pick) => pick.playerKey), ['pg1', 'c'], 'the last pick has to be the centre');
  assert.deepEqual(result.lineups.A.open, []);
  assert.deepEqual(result.warnings, []);
});

test('a slot nobody left can fill is noticed and said', () => {
  const players = [
    player({ key: 'pg1', espnId: 1, positions: ['PG'], avg: 50 }),
    player({ key: 'pg2', espnId: 2, positions: ['PG'], avg: 45 }),
  ];
  const values = valueBoard(players, null, { roster: TINY });
  const result = simulateDraft({ board: board(['A', 'A']), values, settings: robot(['A']), roster: TINY });
  assert.deepEqual(result.picks.map((pick) => pick.playerKey), ['pg1', 'pg2']);
  assert.deepEqual(result.lineups.A.open, ['C']);
  assert.ok(result.warnings.some((warning) => /Nobody left on the board can start at C/.test(warning.message)));
  assert.ok(result.warnings.some((warning) => warning.overall === null && /unable to start a C/.test(warning.message)));
});

test('more open slots than picks left is noticed at the pick it becomes true', () => {
  const players = [
    player({ key: 'pg1', espnId: 1, positions: ['PG'], avg: 50 }),
    player({ key: 'c', espnId: 2, positions: ['C'], avg: 10 }),
  ];
  const values = valueBoard(players, null, { roster: TINY });
  const result = simulateDraft({ board: board(['A']), values, settings: robot(['A']), roster: TINY });
  assert.equal(result.warnings[0].overall, 1);
  assert.match(result.warnings[0].message, /1 pick left and 2 starting slots still open/);
});

test('an empty board leaves the pick empty and says so', () => {
  const values = valueBoard([player({ key: 'only', espnId: 1, positions: ['PG'], avg: 50 })], null);
  const result = simulateDraft({ board: board(['A', 'B']), values, settings: robot(['A', 'B']) });
  assert.equal(result.picks[1].how, 'empty');
  assert.match(result.warnings.map((warning) => warning.message).join(' '), /ran out of players/);
});

// ─── The board is an input ─────────────────────────────────────────────────

test('a board with a trade applied drafts for the new owner, so a what-if runs the same way', () => {
  const traded: LeagueDataset = {
    ...dataset,
    pickTrades: [...dataset.pickTrades, { date: '2026-09-12', round: 3, from: 'Brey', to: 'Kyle' }],
  };
  const before = buildMockBoard(dataset, { viewer: 'Brey', state: state(), scenario: {} });
  const after = buildMockBoard(traded, { viewer: 'Brey', state: state(), scenario: {} });
  const breyThird = (mock: MockBoard) => mock.slots.find((slot) => slot.pick.round === 3 && slot.pick.originalOwner === 'Brey')!;
  assert.equal(breyThird(before).pick.currentOwner, 'Brey');
  assert.equal(breyThird(after).pick.currentOwner, 'Kyle');

  const settings = defaultMockSettings('sharp', OWNERS, 1);
  const result = simulateDraft({ board: after, values: realValues, settings });
  const pick = result.picks.find((entry) => entry.round === 3 && entry.slot === breyThird(after).pick.slot)!;
  assert.equal(pick.owner, 'Kyle');
  assert.ok(result.rosters.Kyle.includes(pick.playerKey!));
  assert.equal(result.rosters.Kyle.length, 15, 'Kyle drafts one more than a full roster');
  assert.equal(result.rosters.Brey.length, 13);
});

// ─── Whole drafts on the real numbers ──────────────────────────────────────

test('the same seed gives the same draft; another seed gives another; every live pick is filled once', () => {
  const mock = buildMockBoard(dataset, { viewer: 'Brey', state: state(), scenario: { Joel: [select('N. Jokic')] } });
  const settings = defaultMockSettings('realistic', OWNERS, 11);
  const one = simulateDraft({ board: mock, values: realValues, settings });
  const again = simulateDraft({ board: mock, values: realValues, settings });
  assert.deepEqual(one.picks, again.picks);
  const other = simulateDraft({ board: mock, values: realValues, settings }, 12);
  assert.notDeepEqual(one.picks.map((pick) => pick.playerKey), other.picks.map((pick) => pick.playerKey));

  assert.equal(one.picks.length, 140);
  assert.ok(one.picks.every((pick) => pick.playerKey !== null));
  assert.equal(new Set(one.picks.map((pick) => pick.playerKey)).size, 140, 'nobody is drafted twice');
  assert.equal(one.picks[0].how, 'keeper');
  assert.equal(one.picks[0].keeperStatus, 'assumed');
  assert.equal(one.picks.filter((pick) => pick.how === 'keeper').length, 1);
  assert.equal(one.picks.filter((pick) => pick.playerName === 'N. Jokic').length, 1, 'a keeper is never drafted again');
  assert.equal(one.warnings.length, 0);
  assert.ok(Object.values(one.lineups).every((fit) => fit.open.length === 0), 'every team can start ten');
  assert.ok(Object.values(one.rosters).every((keys) => keys.length === 14));
  assert.equal(describeRound(one, 1)[0], '1.1 Joel: N. Jokic (assumed keeper)');
});

test('across many runs the odds add up, keepers never appear, and a later pick never has more on the board', () => {
  const mock = buildMockBoard(dataset, { viewer: 'Brey', state: state(), scenario: { Joel: [select('N. Jokic')] } });
  const settings = defaultMockSettings('realistic', OWNERS, 5);
  const results = simulateMany({ board: mock, values: realValues, settings }, 40);
  assert.equal(results.length, 40);
  assert.equal(new Set(results.map((result) => result.seed)).size, 40);

  const at2 = availabilityAt(results, 2);
  const at9 = availabilityAt(results, 9);
  assert.equal(at9.label, '1.9');
  assert.equal(at9.owner, 'Brey');
  assert.equal(at9.runs, 40);
  assert.ok(at9.rows.every((row) => row.availableShare > 0 && row.availableShare <= 1));
  assert.ok(!at9.rows.some((row) => row.playerName === 'N. Jokic'));
  assert.ok(Math.abs(at9.rows.reduce((total, row) => total + row.takenHereShare, 0) - 1) < 1e-9, 'somebody was taken at 1.9 in every run');
  const at2ByKey = new Map(at2.rows.map((row) => [row.playerKey, row.available]));
  for (const row of at9.rows) {
    assert.ok(row.available <= (at2ByKey.get(row.playerKey) ?? 0), `${row.playerName} cannot be there more often at 1.9 than at 1.2`);
  }
  assert.ok(at2.rows.every((row) => row.availableShare === 1), 'nothing has happened before the first live pick');
  assert.match(describeAvailability(at9, 3), /^1\.9 \(Brey\), 40 runs: .+ \d+%, .+ \d+%, .+ \d+%$/);
});
