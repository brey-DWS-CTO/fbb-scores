import assert from 'node:assert/strict';
import test from 'node:test';
import hashtag from '../server/data/hashtag-projections-2027.json' with { type: 'json' };
import { bonusOdds } from '../src/lib/league/doubleDoubles.ts';
import { projectedFppg, projectedPerGame, type ProjectionRow } from '../src/lib/league/draftRankings.ts';
import { editedProjection } from '../src/lib/league/projectionEdits.ts';
import {
  applyProjectionSource,
  blendPerGame,
  matchExpert,
  parseHashtagPaste,
  type ExpertProjections,
} from '../src/lib/league/expertProjections.ts';

// This league's scoring, as ESPN reports it.
const scoring = [
  { statId: 0, points: 1 }, { statId: 1, points: 2.5 }, { statId: 2, points: 2.5 }, { statId: 3, points: 1.4 },
  { statId: 6, points: 1 }, { statId: 11, points: -1.8 }, { statId: 13, points: 1 }, { statId: 17, points: 0.5 },
  { statId: 23, points: -0.7 }, { statId: 24, points: -0.5 }, { statId: 37, points: 1.8 }, { statId: 38, points: 6.2 },
  { statId: 39, points: 170 },
];

const PASTE = [
  'R#\tNAME\tPOS\tTEAM\tTOTAL\tGP\tPTS\tTREB\tAST\tSTL\tBLK\t3PM\tFGM\tFGMI\tFTMI\tTO\tDD\tTD',
  '1\tNikola Jokic\t',
  'C',
  'DEN\t65.00\t72\t28.4\t12.7\t10.4\t1.6\t0.7\t1.8\t10.5\t7.8\t1.3\t3.5\t0.8\t0.5',
  '77\tAlexandre Sarr\t',
  'C',
  'WAS\t30.82\t68\t15.4\t7.4\t2.7\t0.8\t1.8\t1.5\t6.0\t7.9\t0.9\t1.8\t0.2\t0.0',
  '63\tCameron Boozer \t',
  'PF',
  'MEM\t31.73\t70\t17.2\t7.0\t3.9\t1.1\t0.6\t1.2\t6.0\t5.6\t1.1\t2.5\t0.0\t0.0',
].join('\n');

// ESPN's season line for Jokic, enough to score.
const espnJokic: ProjectionRow = {
  id: '102027',
  averageStats: null,
  stats: { '0': 2034, '1': 58, '2': 115, '3': 727, '6': 914, '11': 245, '13': 762, '14': 1325, '15': 388, '16': 475, '17': 122, '23': 563, '24': 87, '40': 2563.2, '42': 72 },
};
const snapshot = {
  players: [
    { espnId: 3112335, fullName: 'Nikola Jokić', projection: espnJokic },
    { espnId: 4683678, fullName: 'Alex Sarr', projection: null },
    { espnId: 1, fullName: 'Nobody Hashtag Knows', projection: espnJokic },
  ],
} as unknown as { players: Parameters<typeof matchExpert>[0] & { projection: ProjectionRow | null }[] };

test('a Hashtag paste reads into per-game lines by ESPN stat id', () => {
  const rows = parseHashtagPaste(PASTE);
  assert.deepEqual(rows.map((row) => [row.name, row.team, row.games]), [['Nikola Jokic', 'DEN', 72], ['Alexandre Sarr', 'WAS', 68], ['Cameron Boozer', 'MEM', 70]]);
  assert.equal(rows[0].perGame['23'], 7.8, 'missed field goals');
  assert.equal(rows[0].perGame['14'], 18.3, 'attempts are makes plus misses');
  assert.equal(rows[0].perGame['38'], 0.5, 'triple-doubles');
  assert.throws(() => parseHashtagPaste('1\tX\t\nC\nDEN\t1\t2'), /Could not read the numbers for X/);
});

test('names match through accents and the spellings ESPN shortens', () => {
  const { byEspnId, unmatched } = matchExpert(snapshot.players, { players: parseHashtagPaste(PASTE) });
  assert.deepEqual([...byEspnId.keys()].sort(), [3112335, 4683678]);
  assert.deepEqual(unmatched, ['Cameron Boozer']);
});

test('Hashtag scores to its own total in our scoring, double- and triple-doubles included', () => {
  const expert: ExpertProjections = { source: 'hashtag', updated: '2026-10-16', players: parseHashtagPaste(PASTE) };
  const out = applyProjectionSource(snapshot, expert, 'hashtag');
  const jokic = out.players[0].projection as ProjectionRow;
  assert.equal(projectedFppg(jokic, scoring), 64.9, 'Hashtag lists 65.00');
  assert.equal(jokic.stats['42'], 72);
  const perGame = projectedPerGame(jokic)!;
  assert.equal(Math.round(perGame['40'] * 10) / 10, 35.6, 'minutes come from ESPN');
  assert.equal(Math.round(perGame['16'] * 10) / 10, 6.7, 'free throws tried: ESPN makes plus Hashtag misses');
  // A player with no ESPN line still takes Hashtag's; one Hashtag lacks keeps ESPN's.
  assert.equal(projectedPerGame(out.players[1].projection)!['0'], 15.4);
  assert.equal(out.players[2].projection, espnJokic);
  assert.equal(applyProjectionSource(snapshot, expert, 'espn'), snapshot);
});

test('the blend is half and half, with ESPN\'s bonus odds estimated from its line', () => {
  const espnLine = { '0': 20, '6': 12, '3': 10, '2': 1, '1': 1 };
  const blended = blendPerGame({ '0': 30, '37': 0.8 }, espnLine);
  assert.equal(blended['0'], 25);
  assert.equal(blended['37'], Math.round(((0.8 + bonusOdds(espnLine).doubleDouble) / 2) * 100) / 100);
  const expert: ExpertProjections = { source: 'hashtag', updated: '2026-10-16', players: parseHashtagPaste(PASTE) };
  const jokic = applyProjectionSource(snapshot, expert, 'blend').players[0].projection as ProjectionRow;
  assert.equal(jokic.stats['42'], 72);
  const fppg = projectedFppg(jokic, scoring)!;
  assert.ok(fppg > 62 && fppg < 67, `blend lands between ESPN and Hashtag, got ${fppg}`);
});

test('the committed Hashtag file reads cleanly', () => {
  assert.equal(hashtag.players.length, 200);
  assert.ok(hashtag.players.every((row) => row.games > 0 && Number.isFinite(row.perGame['0'])));
});

test('a tie on name goes to the player on Hashtag\'s team, codes translated', () => {
  const twins = [
    { espnId: 10, fullName: 'Gary Trent', proTeam: 'MIL' },
    { espnId: 11, fullName: 'Gary Trent Jr.', proTeam: 'GSW' },
  ];
  const line = { name: 'Gary Trent Jr.', team: 'GS', games: 70, perGame: { '0': 12 } };
  assert.deepEqual([...matchExpert(twins, { players: [line] }).byEspnId.keys()], [11]);
});

test('editing a Hashtag line re-estimates its double-doubles; games alone keep them', () => {
  const expert: ExpertProjections = { source: 'hashtag', updated: '2026-10-16', players: parseHashtagPaste(PASTE) };
  const sourced = applyProjectionSource(snapshot, expert, 'hashtag');
  assert.equal(sourced.lineLabel, 'Hashtag');
  const jokic = sourced.players[0].projection as ProjectionRow;
  const base = { espnId: 3112335, name: 'Nikola Jokic', note: '', editedAt: '', editedBy: 'Brey' };
  const fewerBoards = projectedPerGame(editedProjection(jokic, { ...base, games: null, perGame: { '6': 4 } }))!;
  assert.equal(fewerBoards['37'], undefined, 'the bonus is estimated from the new line');
  const fewerGames = projectedPerGame(editedProjection(jokic, { ...base, games: 50, perGame: {} }))!;
  assert.equal(fewerGames['37'], 0.8, 'Hashtag\'s rate stands');
});

test('ESPN\'s blanks take the Hashtag line; anyone ESPN projects is left alone', async () => {
  const { projectionGaps, fillProjectionGaps } = await import('../src/lib/league/expertProjections.ts');
  const expert: ExpertProjections = { source: 'hashtag', updated: '2026-10-16', players: parseHashtagPaste(PASTE) };
  // Sarr has no ESPN line here; Jokic has one.
  const gaps = projectionGaps(snapshot.players, expert);
  assert.deepEqual(gaps.map((line) => line.name), ['Alexandre Sarr']);
  const filled = fillProjectionGaps(snapshot, { players: gaps });
  assert.equal(projectedPerGame(filled.players[1].projection)!['0'], 15.4);
  assert.equal(filled.players[1].projection!.stats['42'], 68);
  assert.equal(filled.players[0].projection, espnJokic, 'ESPN\'s own line stands');
  assert.equal(fillProjectionGaps(snapshot, null), snapshot);
});

test('the three ESPN blanks feed the Scores opening-night fallback', async () => {
  const { projectionGaps, fillProjectionGaps } = await import('../src/lib/league/expertProjections.ts');
  const { expectedPointsForGame } = await import('../src/lib/league/dailyProjection.ts');
  const names = ['Sandro Mamukelashvili', 'Cam Spencer', 'Daniss Jenkins'];
  const players = names.map((fullName, index) => ({ espnId: index + 1, fullName, projection: null }));
  const filled = fillProjectionGaps({ players }, { players: projectionGaps(players, hashtag) });
  for (const player of filled.players) {
    const preseason = projectedFppg(player.projection, scoring);
    assert.ok(preseason !== null && preseason > 0, player.fullName);
    const scorePlayer = { injuryStatus: null, seasonAvg: null, last15: null, projByDay: {} } as import('../src/lib/league/scores.ts').ScorePlayer;
    assert.ok(Math.abs(expectedPointsForGame(scorePlayer, { scoringPeriodId: 1, preseason }) - preseason) < 1e-9);
  }
});
