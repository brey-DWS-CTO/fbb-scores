/** Offline forecasts and evaluation. Outcomes never enter the forecast inputs. */
import { expectedPointsForGame, sideProjection } from './dailyProjection.js';
import { isOut, lineupGamesLeft, matchupChance, type ScoresWeek, type ScoreSide } from './scores.js';

export interface ForecastArchive {
  schemaVersion: 1;
  capturedAt: string;
  priorAvailableAt: string;
  priors: Record<string, number>;
  week: ScoresWeek;
}
export interface ForecastPrediction {
  model: string;
  homeTotal: number;
  awayTotal: number;
  homeWinProbability: number;
}
export interface ForecastCase {
  season: number;
  week: number;
  matchupId: number;
  asOf: string;
  stage: 'opening' | 'midweek' | 'closing';
  coverage: { home: Coverage; away: Coverage };
  predictions: ForecastPrediction[];
}
interface Coverage {
  remainingGames: number;
  missingGames: number;
  dailyProjectionGames: number;
  historicalPriorGames: number;
  missingPlayerIds: number[];
}
export interface ForecastOutcome {
  season: number;
  week: number;
  matchupId: number;
  finalizedAt: string;
  homeTotal: number;
  awayTotal: number;
}
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid timestamp: ${value}`);
  return result;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const key = (value: { season: number; week: number; matchupId: number }) => `${value.season}:${value.week}:${value.matchupId}`;

export function forecastArchive(archive: ForecastArchive): ForecastCase[] {
  if (archive.schemaVersion !== 1) throw new Error('Unsupported forecast archive version');
  const asOf = timestamp(archive.capturedAt);
  if (timestamp(archive.week.fetchedAt) > asOf || timestamp(archive.priorAvailableAt) > asOf) {
    throw new Error('Future input: forecasts may only use data available at capture time');
  }
  if (Object.values(archive.priors).some(value => !finite(value) || value < 0)) throw new Error('Invalid prior');
  const week = archive.week;
  const current = week.days.findIndex(day => day.scoringPeriodId >= week.currentScoringPeriodId);
  const progress = current < 0 ? 1 : current / Math.max(1, week.days.length - 1);
  const stage = progress < .25 ? 'opening' : progress < .75 ? 'midweek' : 'closing';
  const expected = (player: ScoreSide['players'][number], period: number) => expectedPointsForGame(player, {
    scoringPeriodId: period, preseason: archive.priors[String(player.id)] ?? null,
  });
  const historical = (player: ScoreSide['players'][number]) => isOut(player) ? 0 : archive.priors[String(player.id)] ?? 0;
  const coverage = (side: ScoreSide): Coverage => {
    const games = lineupGamesLeft(side, week);
    const missing = games.filter(({ player, game }) => !finite(player.projByDay[String(game.scoringPeriodId)])
      && !finite(player.last15) && !finite(player.seasonAvg) && !finite(archive.priors[String(player.id)]));
    return {
      remainingGames: games.length, missingGames: missing.length,
      dailyProjectionGames: games.filter(({ player, game }) => finite(player.projByDay[String(game.scoringPeriodId)])).length,
      historicalPriorGames: games.filter(({ player }) => finite(archive.priors[String(player.id)])).length,
      missingPlayerIds: [...new Set(missing.map(({ player }) => player.id))],
    };
  };
  return week.matchups.filter(matchup => matchup.winner === 'UNDECIDED').map(matchup => ({
    season: week.season, week: week.matchupPeriodId, matchupId: matchup.id,
    asOf: archive.capturedAt, stage, coverage: { home: coverage(matchup.home), away: coverage(matchup.away) },
    predictions: [
      { model: 'current-blend-v1', expected },
      { model: 'historical-only-v1', expected: historical },
    ].map(model => ({
      model: model.model,
      homeTotal: sideProjection(matchup.home, week, model.expected).week,
      awayTotal: sideProjection(matchup.away, week, model.expected).week,
      homeWinProbability: matchupChance(matchup, week, model.expected).home / 100,
    })),
  }));
}

export interface EvaluationSummary {
  model: string;
  stage: string;
  forecasts: number;
  distinctMatchups: number;
  teamMae: number;
  teamRmse: number;
  teamBias: number;
  brier: number | null;
  nonTiedForecasts: number;
  incompleteForecasts: number;
  calibration: Array<{ lower: number; upper: number; forecasts: number; meanProbability: number | null; winRate: number | null }>;
}

export function evaluateForecasts(cases: ForecastCase[], outcomes: ForecastOutcome[]): {
  summaries: EvaluationSummary[]; unmatchedCases: number;
} {
  const actual = new Map<string, ForecastOutcome>();
  for (const outcome of outcomes) {
    if (actual.has(key(outcome))) throw new Error('Duplicate outcome');
    if (!finite(outcome.homeTotal) || !finite(outcome.awayTotal)) throw new Error('Invalid final total');
    timestamp(outcome.finalizedAt);
    actual.set(key(outcome), outcome);
  }
  const seen = new Set<string>();
  const groups = new Map<string, Array<{ row: ForecastCase; forecast: ForecastPrediction; outcome: ForecastOutcome }>>();
  let unmatchedCases = 0;
  for (const row of cases) {
    if (!['opening', 'midweek', 'closing'].includes(row.stage)) throw new Error('Invalid forecast stage');
    const outcome = actual.get(key(row));
    const time = timestamp(row.asOf);
    if (outcome && time >= timestamp(outcome.finalizedAt)) throw new Error('Forecast must precede the final outcome');
    for (const forecast of row.predictions) {
      if (!forecast.model.trim()) throw new Error('Missing model version');
      if (!finite(forecast.homeTotal) || !finite(forecast.awayTotal) || !finite(forecast.homeWinProbability)
        || forecast.homeWinProbability < 0 || forecast.homeWinProbability > 1) throw new Error('Invalid prediction');
      const identity = `${key(row)}:${time}:${forecast.model}`;
      if (seen.has(identity)) throw new Error('Duplicate forecast');
      seen.add(identity);
      if (!outcome) continue;
      for (const stage of ['all', row.stage]) {
        const group = `${forecast.model}:${stage}`;
        groups.set(group, [...(groups.get(group) ?? []), { row, forecast, outcome }]);
      }
    }
    if (!outcome) unmatchedCases++;
  }
  const summaries = [...groups.entries()].map(([group, entries]) => {
    const errors = entries.flatMap(({ forecast: f, outcome: o }) => [f.homeTotal - o.homeTotal, f.awayTotal - o.awayTotal]);
    const resolved = entries.filter(({ outcome: o }) => o.homeTotal !== o.awayTotal);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      model: entries[0].forecast.model, stage: group.slice(group.lastIndexOf(':') + 1),
      forecasts: entries.length, distinctMatchups: new Set(entries.map(({ row }) => key(row))).size,
      teamMae: mean(errors.map(Math.abs)), teamRmse: Math.sqrt(mean(errors.map(error => error ** 2))), teamBias: mean(errors),
      brier: resolved.length ? mean(resolved.map(({ forecast: f, outcome: o }) => (f.homeWinProbability - Number(o.homeTotal > o.awayTotal)) ** 2)) : null,
      nonTiedForecasts: resolved.length,
      incompleteForecasts: entries.filter(({ row }) => row.coverage.home.missingGames + row.coverage.away.missingGames > 0).length,
      calibration: Array.from({ length: 10 }, (_, index) => {
        const bucket = resolved.filter(({ forecast: f }) => Math.min(9, Math.floor(f.homeWinProbability * 10)) === index);
        return { lower: index / 10, upper: (index + 1) / 10, forecasts: bucket.length,
          meanProbability: bucket.length ? mean(bucket.map(({ forecast: f }) => f.homeWinProbability)) : null,
          winRate: bucket.length ? mean(bucket.map(({ outcome: o }) => Number(o.homeTotal > o.awayTotal))) : null };
      }),
    };
  });
  return { summaries, unmatchedCases };
}
