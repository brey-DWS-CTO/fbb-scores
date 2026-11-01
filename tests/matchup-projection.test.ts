import test from 'node:test';
import assert from 'node:assert/strict';
import { NBA_TEAM_ABBREV } from '../src/lib/espn/calculations.ts';
import { matchupGameProjection, projectionExplanation, MATCHUP_POSITIONS, type MatchupEnvironment } from '../src/lib/league/matchupProjection.ts';
import { LEAGUE_SCORING } from '../src/lib/league/partyScore.ts';
import type { ScorePlayer, ScoresWeek, ScoreSide } from '../src/lib/league/scores.ts';
import type { LineupSnapshot } from '../src/lib/league/lineup.ts';
import { planWeeklyLineup } from '../src/lib/league/weeklyLineup.ts';
const now = Date.parse('2026-10-31T12:00:00Z');
const player = { id: 7, name: 'Test Player', proTeam: 'DEN', position: 'PG', projByDay: {}, days: {} } as ScorePlayer;
const week = { season: 2027, days: [
  { scoringPeriodId: 1, date: '2026-11-02', games: { DEN: { status: 'upcoming', opponent: 'BOS', tipoff: '2026-11-02T20:00:00Z' } } },
  { scoringPeriodId: 2, date: '2026-11-04', games: { DEN: { status: 'upcoming', opponent: 'HOU', tipoff: '2026-11-04T20:00:00Z' } } },
] } as ScoresWeek;
function environment(): MatchupEnvironment {
  return { season: 2027, fetchedAt: new Date(now).toISOString(), teams: Object.fromEntries(Object.values(NBA_TEAM_ABBREV).map(team => [team,
    { pace: 100, defense: Object.fromEntries(MATCHUP_POSITIONS.map(position => [position, { games: 5, stats: { '0': 40, '6': 10, '3': 5, '11': 3 } }])) }])) } as MatchupEnvironment;
}
const project = (data = environment(), p = player, period = 1) => matchupGameProjection(p, period, 40, week, data, LEAGUE_SCORING, now);

test('neutral opponent leaves the baseline unchanged; friendly defense raises it', () => {
  assert.equal(project().points, 40);
  const data = environment(); data.teams.BOS.defense.PG.stats['0'] = 70;
  const result = project(data);
  assert.equal(result.source, 'matchup'); assert.ok(result.points > 40); assert.ok(result.points <= 44);
  assert.match(projectionExplanation(result), /pace.*position matchup/);
});
test('pace-normalized defense does not count a fast opponent twice', () => {
  const data = environment(); data.teams.BOS.pace = 110;
  for (const row of Object.values(data.teams.BOS.defense)) for (const key of Object.keys(row.stats)) row.stats[key] *= 1.1;
  const result = project(data);
  assert.ok(Math.abs(result.defenseFactor - 1) < 1e-10);
  assert.ok(result.paceFactor > 1); assert.ok(result.paceFactor <= 1.05);
});
test('small samples shrink toward neutral; adjustments remain bounded', () => {
  const data = environment(); data.teams.BOS.defense.PG.stats['0'] = 50;
  const small = project(data).points;
  data.teams.BOS.defense.PG.games = 40;
  assert.ok(project(data).points > small);
  data.teams.BOS.pace = 125; data.teams.BOS.defense.PG.stats['0'] = 1000;
  const result = project(data); assert.ok(result.defenseFactor <= 1.1); assert.ok(result.paceFactor <= 1.05);
});
test('defense signal uses league scoring weights, not the source FanDuel total', () => {
  const data = environment(); data.teams.BOS.defense.PG.stats['6'] = 30;
  const scoring = [{ statId: 0, points: 1 }];
  assert.equal(matchupGameProjection(player, 1, 40, week, data, scoring, now).points, 40);
  assert.ok(project(data).points > 40);
});
test('multi-position players average position signals rather than picking the easiest', () => {
  const data = environment(); data.teams.BOS.defense.PG.stats['0'] = 70; data.teams.BOS.defense.SG.stats['0'] = 10;
  const combo = project(data, { ...player, position: 'PG/SG' });
  assert.ok(combo.points > project(data, { ...player, position: 'SG' }).points);
  assert.ok(combo.points < project(data, { ...player, position: 'PG' }).points);
  assert.equal(project(data, { ...player, position: 'G' }).points, combo.points);
});
test('missing, stale, future, wrong-season and incomplete feeds preserve baseline', () => {
  const data = environment();
  for (const variant of [null, { ...data, season: 2026 }, { ...data, fetchedAt: new Date(now - 25 * 3600000).toISOString() },
    { ...data, fetchedAt: new Date(now + 1).toISOString() }, { ...data, teams: {} }]) {
    const result = matchupGameProjection(player, 1, 40, week, variant, LEAGUE_SCORING, now);
    assert.equal(result.source, 'baseline'); assert.equal(result.points, 40);
  }
  assert.equal(project(data, { ...player, position: 'UTIL' }).source, 'baseline');
  data.teams.BOS.defense.PG.games = 0; assert.equal(project(data).source, 'baseline');
});
test('ESPN daily projections, zero baselines and already-started games are not adjusted', () => {
  const data = environment(); data.teams.BOS.defense.PG.stats['0'] = 70;
  assert.equal(project(data, { ...player, projByDay: { '1': 40 } }).source, 'espn-daily');
  assert.equal(matchupGameProjection(player, 1, 0, week, data, LEAGUE_SCORING, now).points, 0);
  const past = structuredClone(week); past.days[0].games!.DEN.tipoff = new Date(now).toISOString();
  assert.equal(matchupGameProjection(player, 1, 40, past, data, LEAGUE_SCORING, now).source, 'baseline');
});
test('the optimizer picks the stronger matchup within a one-game weekly cap', () => {
  const data = environment(); data.teams.BOS.defense.PG.stats['0'] = 10; data.teams.HOU.defense.PG.stats['0'] = 70;
  const snapshot = { players: [{ id: 7, eligibleSlotIds: [0] }], slots: [{ id: 'PG', label: 'PG', kind: 'starter', eligibilityId: 0, playerId: 7 }], lockMode: 'individual' } as LineupSnapshot;
  const side = { players: [player] } as ScoreSide;
  const result = planWeeklyLineup(snapshot, side, week, 1, (p, period) => project(data, p, period).points, now);
  assert.equal(result.starts.length, 1); assert.equal(result.starts[0].period, 2);
});
