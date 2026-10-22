import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateForecasts, forecastArchive, type ForecastArchive, type ForecastCase, type ForecastOutcome } from '../src/lib/league/forecastEvaluation.js';
import { warningWeek } from './helpers/lineup-games-fixture.js';
const archive = (): ForecastArchive => ({ schemaVersion: 1, capturedAt: '2026-11-06T16:00:00Z',
  priorAvailableAt: '2026-11-01T00:00:00Z', priors: { '1': 30, '2': 30, '5': 30 }, week: warningWeek() });
const example = (): ForecastCase => ({ season: 2027, week: 1, matchupId: 1, asOf: '2026-10-20T12:00:00Z', stage: 'opening',
  coverage: { home: { remainingGames: 20, missingGames: 0, dailyProjectionGames: 0, historicalPriorGames: 20, missingPlayerIds: [] },
    away: { remainingGames: 20, missingGames: 0, dailyProjectionGames: 0, historicalPriorGames: 20, missingPlayerIds: [] } },
  predictions: [{ model: 'test-v1', homeTotal: 100, awayTotal: 80, homeWinProbability: .7 }] });
const outcome = (): ForecastOutcome => ({ season: 2027, week: 1, matchupId: 1, finalizedAt: '2026-10-26T08:00:00Z', homeTotal: 110, awayTotal: 70 });

test('frozen inputs reproduce both models without mutating the archive', () => {
  const input = archive(), before = structuredClone(input);
  const cases = forecastArchive(input);
  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0].predictions.map(p => p.model), ['current-blend-v1', 'historical-only-v1']);
  assert.deepEqual(forecastArchive(input), cases);
  assert.deepEqual(input, before);
});
test('future league data and future priors are refused', () => {
  const input = archive(); input.week.fetchedAt = '2026-11-07T00:00:00Z';
  assert.throws(() => forecastArchive(input), /Future input/);
  input.week.fetchedAt = '2026-11-06T15:00:00Z'; input.priorAvailableAt = '2026-11-07T00:00:00Z';
  assert.throws(() => forecastArchive(input), /Future input/);
});
test('missing baselines are visible as uncovered future player-games', () => {
  const input = archive(); input.priors = {};
  const player = input.week.matchups[0].away.players[0];
  player.seasonAvg = null; player.last15 = null;
  const row = forecastArchive(input)[0];
  assert.equal(row.coverage.away.missingGames, 3);
  assert.deepEqual(row.coverage.away.missingPlayerIds, [player.id]);
  assert.equal(row.coverage.home.missingGames, 0);
});
test('settled matchups cannot masquerade as forecasts', () => {
  const input = archive(); input.week.matchups[0].winner = 'HOME';
  assert.deepEqual(forecastArchive(input), []);
});
test('score errors and Brier score are calculated against final outcomes', () => {
  const report = evaluateForecasts([example()], [outcome()]);
  const summary = report.summaries.find(s => s.stage === 'all')!;
  assert.equal(summary.teamMae, 10); assert.equal(summary.teamRmse, 10); assert.equal(summary.teamBias, 0);
  assert.ok(Math.abs(summary.brier! - .09) < 1e-9);
  assert.equal(summary.distinctMatchups, 1); assert.equal(summary.forecasts, 1);
  assert.equal(summary.calibration[7].winRate, 1); assert.equal(summary.calibration[7].meanProbability, .7);
  assert.equal(report.summaries.find(s => s.stage === 'opening')!.forecasts, 1);
});
test('ties retain total-error evaluation without inventing a binary winner', () => {
  const final = outcome(); final.awayTotal = final.homeTotal;
  const summary = evaluateForecasts([example()], [final]).summaries[0];
  assert.equal(summary.nonTiedForecasts, 0); assert.equal(summary.brier, null);
});
test('duplicate forecasts, duplicate results, invalid odds and forecasts after final are refused', () => {
  assert.throws(() => evaluateForecasts([example(), example()], [outcome()]), /Duplicate forecast/);
  assert.throws(() => evaluateForecasts([example()], [outcome(), outcome()]), /Duplicate outcome/);
  const row = example(); row.predictions[0].homeWinProbability = 1.1;
  assert.throws(() => evaluateForecasts([row], [outcome()]), /Invalid prediction/);
  row.predictions[0].homeWinProbability = .7; row.asOf = outcome().finalizedAt;
  assert.throws(() => evaluateForecasts([row], [outcome()]), /precede/);
});
test('unsettled weeks are unmatched rather than scored against partial totals', () => {
  assert.deepEqual(evaluateForecasts([example()], []), { summaries: [], unmatchedCases: 1 });
});
test('100 percent predictions enter the last calibration bin and missing inputs stay flagged', () => {
  const row = example(); row.predictions[0].homeWinProbability = 1; row.coverage.home.missingGames = 1;
  const summary = evaluateForecasts([row], [outcome()]).summaries[0];
  assert.equal(summary.calibration[9].forecasts, 1); assert.equal(summary.brier, 0);
  assert.equal(summary.incompleteForecasts, 1);
});
