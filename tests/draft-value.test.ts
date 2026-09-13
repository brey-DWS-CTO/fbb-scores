import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027.json' with { type: 'json' };
import type { DatasetPlayer, LeagueDataset } from '../src/lib/keeper/types.ts';
import type { EspnDraftRankingPlayer, ScoringItem } from '../src/lib/league/draftRankings.ts';
import {
  DEFAULT_ROSTER,
  UNDRAFTED_ADP,
  fillsSlot,
  fitRankToPoints,
  pointsForRank,
  positionsOf,
  realAdp,
  replacementLevels,
  roomRankOf,
  scheduleGames,
  slotsFor,
  starterCount,
  starterSlotList,
  valueBoard,
  type RosterSettings,
} from '../src/lib/league/draftValue.ts';
import type { LeagueSchedulePeriod } from '../src/lib/league/schedule.ts';
import { NBA_TEAMS } from '../src/lib/league/schedule.ts';
import { leagueSchedule2027 } from '../src/lib/league/scheduleData.ts';

const dataset = rawDataset as unknown as LeagueDataset;

// Points and assists only, so the arithmetic can be done in the head.
const SCORING: ScoringItem[] = [
  { statId: 0, points: 1 },
  { statId: 3, points: 2 },
];

function player(over: Partial<DatasetPlayer> & { key: string; espnId: number | null }): DatasetPlayer {
  return {
    name: over.key,
    fullName: over.key,
    positions: ['PG'],
    proTeam: 'FA',
    injuryStatus: null,
    fantasyTeam: null,
    stats2026: null,
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
    ...over,
  };
}

const last = (avg: number, gp = 60) => ({ total: avg * gp, avg, gp });

function espn(over: Partial<EspnDraftRankingPlayer> & { espnId: number }): EspnDraftRankingPlayer {
  return {
    fullName: `Player ${over.espnId}`,
    proTeam: 'FA',
    adp: null,
    percentOwned: null,
    standard: null,
    roto: null,
    projection: null,
    ...over,
  };
}

const ranked = (espnId: number, rank: number, adp: number | null = null) =>
  espn({ espnId, adp, standard: { rank, auctionValue: null } });

/** A pool with a real season behind every player, enough to fit the bridge. */
function pool(count = 20): DatasetPlayer[] {
  return Array.from({ length: count }, (_, index) =>
    player({ key: `p${index + 1}`, espnId: index + 1, stats2026: last(50 - index * 2) }));
}

// ─── Positions and slots ───────────────────────────────────────────────────

test('positions map to the slots the rule book starts', () => {
  assert.deepEqual(positionsOf({ positions: ['pg', 'SG', 'nonsense'] }), ['PG', 'SG']);
  assert.deepEqual(slotsFor(['C']), ['C', 'FLEX']);
  assert.deepEqual(slotsFor(['SF', 'PF']), ['PF', 'SF', 'F', 'FLEX']);
  assert.deepEqual(slotsFor(['PG', 'SG']), ['SG', 'PG', 'G', 'FLEX']);
  assert.equal(fillsSlot(['C'], 'G'), false);
  assert.equal(fillsSlot(['C'], 'FLEX'), true);
});

test('the default roster is 10 starters: C, PF, SF, SG, PG, F, G and three FLEX', () => {
  assert.equal(starterCount(DEFAULT_ROSTER), 10);
  assert.deepEqual(starterSlotList(DEFAULT_ROSTER), ['C', 'PF', 'SF', 'SG', 'PG', 'F', 'G', 'FLEX', 'FLEX', 'FLEX']);
  assert.equal(DEFAULT_ROSTER.weeklyGameLimit, 30);
  assert.equal(DEFAULT_ROSTER.teamCount, 10);
});

// ─── Rank to points ────────────────────────────────────────────────────────

test('the rank bridge never rises as the rank gets worse, and reads between fitted points', () => {
  const pairs = [
    { rank: 1, points: 60 },
    { rank: 2, points: 50 },
    { rank: 3, points: 55 },
    { rank: 4, points: 40 },
    { rank: 5, points: 42 },
    { rank: 6, points: 30 },
    { rank: 7, points: 31 },
    { rank: 8, points: 20 },
    { rank: 9, points: 22 },
    { rank: 10, points: 10 },
  ];
  const bridge = fitRankToPoints(pairs);
  assert.ok(bridge);
  assert.equal(bridge.pairs, 10);
  for (let index = 1; index < bridge.points.length; index += 1) {
    assert.ok(bridge.points[index] <= bridge.points[index - 1], 'a worse rank never fits more points');
  }
  assert.equal(pointsForRank(bridge, 1), 60, 'the best rank keeps its own number');
  assert.equal(pointsForRank(bridge, 0), 60, 'before the first rank takes the first value');
  assert.equal(pointsForRank(bridge, 99), 10, 'past the last rank takes the last value');
  // Ranks 2 and 3 pool to 52.5 at centre 2.5; ranks 4 and 5 pool to 41 at 4.5.
  assert.equal(pointsForRank(bridge, 2.5), 52.5);
  assert.equal(pointsForRank(bridge, 3.5), 46.75, 'halfway between two centres');
  const between = pointsForRank(bridge, 6.5);
  assert.ok(between < pointsForRank(bridge, 5) && between > pointsForRank(bridge, 8), 'reads strictly downhill between blocks');
});

test('too few pairs is no bridge, and a rank then cannot be valued', () => {
  assert.equal(fitRankToPoints([{ rank: 1, points: 50 }, { rank: 2, points: 40 }]), null);
  const board = valueBoard(
    [player({ key: 'a', espnId: 1 }), player({ key: 'b', espnId: 2, stats2026: last(30) })],
    { players: [ranked(1, 1), ranked(2, 2)], scoringItems: [] },
  );
  const a = board.entries.find((entry) => entry.player.key === 'a')!;
  const b = board.entries.find((entry) => entry.player.key === 'b')!;
  assert.equal(a.source, 'none', 'ranked but nothing to turn the rank into points');
  assert.equal(b.source, 'last-season');
});

// ─── Replacement level ─────────────────────────────────────────────────────

test('a scarce position gets a lower replacement level than a deep one', () => {
  // One team, one of each slot: C, PF, SF, SG, PG, F, G, FLEX x3.
  const roster: RosterSettings = { ...DEFAULT_ROSTER, teamCount: 1 };
  const players = [
    { fppg: 50, positions: ['C'] as const },
    { fppg: 48, positions: ['PG'] as const },
    { fppg: 46, positions: ['PG'] as const },
    { fppg: 44, positions: ['PG'] as const },
    { fppg: 42, positions: ['SG'] as const },
    { fppg: 40, positions: ['SF'] as const },
    { fppg: 38, positions: ['PF'] as const },
    { fppg: 36, positions: ['PG'] as const },
    { fppg: 34, positions: ['SG'] as const },
    { fppg: 32, positions: ['SF'] as const },
    // Left over once the ten slots are full:
    { fppg: 30, positions: ['PG'] as const },
    { fppg: 20, positions: ['SF', 'PF'] as const },
    { fppg: 15, positions: ['C'] as const },
  ];
  const levels = replacementLevels(players, roster);
  assert.equal(levels.PG, 30, 'the best point guard left over');
  assert.equal(levels.SF, 20);
  assert.equal(levels.PF, 20);
  assert.equal(levels.C, 15, 'centres ran out, so the next one is far down');
  assert.equal(levels.SG, 0, 'no shooting guard left over at all');
});

test('a player takes the most specific open slot first, leaving FLEX for others', () => {
  const roster: RosterSettings = {
    starters: { C: 1, PF: 0, SF: 0, SG: 0, PG: 0, F: 0, G: 0, FLEX: 1 },
    bench: 0,
    teamCount: 1,
    weeklyGameLimit: 30,
  };
  const levels = replacementLevels(
    [
      { fppg: 40, positions: ['C'] },
      { fppg: 30, positions: ['PG'] },
      { fppg: 20, positions: ['C'] },
      { fppg: 10, positions: ['PG'] },
    ],
    roster,
  );
  assert.equal(levels.C, 20, 'the first centre took C, not FLEX, so the guard got FLEX');
  assert.equal(levels.PG, 10);
});

// ─── The schedule ──────────────────────────────────────────────────────────

function period(leagueWeek: number, games: (teamId: number) => number, over: Partial<LeagueSchedulePeriod> = {}): LeagueSchedulePeriod {
  return {
    leagueWeek,
    label: `Week ${leagueWeek}`,
    phase: 'regular',
    sourceNbaWeeks: [leagueWeek],
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    combinesAllStarBreak: false,
    gamesByTeamId: Object.fromEntries(NBA_TEAMS.map((team) => [team.espnId, games(team.espnId)])),
    ...over,
  };
}

test('a heavy week counts each game at the share the game limit lets ten starters use', () => {
  // Every team plays 4: forty starter games against a limit of 30, so 3/4 each.
  const heavy = period(1, () => 4);
  const games = scheduleGames([heavy], DEFAULT_ROSTER);
  assert.equal(games.byTeamId[1], 3);
  assert.equal(games.leagueAverage, 3);
});

test('a light week counts every game in full, and a two-game team gets two', () => {
  const light = period(1, (teamId) => (teamId === 1 ? 2 : 3));
  const games = scheduleGames([light], DEFAULT_ROSTER);
  assert.equal(games.byTeamId[1], 2);
  assert.equal(games.byTeamId[2], 3);
});

test('a period over two NBA weeks gets two weeks of limit, and phase weights apply', () => {
  const twoWeeks = period(18, () => 6, { phase: 'fantasy-play-in', sourceNbaWeeks: [18, 19] });
  const plain = scheduleGames([twoWeeks], DEFAULT_ROSTER);
  assert.equal(plain.byTeamId[1], 6, 'sixty starter games against a sixty limit is full value');
  const weighted = scheduleGames([twoWeeks], DEFAULT_ROSTER, { regular: 1, 'fantasy-play-in': 0.5, 'fantasy-playoff': 2 });
  assert.equal(weighted.byTeamId[1], 3);
});

// ─── The value board ───────────────────────────────────────────────────────

test('sources fall through in board order and every entry says which one it used', () => {
  const players = [
    ...pool(12),
    player({ key: 'rookie', espnId: 100 }),
    player({ key: 'nobody', espnId: 101 }),
  ];
  const snapshot = {
    players: [
      espn({
        espnId: 1,
        standard: { rank: 1, auctionValue: null },
        projection: { id: '102027', stats: { 0: 300, 3: 50, 42: 10 }, averageStats: null },
      }),
      ...players.slice(1, 12).map((entry, index) => ranked(entry.espnId!, index + 2)),
      ranked(100, 6),
    ],
    scoringItems: SCORING,
  };
  const board = valueBoard(players, snapshot);
  const byKey = new Map(board.entries.map((entry) => [entry.player.key, entry]));
  assert.equal(byKey.get('p1')!.source, 'projection');
  assert.equal(byKey.get('p1')!.fppg, 40, '300 + 2 x 50 over 10 games, in our scoring');
  assert.equal(byKey.get('p2')!.source, 'espn-rank');
  assert.equal(byKey.get('rookie')!.source, 'espn-rank', 'no season behind him, but ESPN ranked him');
  assert.equal(byKey.get('nobody')!.source, 'none');
  assert.equal(board.entries[board.entries.length - 1].player.key, 'nobody', 'nothing valued him, so he is last');
  assert.equal(byKey.get('nobody')!.rank, board.entries.length);
  assert.deepEqual(board.order, ['projection', 'espn-rank', 'last-season']);
  assert.equal(board.primary, 'projection');
  assert.equal(board.counts.none, 1);
});

test('preferring last season reorders the board and relabels the entries', () => {
  const players = pool(12);
  const snapshot = { players: players.map((entry, index) => ranked(entry.espnId!, 12 - index)), scoringItems: [] };
  const byEspn = valueBoard(players, snapshot);
  const byLast = valueBoard(players, snapshot, { prefer: 'last-season' });
  assert.equal(byEspn.primary, 'espn-rank');
  assert.equal(byLast.primary, 'last-season');
  assert.deepEqual(byLast.order, ['last-season', 'projection', 'espn-rank']);
  assert.equal(byLast.entries[0].player.key, 'p1', 'p1 scored the most last season');
  assert.equal(byEspn.entries[0].player.key, 'p12', 'ESPN ranks p12 first');
  assert.ok(byLast.entries.every((entry) => entry.source === 'last-season'));
});

test('with no snapshot at all, last season values everyone and says so', () => {
  const board = valueBoard(pool(5), null);
  assert.equal(board.primary, 'last-season');
  assert.equal(board.bridge, null);
  assert.ok(board.entries.every((entry) => entry.source === 'last-season'));
  assert.equal(board.entries[0].player.key, 'p1');
});

test('season value is points over an average-schedule replacement, by hand', () => {
  // One team, one slot, three players: the third is the replacement.
  const roster: RosterSettings = {
    starters: { C: 0, PF: 0, SF: 0, SG: 0, PG: 0, F: 0, G: 0, FLEX: 2 },
    bench: 0,
    teamCount: 1,
    weeklyGameLimit: 30,
  };
  const players = [
    player({ key: 'a', espnId: 1, proTeam: 'ATL', stats2026: last(40) }),
    player({ key: 'b', espnId: 2, proTeam: 'BOS', stats2026: last(30) }),
    player({ key: 'c', espnId: 3, proTeam: 'FA', stats2026: last(20) }),
  ];
  // Every team plays 3 in the one week, except Atlanta plays 2. Two starters
  // against a limit of 30 means every game counts in full.
  const week = period(1, (teamId) => (teamId === 1 ? 2 : 3));
  const board = valueBoard(players, null, { roster, schedule: [week] });
  const a = board.entries.find((entry) => entry.player.key === 'a')!;
  const b = board.entries.find((entry) => entry.player.key === 'b')!;
  assert.equal(board.replacement.PG, 20);
  assert.equal(a.weightedGames, 2);
  assert.equal(b.weightedGames, 3);
  const average = board.leagueAverageGames;
  assert.ok(Math.abs(average - (29 * 3 + 2) / 30) < 1e-9);
  assert.equal(a.perGame, 20);
  assert.equal(a.seasonValue, Math.round((40 * 2 - 20 * average) * 10) / 10);
  assert.equal(b.seasonValue, Math.round((30 * 3 - 20 * average) * 10) / 10);
  assert.ok(b.seasonValue! > a.seasonValue!, 'the better player on a two-game week is worth less that week');
  assert.ok(a.scheduleRatio < 1 && b.scheduleRatio > 1);
});

test('a projection scores through our scoring items, not ESPN rank, and its games set availability', () => {
  const players = pool(12);
  const projected = espn({
    espnId: 12,
    standard: { rank: 12, auctionValue: null },
    projection: { id: '102027', stats: { 0: 2050, 3: 0, 42: 41 }, averageStats: null },
  });
  const snapshot = {
    players: [...players.slice(0, 11).map((entry, index) => ranked(entry.espnId!, index + 1)), projected],
    scoringItems: SCORING,
  };
  const board = valueBoard(players, snapshot);
  const twelve = board.entries.find((entry) => entry.player.key === 'p12')!;
  assert.equal(twelve.source, 'projection');
  assert.equal(twelve.fppg, 50, '2050 points over 41 games');
  assert.equal(twelve.availability, 0.5, '41 of 82 games');
  assert.equal(board.entries.find((entry) => entry.player.key === 'p1')!.availability, 1);
  const doubled = valueBoard(players, { ...snapshot, scoringItems: [{ statId: 0, points: 2 }] });
  assert.equal(doubled.entries.find((entry) => entry.player.key === 'p12')!.fppg, 100, 'the scoring decides');
});

test('an undrafted ADP is not a real one; the room then reads ESPN rank held at the floor', () => {
  assert.equal(realAdp(12.4), 12.4);
  assert.equal(realAdp(139.9), null);
  assert.equal(realAdp(0), null);
  assert.equal(roomRankOf(6, 12.4), 12.4);
  assert.equal(roomRankOf(100, 139.9), UNDRAFTED_ADP, 'ranked 100 but never drafted means the room passes until the list runs out');
  assert.equal(roomRankOf(200, 140), 200);
  assert.equal(roomRankOf(null, 140), null);
  assert.equal(roomRankOf(50, 139.9, 150), 139.9, 'the floor is a setting: under 150 this ADP is real');
  assert.equal(roomRankOf(50, 160, 150), 150);
});

// ─── Against the real numbers ──────────────────────────────────────────────

const REAL = { players: fixture.players.map((entry) => ({ ...entry, projection: null })), scoringItems: [] };

test('real ESPN data: half the ranked players carry the undrafted ADP marker', () => {
  const rankedPlayers = fixture.players.filter((entry) => entry.standard !== null);
  const undrafted = rankedPlayers.filter((entry) => entry.adp !== null && entry.adp >= UNDRAFTED_ADP);
  assert.ok(rankedPlayers.length > 350, `ESPN ranks ${rankedPlayers.length} players`);
  assert.ok(undrafted.length > rankedPlayers.length / 3, `${undrafted.length} ranked players are marked undrafted`);
  const realAdps = fixture.players.filter((entry) => realAdp(entry.adp) !== null);
  assert.ok(realAdps.length < 200, `only ${realAdps.length} players have an ADP that means anything`);
});

test('real ESPN data: the board values the stars first, by ESPN rank, with a bridge fitted on hundreds of players', () => {
  const board = valueBoard(dataset.players, REAL, { schedule: leagueSchedule2027 });
  assert.equal(board.primary, 'espn-rank');
  assert.ok(board.bridge && board.bridge.pairs > 200, 'the bridge is fitted on real seasons');
  assert.equal(board.entries[0].player.name, 'N. Jokic');
  assert.equal(board.entries[0].fppg, 64.2, 'ESPN rank 1 maps to the top number in our scoring');
  const topFive = board.entries.slice(0, 5).map((entry) => entry.player.name);
  for (const name of ['S. Gilgeous-Alexander', 'V. Wembanyama', 'G. Antetokounmpo', 'L. Doncic']) {
    assert.ok(topFive.includes(name), `${name} is in the top five: ${topFive.join(', ')}`);
  }
  for (let rank = 2; rank <= 388; rank += 1) {
    assert.ok(pointsForRank(board.bridge, rank) <= pointsForRank(board.bridge, rank - 1), `rank ${rank} never beats rank ${rank - 1}`);
  }
  for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
    assert.ok(board.replacement[position] > 20 && board.replacement[position] < 35, `${position} replacement is a real bench number`);
  }
  assert.ok(board.entries.every((entry) => entry.scheduleRatio > 0.95 && entry.scheduleRatio < 1.05), 'the schedule nudges, it does not swing');
  const unvalued = board.entries.filter((entry) => entry.source === 'none');
  assert.ok(unvalued.length < 5, `almost everyone gets a number: ${unvalued.map((entry) => entry.player.name).join(', ')}`);
  assert.ok(unvalued.every((entry) => entry.rank > board.entries.length - unvalued.length), 'and the rest go last');
});

test('real ESPN data: last season and ESPN rank disagree, which is why the switch exists', () => {
  const byEspn = valueBoard(dataset.players, REAL);
  const byLast = valueBoard(dataset.players, REAL, { prefer: 'last-season' });
  const place = (board: typeof byEspn, name: string) => board.entries.find((entry) => entry.player.name === name)!.rank;
  assert.ok(place(byLast, 'T. Maxey') < place(byEspn, 'T. Maxey') - 5, 'Maxey scored like a top-five player for us; ESPN ranks him 21st');
  assert.ok(place(byLast, 'K. Leonard') < place(byEspn, 'K. Leonard') - 20, 'Kawhi too');
  assert.equal(byEspn.counts['espn-rank'] + byEspn.counts['last-season'] + byEspn.counts.none, dataset.players.length);
});
