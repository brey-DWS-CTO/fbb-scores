import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatasetPlayer } from '../src/lib/keeper/types.ts';
import {
  countRankings,
  lastSeasonFppg,
  normalizeDraftRankingPlayer,
  previewDraftRankingRefresh,
  projectedFppg,
  projectionStatId,
  rankBoard,
  rankSourceLabel,
  type DraftRankingPlayer,
  type EspnDraftRankingPlayer,
  type ScoringItem,
} from '../src/lib/league/draftRankings.ts';

// A points league that only counts points and assists, so the arithmetic in
// every assertion can be done in the head.
const SCORING: ScoringItem[] = [
  { statId: 0, points: 1 },
  { statId: 3, points: 2 },
];

function player(over: Partial<DatasetPlayer> & { key: string; espnId: number | null }): DatasetPlayer {
  return {
    name: over.key,
    fullName: over.key,
    positions: ['PG'],
    proTeam: 'AAA',
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

function espn(over: Partial<EspnDraftRankingPlayer> & { espnId: number }): EspnDraftRankingPlayer {
  return {
    fullName: `Player ${over.espnId}`,
    proTeam: 'AAA',
    adp: null,
    percentOwned: null,
    standard: null,
    roto: null,
    projection: null,
    ...over,
  };
}

const withProjection = (espnId: number, pts: number, ast: number, gp = 10): EspnDraftRankingPlayer =>
  espn({
    espnId,
    projection: { id: '102027', stats: { 0: pts * gp, 3: ast * gp, 42: gp }, averageStats: null },
  });

const names = (ranking: ReturnType<typeof rankBoard>) => ranking.entries.map((e) => e.player.key);
const sources = (ranking: ReturnType<typeof rankBoard>) => ranking.entries.map((e) => e.source);

// ─── The projection id ─────────────────────────────────────────────────────

test('the projection row is keyed on the season, so it starts working on its own', () => {
  assert.equal(projectionStatId(2027), '102027');
  assert.equal(projectionStatId(2028), '102028');
});

// ─── Projected points ──────────────────────────────────────────────────────

test('projected FPPG is the scoring items times the stat dict, per game', () => {
  const row = { id: '102027', stats: { 0: 300, 3: 50, 42: 10 }, averageStats: null };
  assert.equal(projectedFppg(row, SCORING), 40, '300 + 2 x 50 = 400 over 10 games');
  assert.equal(projectedFppg(row, [{ statId: 0, points: 2 }]), 60, 'the scoring decides, not a constant');
});

test('per-game averages are used when ESPN sends them', () => {
  const row = { id: '102027', stats: { 0: 300, 3: 50, 42: 10 }, averageStats: { 0: 25, 3: 5 } };
  assert.equal(projectedFppg(row, SCORING), 35);
});

test('no scoring, no games, or no row means no projection, never a zero', () => {
  const row = { id: '102027', stats: { 0: 300, 3: 50, 42: 10 }, averageStats: null };
  assert.equal(projectedFppg(row, []), null);
  assert.equal(projectedFppg({ ...row, stats: { 0: 300 } }, SCORING), null, 'no games to divide by');
  assert.equal(projectedFppg(null, SCORING), null);
});

test('last season comes from the league-official line first, then the ESPN line', () => {
  assert.equal(
    lastSeasonFppg(player({ key: 'a', espnId: 1, stats2026: { total: 100, avg: 50, gp: 2 }, api2026: { total: 90, avg: 45, gp: 2 } })),
    50,
  );
  assert.equal(lastSeasonFppg(player({ key: 'b', espnId: 2, api2026: { total: 90, avg: 45, gp: 2 } })), 45);
  assert.equal(lastSeasonFppg(player({ key: 'c', espnId: 3, stats2026: { total: 0, avg: 0, gp: 0 } })), null, 'no games is no number');
  assert.equal(lastSeasonFppg(player({ key: 'd', espnId: 4 })), null);
});

// ─── Normalizing ───────────────────────────────────────────────────────────

test('an ADP of zero is no ADP, and a rank has to be a positive number', () => {
  const normal = normalizeDraftRankingPlayer(espn({
    espnId: 7,
    adp: 0,
    standard: { rank: 0, auctionValue: 1 },
    roto: { rank: 12, auctionValue: Number.NaN },
  }));
  assert.equal(normal.adp, null);
  assert.equal(normal.standard, null);
  assert.deepEqual(normal.roto, { rank: 12, auctionValue: null });
});

test('an empty projection dict is stored as no projection', () => {
  const normal = normalizeDraftRankingPlayer(espn({
    espnId: 7,
    projection: { id: '102027', stats: {}, averageStats: null },
  }));
  assert.equal(normal.projection, null);
});

test('a bad id or a blank name is refused', () => {
  assert.throws(() => normalizeDraftRankingPlayer(espn({ espnId: 0 })), /Invalid ESPN player ID/);
  assert.throws(() => normalizeDraftRankingPlayer(espn({ espnId: 1, fullName: '  ' })), /fullName/);
});

// ─── Ordering ──────────────────────────────────────────────────────────────

test('never alphabetical: the order follows the ranking, not the name', () => {
  // Names run Aaron, Bob, Cal, Dan; the ranks run the other way.
  const players = [
    player({ key: 'Aaron', espnId: 1 }),
    player({ key: 'Bob', espnId: 2 }),
    player({ key: 'Cal', espnId: 3 }),
    player({ key: 'Dan', espnId: 4 }),
  ];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      espn({ espnId: 1, standard: { rank: 40, auctionValue: 1 } }),
      espn({ espnId: 2, standard: { rank: 30, auctionValue: 2 } }),
      espn({ espnId: 3, standard: { rank: 20, auctionValue: 3 } }),
      espn({ espnId: 4, standard: { rank: 10, auctionValue: 4 } }),
    ],
  };
  const ranking = rankBoard(players, snapshot);
  assert.deepEqual(names(ranking), ['Dan', 'Cal', 'Bob', 'Aaron']);
  assert.equal(ranking.primary, 'espn-rank');
  assert.deepEqual(ranking.entries.map((e) => e.position), [1, 2, 3, 4]);
});

test('a projection beats an ESPN rank, which beats last season, and nothing goes last', () => {
  const players = [
    player({ key: 'last-only', espnId: 1, api2026: { total: 900, avg: 45, gp: 20 } }),
    player({ key: 'rank-only', espnId: 2 }),
    player({ key: 'projected', espnId: 3 }),
    player({ key: 'nothing', espnId: 4 }),
    player({ key: 'no-espn-id', espnId: null }),
  ];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      espn({ espnId: 2, standard: { rank: 1, auctionValue: 70 } }),
      withProjection(3, 10, 2),
    ],
  };
  const ranking = rankBoard(players, snapshot);
  assert.deepEqual(names(ranking), ['projected', 'rank-only', 'last-only', 'no-espn-id', 'nothing']);
  assert.deepEqual(sources(ranking), ['projection', 'espn-rank', 'last-season', 'none', 'none']);
  assert.equal(ranking.primary, 'projection');
  assert.deepEqual(ranking.counts, { projection: 1, 'espn-rank': 1, 'last-season': 1, none: 2 });
  const last = ranking.entries.at(-1);
  assert.equal(last?.value, null, 'a no-data player carries no number to mistake for a rank');
});

test('with no snapshot at all the board is last season, never a blank or a name sort', () => {
  const players = [
    player({ key: 'Zed', espnId: 1, api2026: { total: 900, avg: 45, gp: 20 } }),
    player({ key: 'Amy', espnId: 2, stats2026: { total: 600, avg: 30, gp: 20 } }),
    player({ key: 'Rookie', espnId: 3 }),
  ];
  const ranking = rankBoard(players, null);
  assert.deepEqual(names(ranking), ['Zed', 'Amy', 'Rookie']);
  assert.equal(ranking.primary, 'last-season');
  assert.deepEqual(sources(ranking), ['last-season', 'last-season', 'none']);
});

test('inside a source, points read high to low and ranks read low to high', () => {
  const players = [
    player({ key: 'p1', espnId: 1 }),
    player({ key: 'p2', espnId: 2 }),
    player({ key: 'r1', espnId: 3 }),
    player({ key: 'r2', espnId: 4 }),
  ];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      withProjection(1, 20, 0),
      withProjection(2, 30, 0),
      espn({ espnId: 3, standard: { rank: 9, auctionValue: null } }),
      espn({ espnId: 4, standard: { rank: 3, auctionValue: null } }),
    ],
  };
  assert.deepEqual(names(rankBoard(players, snapshot)), ['p2', 'p1', 'r2', 'r1']);
});

test('the projection order changes when the scoring does', () => {
  const players = [player({ key: 'scorer', espnId: 1 }), player({ key: 'passer', espnId: 2 })];
  const rows = [withProjection(1, 30, 0), withProjection(2, 10, 12)];
  // Points only: the scorer wins 30 to 10.
  assert.deepEqual(names(rankBoard(players, { scoringItems: [{ statId: 0, points: 1 }], players: rows })), ['scorer', 'passer']);
  // Points plus double assists: the passer wins 34 to 30.
  assert.deepEqual(names(rankBoard(players, { scoringItems: SCORING, players: rows })), ['passer', 'scorer']);
});

test('with no scoring items the projection source is unusable and the board falls through', () => {
  const players = [player({ key: 'a', espnId: 1 }), player({ key: 'b', espnId: 2 })];
  const snapshot = {
    scoringItems: [],
    players: [
      { ...withProjection(1, 10, 0), standard: { rank: 2, auctionValue: null } },
      { ...withProjection(2, 50, 0), standard: { rank: 1, auctionValue: null } },
    ],
  };
  const ranking = rankBoard(players, snapshot);
  assert.equal(ranking.primary, 'espn-rank');
  assert.deepEqual(names(ranking), ['b', 'a']);
  assert.equal(ranking.counts.projection, 0);
});

test('ADP stands in when ESPN has no rank, and the entry says which it used', () => {
  const players = [player({ key: 'ranked', espnId: 1 }), player({ key: 'adp-only', espnId: 2 })];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      espn({ espnId: 1, standard: { rank: 50, auctionValue: null }, adp: 48.2 }),
      espn({ espnId: 2, adp: 12.5 }),
    ],
  };
  const ranking = rankBoard(players, snapshot);
  assert.deepEqual(names(ranking), ['adp-only', 'ranked']);
  assert.equal(ranking.entries[0]?.espnBasis, 'adp');
  assert.equal(ranking.entries[0]?.value, 12.5);
  assert.equal(ranking.entries[1]?.espnBasis, 'rank');
  assert.equal(ranking.entries[1]?.value, 50);
});

test('tied ESPN ranks break on ADP, then on name, never the other way round', () => {
  const players = [player({ key: 'Zed', espnId: 1 }), player({ key: 'Amy', espnId: 2 })];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      espn({ espnId: 1, standard: { rank: 5, auctionValue: null }, adp: 4.1 }),
      espn({ espnId: 2, standard: { rank: 5, auctionValue: null }, adp: 6.3 }),
    ],
  };
  assert.deepEqual(names(rankBoard(players, snapshot)), ['Zed', 'Amy']);
});

test('the user can put last season first and the board reorders, gaps still falling through', () => {
  const players = [
    player({ key: 'vet', espnId: 1, api2026: { total: 800, avg: 40, gp: 20 } }),
    player({ key: 'star', espnId: 2, api2026: { total: 1200, avg: 60, gp: 20 } }),
    player({ key: 'rookie', espnId: 3 }),
  ];
  const snapshot = {
    scoringItems: SCORING,
    players: [
      espn({ espnId: 1, standard: { rank: 1, auctionValue: null } }),
      espn({ espnId: 2, standard: { rank: 2, auctionValue: null } }),
      espn({ espnId: 3, standard: { rank: 3, auctionValue: null } }),
    ],
  };
  const byEspn = rankBoard(players, snapshot);
  assert.deepEqual(names(byEspn), ['vet', 'star', 'rookie']);

  const byLast = rankBoard(players, snapshot, { prefer: 'last-season' });
  assert.deepEqual(byLast.order, ['last-season', 'projection', 'espn-rank']);
  assert.equal(byLast.primary, 'last-season');
  assert.deepEqual(names(byLast), ['star', 'vet', 'rookie']);
  assert.deepEqual(sources(byLast), ['last-season', 'last-season', 'espn-rank'], 'the rookie falls to ESPN, not to nothing');
});

test('every entry carries the numbers a screen needs, whatever ranked it', () => {
  const players = [player({ key: 'a', espnId: 1, stats2026: { total: 500, avg: 25, gp: 20 } })];
  const snapshot = {
    scoringItems: SCORING,
    players: [{
      ...withProjection(1, 30, 5),
      standard: { rank: 4, auctionValue: 55 },
      adp: 4.4,
      percentOwned: 99.5,
    }],
  };
  const [entry] = rankBoard(players, snapshot).entries;
  assert.equal(entry?.source, 'projection');
  assert.equal(entry?.value, 40);
  assert.equal(entry?.projectedFppg, 40);
  assert.equal(entry?.lastSeasonFppg, 25);
  assert.equal(entry?.espnRank, 4);
  assert.equal(entry?.adp, 4.4);
  assert.equal(entry?.auctionValue, 55);
  assert.equal(entry?.percentOwned, 99.5);
});

test('ordering never mutates the players handed in', () => {
  const players = [player({ key: 'b', espnId: 2 }), player({ key: 'a', espnId: 1 })];
  const before = JSON.stringify(players);
  rankBoard(players, { scoringItems: SCORING, players: [espn({ espnId: 1, standard: { rank: 1, auctionValue: null } })] });
  assert.equal(JSON.stringify(players), before);
});

// ─── Labels ────────────────────────────────────────────────────────────────

test('each source reads plainly and names its season', () => {
  assert.equal(rankSourceLabel('projection', 2027), '2026-27 projection');
  assert.equal(rankSourceLabel('espn-rank', 2027), 'ESPN draft rank');
  assert.equal(rankSourceLabel('last-season', 2027), '2025-26 actual');
  assert.equal(rankSourceLabel('none', 2027), 'No data');
  assert.equal(rankSourceLabel('projection', 2028), '2027-28 projection');
});

// ─── The refresh preview ───────────────────────────────────────────────────

const current: DraftRankingPlayer[] = [
  normalizeDraftRankingPlayer(espn({ espnId: 1, fullName: 'One', standard: { rank: 1, auctionValue: 60 }, adp: 1.5 })),
  normalizeDraftRankingPlayer(espn({ espnId: 2, fullName: 'Two', standard: { rank: 2, auctionValue: 50 }, adp: 2.5 })),
  normalizeDraftRankingPlayer(espn({ espnId: 3, fullName: 'Three', standard: { rank: 30, auctionValue: 5 } })),
];

test('the preview reports who came, who went, and who moved, biggest move first', () => {
  const fetched = [
    espn({ espnId: 1, fullName: 'One', standard: { rank: 2, auctionValue: 58 }, adp: 1.9 }),
    espn({ espnId: 2, fullName: 'Two', standard: { rank: 1, auctionValue: 61 }, adp: 1.4 }),
    espn({ espnId: 3, fullName: 'Three', standard: { rank: 12, auctionValue: 9 } }),
    espn({ espnId: 4, fullName: 'Four', adp: 140 }),
  ];
  const removedOne = current.slice(0, 3);
  const preview = previewDraftRankingRefresh({ players: removedOne, scoringItems: SCORING }, fetched, SCORING);
  assert.deepEqual(preview.added.map((p) => p.espnId), [4]);
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.moved.map((m) => [m.espnId, m.delta]), [[3, 18], [2, 1], [1, -1]]);
  assert.deepEqual(preview.nextPlayers.map((p) => p.espnId), [2, 1, 3, 4], 'stored in ESPN order');
  assert.equal(preview.counts.ranked, 3);
  assert.equal(preview.counts.withAdp, 3);
  assert.equal(preview.scoringChanged, false);
  assert.equal(preview.projectionArrived, false);
});

test('the preview notices a player ESPN dropped, a projection arriving, and scoring moving', () => {
  const fetched = [withProjection(1, 20, 4), espn({ espnId: 2, fullName: 'Two' })];
  const preview = previewDraftRankingRefresh(
    { players: current, scoringItems: SCORING },
    fetched,
    [{ statId: 0, points: 1 }],
  );
  assert.deepEqual(preview.removed.map((p) => p.espnId), [3]);
  assert.equal(preview.projectionArrived, true);
  assert.equal(preview.counts.projected, 1);
  assert.equal(preview.previousCounts.projected, 0);
  assert.equal(preview.scoringChanged, true);
  assert.deepEqual(preview.nextScoringItems, [{ statId: 0, points: 1 }]);
});

test('the preview refuses a duplicate ESPN id', () => {
  assert.throws(
    () => previewDraftRankingRefresh(
      { players: [], scoringItems: [] },
      [espn({ espnId: 9 }), espn({ espnId: 9 })],
      [],
    ),
    /Duplicate ESPN player ID 9/,
  );
});

test('counts say how much of the pool each number covers', () => {
  assert.deepEqual(countRankings(current), { players: 3, ranked: 3, withAdp: 2, projected: 0 });
});
