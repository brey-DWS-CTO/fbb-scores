import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NBA_TEAM_ABBREV } from '../src/lib/espn/calculations.ts';
import { LEAGUE_SCORING, completeLine } from '../src/lib/league/partyScore.ts';
import { buildEvaluationForecasts, buildEvaluationPlan, environmentKey, projectionEvaluationReport, EVALUATION_MODEL, type EvaluationRecord, type ForecastRecord, type ResultRecord } from '../src/lib/league/projectionEvaluation.ts';
import { fileEvaluationStore, type EvaluationStore } from '../server/lib/projectionEvaluationStore.ts';
import { finalizedEvaluationResult, settleEvaluationResults } from '../server/lib/projectionEvaluationService.ts';
import { MATCHUP_POSITIONS, type MatchupEnvironment } from '../src/lib/league/matchupProjection.ts';
import type { ScoresWeek, ScorePlayer, ScoreSide } from '../src/lib/league/scores.ts';
import type { LineupSnapshot } from '../src/lib/league/lineup.ts';
import type { DailyNbaScores } from '../src/lib/league/dailyScorers.ts';
const now = Date.parse('2026-11-02T21:00:00Z');
const player = { id: 7, name: 'Test', proTeam: 'DEN', position: 'PG', seasonAvg: 40, last15: null, injuryStatus: null, days: {}, projByDay: {} } as ScorePlayer;
const side = { teamId: 7, players: [player] } as ScoreSide;
function fixtures() {
  const week = { season: 2027, matchupPeriodId: 3, fetchedAt: new Date(now).toISOString(), matchups: [{ home: side, away: { players: [] } }], days: [
    { scoringPeriodId: 1, date: '2026-11-02', games: { DEN: { status: 'upcoming', opponent: 'BOS', tipoff: '2026-11-02T22:00:00Z' } } },
    { scoringPeriodId: 2, date: '2026-11-04', games: { DEN: { status: 'upcoming', opponent: 'HOU', tipoff: '2026-11-04T22:00:00Z' } } },
  ] } as ScoresWeek;
  const environment = { season: 2027, fetchedAt: new Date(now).toISOString(), teams: Object.fromEntries(Object.values(NBA_TEAM_ABBREV).map(team => [team,
    { pace: 100, defense: Object.fromEntries(MATCHUP_POSITIONS.map(position => [position, { games: 20, stats: { '0': team === 'BOS' ? 20 : team === 'HOU' ? 60 : 40 } }])) }])) } as MatchupEnvironment;
  const forecast = buildEvaluationForecasts(week, {}, environment, week.fetchedAt, LEAGUE_SCORING, now)[0];
  const env: EvaluationRecord = { kind: 'environment', id: environmentKey(environment), season: 2027, capturedAt: environment.fetchedAt, model: EVALUATION_MODEL, environment };
  return { week, environment, forecast, env };
}
function result(forecast: ForecastRecord, points = 30): ResultRecord {
  return { kind: 'result', id: `result:${EVALUATION_MODEL}:${forecast.key}`, key: forecast.key, season: 2027, capturedAt: '2026-11-03T06:00:00Z',
    tipoff: forecast.tipoff, gameId: '100', played: true, model: EVALUATION_MODEL,
    stats: completeLine({ '0': points, '6': 0, '3': 0, '2': 0, '1': 0, '13': 0, '14': 0, '15': 0, '16': 0, '17': 0, '11': 0, '40': 30 }) };
}
test('captures only future games within two hours and rejects future input availability', () => {
  const { week, environment, forecast } = fixtures();
  assert.equal(forecast.date, '2026-11-02'); assert.equal(forecast.baseline, 40); assert.equal(forecast.source, 'matchup');
  assert.equal(buildEvaluationForecasts(week, {}, environment, week.fetchedAt, LEAGUE_SCORING, now).length, 1);
  assert.throws(() => buildEvaluationForecasts({ ...week, fetchedAt: new Date(now + 1).toISOString() }, {}, environment, week.fetchedAt, LEAGUE_SCORING, now));
  assert.throws(() => buildEvaluationForecasts(week, {}, environment, new Date(now + 1).toISOString(), LEAGUE_SCORING, now));
  week.days[0].games!.DEN.tipoff = new Date(now).toISOString();
  assert.equal(buildEvaluationForecasts(week, {}, environment, week.fetchedAt, LEAGUE_SCORING, now).length, 0);
});
test('paired error metrics use the same frozen actual; pending outcomes never become zero', () => {
  const { forecast, env } = fixtures(); const outcome = result(forecast);
  const pending = projectionEvaluationReport([forecast, env], now + 86400000);
  assert.equal(pending.pending, 1); assert.equal(pending.matchupOnly.baseline, null);
  const report = projectionEvaluationReport([forecast, env, outcome], now + 86400000);
  assert.equal(report.matchupOnly.games, 1); assert.equal(report.matchupOnly.baseline?.mae, 10);
  assert.equal(report.matchupOnly.baseline?.bias, 10);
  assert.ok(report.matchupOnly.maeImprovement! > 0);
  assert.match(report.status, /no accuracy conclusion/);
  const worse = projectionEvaluationReport([forecast, env, result(forecast, 45)], now + 86400000);
  assert.ok(worse.matchupOnly.maeImprovement! < 0, 'a worse matchup prediction must report negative improvement');
});
test('daily/baseline fallback coverage stays separate from matchup-only accuracy', () => {
  const { forecast } = fixtures(); const daily = { ...forecast, source: 'espn-daily' as const, adjusted: forecast.baseline };
  const report = projectionEvaluationReport([daily, result(daily)], now + 86400000);
  assert.equal(report.all.games, 1); assert.equal(report.matchupOnly.games, 0);
});
test('post-tipoff and future-environment captures cannot enter paired metrics', () => {
  const { forecast, env } = fixtures();
  const late = { ...forecast, capturedAt: forecast.tipoff };
  assert.equal(projectionEvaluationReport([late, env, result(forecast)], now + 86400000).invalid, 1);
  const future = { ...env, capturedAt: '2026-11-03T01:00:00Z', environment: { ...env.environment, fetchedAt: '2026-11-03T01:00:00Z' } };
  assert.equal(projectionEvaluationReport([forecast, future, result(forecast)], now + 86400000).invalid, 1);
});
test('DNP requires explicit final evidence; active-only errors exclude explicit DNPs', () => {
  const { forecast, env } = fixtures(); const dnp = { ...result(forecast), played: false, stats: {} };
  assert.equal(projectionEvaluationReport([forecast, env, dnp], now + 86400000).pending, 1);
  const report = projectionEvaluationReport([forecast, env, { ...dnp, explicitDnp: true }], now + 86400000);
  assert.equal(report.dnp, 1); assert.equal(report.matchupOnly.games, 1); assert.equal(report.activeOnly.games, 0);
});
test('missing baselines are counted, not scored as invented zero forecasts', () => {
  const { forecast } = fixtures(); forecast.source = 'baseline'; forecast.baseline = 0; forecast.adjusted = 0;
  forecast.input.player = { ...forecast.input.player, seasonAvg: null, last15: null }; forecast.input.preseason = null;
  const report = projectionEvaluationReport([forecast, result(forecast)], now + 86400000);
  assert.equal(report.missingBaselines, 1); assert.equal(report.all.games, 0);
});
test('immutable file storage keeps first pregame capture across retries and new instances', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'fbb-evaluation-'));
  try {
    const { forecast } = fixtures(); const store = fileEvaluationStore(folder);
    await store.append([forecast]); await store.append([{ ...forecast, baseline: 999 }]);
    const rows = await fileEvaluationStore(folder).read(2027);
    assert.equal(rows.length, 1); assert.equal((rows[0] as ForecastRecord).baseline, 40);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('final outcome reader refuses live, missing and incomplete lines, accepting only explicit DNP zeros', () => {
  const { forecast } = fixtures(); const outcome = result(forecast);
  const day = { date: forecast.date, fetchedAt: outcome.capturedAt, games: [{ id: '100', home: 'DEN', away: 'BOS', state: 'post', tipoff: forecast.tipoff }],
    boxScores: [{ gameId: '100', state: 'post', lines: [{ athleteId: '7', team: 'DEN', played: true, stats: outcome.stats }] }] } as DailyNbaScores;
  assert.ok(finalizedEvaluationResult(forecast, day, 2027, now + 86400000));
  day.boxScores[0].lines[0].stats = {}; assert.equal(finalizedEvaluationResult(forecast, day, 2027, now + 86400000), null);
  day.boxScores[0].lines[0].played = false; assert.equal(finalizedEvaluationResult(forecast, day, 2027, now + 86400000), null);
  day.boxScores[0].lines[0].didNotPlay = true; assert.equal(finalizedEvaluationResult(forecast, day, 2027, now + 86400000)?.played, false);
  day.games[0].state = 'in'; assert.equal(finalizedEvaluationResult(forecast, day, 2027, now + 86400000), null);
});
test('result settlement is idempotent and preserves pending failures', async () => {
  const { forecast } = fixtures(); const records: EvaluationRecord[] = [forecast];
  const store: EvaluationStore = { read: async () => records, append: async added => { for (const record of added) if (!records.some(old => old.id === record.id)) records.push(record); } };
  const failure = await settleEvaluationResults(store, 2027, async () => { throw new Error('offline'); }, () => now + 86400000);
  assert.equal(failure.failures, 1); assert.equal(records.length, 1);
  const outcome = result(forecast); let reads = 0;
  const read = async (): Promise<DailyNbaScores> => { reads++; return { date: forecast.date, fetchedAt: outcome.capturedAt,
    games: [{ id: '100', home: 'DEN', away: 'BOS', state: 'post', tipoff: forecast.tipoff }],
    boxScores: [{ gameId: '100', state: 'post', lines: [{ athleteId: '7', team: 'DEN', played: true, stats: outcome.stats }] }] } as DailyNbaScores; };
  assert.equal((await settleEvaluationResults(store, 2027, read, () => now + 86400000)).resolved, 1);
  assert.equal((await settleEvaluationResults(store, 2027, read, () => now + 86400000)).resolved, 0);
  assert.equal(reads, 1); assert.equal(records.length, 2);
});
test('frozen legal lineup choices compare only after every selected game has a final result', () => {
  const { week, environment, forecast, env } = fixtures();
  const lineup = { fetchedAt: new Date(now).toISOString(), players: [{ id: 7, eligibleSlotIds: [0] }],
    slots: [{ id: 'PG', label: 'PG', kind: 'starter', eligibilityId: 0, playerId: 7 }], lockMode: 'individual' } as LineupSnapshot;
  const plan = buildEvaluationPlan(week, side, lineup, 1, {}, environment, week.fetchedAt, LEAGUE_SCORING, now)!;
  assert.equal(plan.baseline[0].date, '2026-11-02'); assert.equal(plan.adjusted[0].date, '2026-11-04');
  const first = result(forecast), second = { ...first, id: `result:${EVALUATION_MODEL}:${plan.adjusted[0].key}`, key: plan.adjusted[0].key, tipoff: plan.adjusted[0].tipoff,
    capturedAt: '2026-11-05T06:00:00Z', stats: { ...first.stats, '0': 50 } };
  assert.equal(projectionEvaluationReport([plan, env, first], now + 7 * 86400000).lineups.completed, 0);
  const report = projectionEvaluationReport([plan, env, first, second], now + 7 * 86400000);
  assert.equal(report.lineups.completed, 1); assert.equal(report.lineups.meanGain, 20);
});
