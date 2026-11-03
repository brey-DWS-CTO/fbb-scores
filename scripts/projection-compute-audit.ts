import { NBA_TEAM_ABBREV } from '../src/lib/espn/calculations.js';
import type { LineupSnapshot } from '../src/lib/league/lineup.js';
import type { ScoresWeek, ScoreSide } from '../src/lib/league/scores.js';
/** Synthetic maximum-capture load audit. No network, database or live user data. */
import { performance } from 'node:perf_hooks';
import { EVALUATION_CAPTURE_DAYS, EVALUATION_MAX_FORECASTS } from '../src/lib/league/projectionComputePolicy.js';
import { buildEvaluationPlan, EVALUATION_MODEL, environmentKey, evaluationKey, projectionEvaluationReport, type EvaluationRecord } from '../src/lib/league/projectionEvaluation.js';
import { LEAGUE_SCORING, completeLine } from '../src/lib/league/partyScore.js';
import type { MatchupEnvironment } from '../src/lib/league/matchupProjection.js';
import type { ScorePlayer } from '../src/lib/league/scores.js';
const records: EvaluationRecord[] = [];
const start = Date.parse('2026-11-01T00:00:00Z');
for (let day = 0; day < EVALUATION_CAPTURE_DAYS; day++) {
  const date = new Date(start + day * 86400000).toISOString().slice(0, 10), capturedAt = date + 'T15:00:00Z', tipoff = date + 'T22:00:00Z';
  const environment: MatchupEnvironment = { season: 2027, fetchedAt: date + 'T14:00:00Z', teams: {} };
  records.push({ kind: 'environment', id: environmentKey(environment), season: 2027, capturedAt: environment.fetchedAt, model: EVALUATION_MODEL, environment });
  for (let playerId = 1; playerId <= EVALUATION_MAX_FORECASTS; playerId++) {
    const key = evaluationKey(2027, date, playerId, 'DEN', 'BOS');
    const player = { id: playerId, name: 'Synthetic player', proTeam: 'DEN', position: 'PG', seasonAvg: 40, last15: 40, projByDay: {}, days: {} } as ScorePlayer;
    records.push({ kind: 'forecast', id: 'forecast:' + key, model: EVALUATION_MODEL, season: 2027, key, date, capturedAt, tipoff, playerId, team: 'DEN', opponent: 'BOS', baseline: 40, adjusted: 37, source: 'matchup',
      input: { player, period: day + 1, preseason: 40, scoring: LEAGUE_SCORING, environmentId: environmentKey(environment), availableAt: capturedAt } });
    records.push({ kind: 'result', id: 'result:' + key, model: EVALUATION_MODEL, season: 2027, key, capturedAt: new Date(Date.parse(tipoff) + 4 * 3600000).toISOString(), tipoff, gameId: String(day), played: true,
      stats: completeLine({ '0': 30, '6': 0, '3': 0, '2': 0, '1': 0, '13': 5, '14': 5, '15': 0, '16': 0, '17': 0, '11': 0, '40': 30 }) });
  }
}
const wire = JSON.stringify(records), parseStart = performance.now();
const parsed: EvaluationRecord[] = JSON.parse(wire);
const parseMs = performance.now() - parseStart, times: number[] = [];
let report = projectionEvaluationReport([]);
for (let run = 0; run < 5; run++) {
  const before = performance.now(); report = projectionEvaluationReport(parsed, start + 60 * 86400000); times.push(performance.now() - before);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ synthetic: true, forecasts: report.captured, records: parsed.length, archiveMiB: +(Buffer.byteLength(wire) / 1048576).toFixed(2),
  jsonParseMs: +parseMs.toFixed(1), reportMedianMs: +times[2].toFixed(1), reportMaxMs: +times.at(-1)!.toFixed(1), summaryBytes: Buffer.byteLength(JSON.stringify(report)) }));

const captureTime = start + 15 * 3600000;
const players = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: 'Synthetic player', proTeam: 'DEN', position: 'PG', seasonAvg: 40, last15: 40, projByDay: {}, days: {} })) as ScorePlayer[];
const side = { teamId: 7, players } as ScoreSide;
const week = { season: 2027, matchupPeriodId: 1, currentMatchupPeriodId: 1, currentScoringPeriodId: 1, weeks: [], matchups: [], gamesCap: 60, anchor: { scoringPeriodId: 1, date: '2026-11-01', source: 'demo' }, fetchedAt: new Date(captureTime).toISOString(), days: Array.from({ length: 14 }, (_, index) => ({
  date: new Date(start + index * 86400000).toISOString().slice(0, 10), scoringPeriodId: index + 1,
  games: { DEN: { opponent: 'BOS', status: 'upcoming', home: true, teamScore: null, oppScore: null, clock: null, minutesLeft: null, tipoff: new Date(start + index * 86400000 + 22 * 3600000).toISOString() } },
})) } as ScoresWeek;
const allowance = () => ({ games: 20, stats: { '0': 40 } });
const environment: MatchupEnvironment = { season: 2027, fetchedAt: new Date(captureTime).toISOString(), teams: Object.fromEntries(Object.values(NBA_TEAM_ABBREV).map(team => [team,
  { pace: 100, defense: { PG: allowance(), SG: allowance(), SF: allowance(), PF: allowance(), C: allowance() } }])) };
const lineup = { fetchedAt: new Date(captureTime).toISOString(), lockMode: 'individual', players: players.map(player => ({ id: player.id, eligibleSlotIds: [0] })),
  slots: players.map(player => ({ id: 'PG' + player.id, label: 'PG', kind: 'starter', eligibilityId: 0, playerId: player.id })) } as LineupSnapshot;
const planStart = performance.now();
const plan = buildEvaluationPlan(week, side, lineup, 60, {}, environment, week.fetchedAt, LEAGUE_SCORING, captureTime);
console.log(JSON.stringify({ synthetic: true, maximumBudgetPlan: { players: 30, slots: 30, days: 14, cap: 60 },
  twoOptimizersMs: +(performance.now() - planStart).toFixed(1), archivedPlanBytes: Buffer.byteLength(JSON.stringify(plan)) }));
