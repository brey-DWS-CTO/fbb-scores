import { expectedPointsForGame } from './dailyProjection.js';
import { matchupGameProjection, type MatchupEnvironment } from './matchupProjection.js';
import { planWeeklyLineup, type PlannedStart } from './weeklyLineup.js';
import { normalizeNbaTeamCode } from './schedule.js';
import { scoreLine, type ScoringItem } from './partyScore.js';
import type { ScoresWeek, ScorePlayer, ScoreSide } from './scores.js';
import type { LineupSnapshot } from './lineup.js';
export const EVALUATION_MODEL = 'pace-position-v1';
interface Base { id: string; season: number; capturedAt: string; model: typeof EVALUATION_MODEL }
export interface EvaluationGame { key: string; date: string; playerId: number; team: string; opponent: string; tipoff: string }
export interface ForecastRecord extends Base, EvaluationGame {
  kind: 'forecast'; baseline: number; adjusted: number; source: 'matchup' | 'espn-daily' | 'baseline';
  input: { player: ScorePlayer; period: number; preseason: number | null; environmentId: string | null; scoring: readonly ScoringItem[]; availableAt: string };
}
export interface ResultRecord extends Base { kind: 'result'; key: string; gameId: string; played: boolean; explicitDnp?: true; stats: Record<string, number>; tipoff: string }
export interface EnvironmentRecord extends Base { kind: 'environment'; environment: MatchupEnvironment }
export interface PlanRecord extends Base { kind: 'plan'; week: number; teamId: number; cap: number; used: number;
  baseline: EvaluationGame[]; adjusted: EvaluationGame[];
  input: { lineup: LineupSnapshot; side: ScoreSide; week: ScoresWeek; priors: Record<string, number>; scoring: readonly ScoringItem[]; environmentId: string | null; availableAt: string };
}
export type EvaluationRecord = ForecastRecord | ResultRecord | EnvironmentRecord | PlanRecord;
export const evaluationKey = (season: number, date: string, playerId: number, team: string, opponent: string) =>
  `${season}:${date}:${playerId}:${normalizeNbaTeamCode(team)}:${normalizeNbaTeamCode(opponent)}`;
export const environmentKey = (environment: MatchupEnvironment) => `environment:${EVALUATION_MODEL}:${environment.season}:${environment.fetchedAt}`;
function assertInputs(week: ScoresWeek, availableAt: string, now: number) {
  if (![week.fetchedAt, availableAt].every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now)) throw new Error('Forecast inputs must predate capture');
}
export function evaluationGame(week: ScoresWeek, player: ScorePlayer, period: number): EvaluationGame | null {
  const day = week.days.find(d => d.scoringPeriodId === period), game = day?.games?.[player.proTeam];
  if (!day || !game || !game.tipoff || game.status !== 'upcoming' || !Number.isFinite(Date.parse(game.tipoff))) return null;
  return { key: evaluationKey(week.season, day.date, player.id, player.proTeam, game.opponent), date: day.date, playerId: player.id,
    team: normalizeNbaTeamCode(player.proTeam), opponent: normalizeNbaTeamCode(game.opponent), tipoff: game.tipoff };
}
/** First immutable capture in the two hours before tip-off; no historical reconstruction. */
export function buildEvaluationForecasts(week: ScoresWeek, priors: Record<string, number>, environment: MatchupEnvironment | null,
  availableAt: string, scoring: readonly ScoringItem[], now: number): ForecastRecord[] {
  assertInputs(week, availableAt, now);
  const result = new Map<string, ForecastRecord>();
  for (const side of week.matchups.flatMap(m => [m.home, m.away])) for (const player of side.players) for (const day of week.days) {
    const game = evaluationGame(week, player, day.scoringPeriodId);
    if (!game || Date.parse(game.tipoff) <= now || Date.parse(game.tipoff) - now > 2 * 3600000) continue;
    const baseline = expectedPointsForGame(player, { scoringPeriodId: day.scoringPeriodId, preseason: priors[String(player.id)] ?? null });
    const adjusted = matchupGameProjection(player, day.scoringPeriodId, baseline, week, environment, scoring, now);
    const inputPlayer = { ...player, days: {}, projByDay: { [String(day.scoringPeriodId)]: player.projByDay[String(day.scoringPeriodId)] } };
    result.set(game.key, { ...game, kind: 'forecast', id: `forecast:${EVALUATION_MODEL}:${game.key}`, season: week.season,
      capturedAt: new Date(now).toISOString(), model: EVALUATION_MODEL, baseline, adjusted: adjusted.points, source: adjusted.source,
      input: { player: inputPlayer, period: day.scoringPeriodId, preseason: priors[String(player.id)] ?? null,
        environmentId: adjusted.source === 'matchup' && environment ? environmentKey(environment) : null, scoring, availableAt } });
  }
  return [...result.values()];
}
export function buildEvaluationPlan(week: ScoresWeek, side: ScoreSide, lineup: LineupSnapshot, cap: number, priors: Record<string, number>,
  environment: MatchupEnvironment | null, availableAt: string, scoring: readonly ScoringItem[], now: number): PlanRecord | null {
  assertInputs(week, availableAt, now);
  if (!Number.isFinite(Date.parse(lineup.fetchedAt)) || Date.parse(lineup.fetchedAt) > now || now - Date.parse(lineup.fetchedAt) > 30000) return null;
  const baseline = (p: ScorePlayer, period: number) => expectedPointsForGame(p, { scoringPeriodId: period, preseason: priors[String(p.id)] ?? null });
  const adjusted = (p: ScorePlayer, period: number) => matchupGameProjection(p, period, baseline(p, period), week, environment, scoring, now).points;
  if (!side.players.some(player => week.days.some(day => matchupGameProjection(player, day.scoringPeriodId, baseline(player, day.scoringPeriodId), week, environment, scoring, now).source === 'matchup'))) return null;
  const basePlan = planWeeklyLineup(lineup, side, week, cap, baseline, now), adjustedPlan = planWeeklyLineup(lineup, side, week, cap, adjusted, now);
  const games = (starts: PlannedStart[]) => starts.flatMap(start => {
    const player = side.players.find(p => p.id === start.playerId), game = player && evaluationGame(week, player, start.period);
    return game && Date.parse(game.tipoff) > now ? [game] : [];
  });
  const baselineGames = games(basePlan.starts), adjustedGames = games(adjustedPlan.starts);
  if (!baselineGames.length && !adjustedGames.length) return null;
  return { kind: 'plan', id: `plan:${EVALUATION_MODEL}:${week.season}:${week.matchupPeriodId}:${side.teamId}`, model: EVALUATION_MODEL,
    season: week.season, capturedAt: new Date(now).toISOString(), week: week.matchupPeriodId, teamId: side.teamId, cap, used: basePlan.used,
    baseline: baselineGames, adjusted: adjustedGames,
    input: { lineup, side, week, priors, scoring, environmentId: environment ? environmentKey(environment) : null, availableAt } };
}
interface Pair { baseline: number; adjusted: number; actual: number; date: string; played: boolean }
function metrics(pairs: readonly Pair[], key: 'baseline' | 'adjusted') {
  if (!pairs.length) return null;
  const errors = pairs.map(pair => pair[key] - pair.actual);
  return { mae: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length), bias: errors.reduce((sum, value) => sum + value, 0) / errors.length };
}
function comparison(pairs: Pair[]) {
  const baseline = metrics(pairs, 'baseline'), adjusted = metrics(pairs, 'adjusted');
  return { games: pairs.length, days: new Set(pairs.map(p => p.date)).size, baseline, adjusted,
    maeImprovement: baseline && adjusted ? baseline.mae - adjusted.mae : null };
}
/** Paired outcomes only. Positive improvement/gain favors the matchup model. */
export function projectionEvaluationReport(records: readonly EvaluationRecord[], now = Date.now()) {
  const valid = records.filter(record => record.model === EVALUATION_MODEL && Number.isFinite(Date.parse(record.capturedAt)) && Date.parse(record.capturedAt) <= now);
  const unique = new Map<string, EvaluationRecord>();
  for (const record of [...valid].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) if (!unique.has(record.id)) unique.set(record.id, record);
  const rows = [...unique.values()];
  const results = new Map(rows.filter((r): r is ResultRecord => r.kind === 'result').map(r => [r.key, r]));
  const pairs: Pair[] = [], matchupPairs: Pair[] = [];
  let captured = 0, pending = 0, invalid = 0, dnp = 0, adjustedCaptures = 0, missingBaselines = 0;
  const actual = (game: EvaluationGame, capturedAt: string, scoring: readonly ScoringItem[]) => {
    const result = results.get(game.key);
    if (!result || !Number.isFinite(Date.parse(result.tipoff)) || (!result.played && result.explicitDnp !== true) || Date.parse(capturedAt) >= Date.parse(game.tipoff) || Date.parse(capturedAt) >= Date.parse(result.tipoff)
      || Date.parse(result.capturedAt) < Date.parse(result.tipoff) || (result.played && scoring.some(item => !Number.isFinite(result.stats[String(item.statId)])))) return null;
    return { points: result.played ? scoreLine({ stats: result.stats }, scoring) : 0, played: result.played };
  };
  for (const row of rows) if (row.kind === 'forecast') {
    if (!Number.isFinite(row.baseline) || !Number.isFinite(row.adjusted) || row.baseline < 0 || row.adjusted < 0
      || !Number.isFinite(Date.parse(row.tipoff)) || Date.parse(row.capturedAt) >= Date.parse(row.tipoff)
      || !Number.isFinite(Date.parse(row.input.availableAt)) || Date.parse(row.input.availableAt) > Date.parse(row.capturedAt)) { invalid++; continue; }
    if (row.source === 'matchup') {
      const environment = row.input.environmentId && unique.get(row.input.environmentId);
      if (!environment || environment.kind !== 'environment' || environment.season !== row.season || !Number.isFinite(Date.parse(environment.environment.fetchedAt)) || Date.parse(environment.environment.fetchedAt) > Date.parse(row.capturedAt)) { invalid++; continue; }
      adjustedCaptures++;
    }
    captured++;
    if (![row.input.player.projByDay[String(row.input.period)], row.input.player.last15, row.input.player.seasonAvg, row.input.preseason].some(value => typeof value === 'number' && Number.isFinite(value))) { missingBaselines++; continue; }
    const result = actual(row, row.capturedAt, row.input.scoring);
    if (!result) { pending++; continue; }
    const pair = { baseline: row.baseline, adjusted: row.adjusted, actual: result.points, date: row.date, played: result.played };
    pairs.push(pair); if (!result.played) dnp++;
    if (row.source === 'matchup') matchupPairs.push(pair);
  }
  const plans = rows.filter((r): r is PlanRecord => r.kind === 'plan');
  const gains: number[] = [];
  for (const plan of plans) {
    if (![plan.input.availableAt, plan.input.lineup.fetchedAt].every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(plan.capturedAt))) continue;
    const base = plan.baseline.map(game => actual(game, plan.capturedAt, plan.input.scoring));
    const adjusted = plan.adjusted.map(game => actual(game, plan.capturedAt, plan.input.scoring));
    if ([...base, ...adjusted].some(value => value === null)) continue;
    gains.push(adjusted.reduce((sum, value) => sum + value!.points, 0) - base.reduce((sum, value) => sum + value!.points, 0));
  }
  return { model: EVALUATION_MODEL, captured, adjustedCaptures, pending, invalid, dnp, missingBaselines,
    lastCaptureAt: rows.filter(row => row.kind === 'forecast').map(row => row.capturedAt).sort().at(-1) ?? null,
    lastResultAt: rows.filter(row => row.kind === 'result').map(row => row.capturedAt).sort().at(-1) ?? null,
    all: comparison(pairs), matchupOnly: comparison(matchupPairs), activeOnly: comparison(matchupPairs.filter(pair => pair.played)),
    lineups: { captured: plans.length, completed: gains.length, meanGain: gains.length ? gains.reduce((sum, gain) => sum + gain, 0) / gains.length : null },
    status: matchupPairs.length >= 100 && new Set(matchupPairs.map(pair => pair.date)).size >= 14 ? 'Comparison available; review paired errors and coverage.' : 'Collecting evidence; no accuracy conclusion yet.' };
}
export type ProjectionEvaluationReport = ReturnType<typeof projectionEvaluationReport>;
