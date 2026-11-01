import { getState, listGamesCaps } from './leagueStore.js';
import { loadScoresWeek } from './scoresWeekService.js';
import { getMatchupEnvironment } from './matchupEnvironment.js';
import { getDailyNbaScores } from './dailyScorersService.js';
import { projectionEvaluationStore, type EvaluationStore } from './projectionEvaluationStore.js';
import { resolveCurrentDraftRankings } from './draftRankingService.js';
import { historicalScoreBaselines } from '../../src/lib/league/scoreBaseline.js';
import { projectedFppg } from '../../src/lib/league/draftRankings.js';
import { capForWeek } from '../../src/lib/league/gamesCap.js';
import { LEAGUE_SCORING } from '../../src/lib/league/partyScore.js';
import { normalizeNbaTeamCode } from '../../src/lib/league/schedule.js';
import { EspnReadOnlyLineupProvider, espnLineupReadConfig } from './lineup/espnReadOnly.js';
import { EVALUATION_MODEL, buildEvaluationForecasts, buildEvaluationPlan, environmentKey, projectionEvaluationReport,
  type EvaluationRecord, type EvaluationGame, type ResultRecord } from '../../src/lib/league/projectionEvaluation.js';
import type { DailyNbaScores } from '../../src/lib/league/dailyScorers.js';

/** Missing lines and missing stats never turn into a zero/DNP result. */
export function finalizedEvaluationResult(game: EvaluationGame, day: DailyNbaScores, season: number, now: number): ResultRecord | null {
  const candidates = day.games.filter(g => g.state === 'post' && [normalizeNbaTeamCode(g.home), normalizeNbaTeamCode(g.away)].includes(game.team)
    && [normalizeNbaTeamCode(g.home), normalizeNbaTeamCode(g.away)].includes(game.opponent));
  if (candidates.length !== 1) return null;
  const match = candidates[0], box = day.boxScores.find(b => b.gameId === match.id && b.state === 'post');
  const line = box?.lines.find(row => row.athleteId === String(game.playerId) && normalizeNbaTeamCode(row.team) === game.team);
  if (!line || (!line.played && line.didNotPlay !== true) || !Number.isFinite(Date.parse(match.tipoff)) || Date.parse(match.tipoff) >= now
    || !Number.isFinite(Date.parse(day.fetchedAt)) || Date.parse(day.fetchedAt) > now) return null;
  const complete = LEAGUE_SCORING.every(item => Number.isFinite(line.stats[String(item.statId)]));
  if (line.played && !complete) return null;
  return { kind: 'result', id: `result:${EVALUATION_MODEL}:${game.key}`, key: game.key, season, model: EVALUATION_MODEL,
    capturedAt: new Date(now).toISOString(), gameId: match.id, tipoff: match.tipoff, played: line.played, ...(line.didNotPlay === true ? { explicitDnp: true as const } : {}), stats: line.played ? line.stats : {} };
}
export async function settleEvaluationResults(store: EvaluationStore, season: number, read = getDailyNbaScores, clock = Date.now) {
  const records = await store.read(season, new Date(clock() - 30 * 86400000).toISOString(), false);
  const completed = new Set(records.filter(row => row.kind === 'result').map(row => row.key));
  const references = new Map<string, EvaluationGame>();
  for (const row of records) {
    const games = row.kind === 'forecast' ? [row] : row.kind === 'plan' ? [...row.baseline, ...row.adjusted] : [];
    for (const game of games) if (!completed.has(game.key) && Date.parse(game.tipoff) < clock()) references.set(game.key, game);
  }
  const dates = [...new Set([...references.values()].map(game => game.date))].sort();
  // Recent results plus one oldest backlog date prevent a postponed/missing game from blocking newer scoring.
  const selected = [...new Set([...dates.slice(-3), ...dates.slice(0, 1)])];
  let resolved = 0, failures = 0;
  for (const date of selected) {
    try {
      const day = await read(date);
      const results = [...references.values()].filter(game => game.date === date).flatMap(game => {
        const result = finalizedEvaluationResult(game, day, season, clock()); return result ? [result] : [];
      });
      await store.append(results); resolved += results.length;
    } catch { failures++; }
  }
  return { resolved, failures };
}
export async function readProjectionEvaluation() {
  const { state } = await getState();
  return projectionEvaluationReport(await projectionEvaluationStore().read(state.season));
}
let running: Promise<unknown> | null = null;
/** Existing authenticated hourly tick captures both models before games, then scores only final results. */
export function runProjectionEvaluationClock(now = new Date()): Promise<unknown> {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour < 7 || hour > 23 || !espnLineupReadConfig()) return Promise.resolve({ skipped: true });
  if (running) return running;
  running = (async () => {
    const { state } = await getState(), store = projectionEvaluationStore();
    let forecasts = 0, plans = 0, planFailures = 0, captureFailed = false;
    try {
      const week = await loadScoresWeek(null);
      if (week.season !== state.season) throw new Error('Evaluation season mismatch');
      const [feed, snapshot, caps, existing] = await Promise.all([getMatchupEnvironment(week.season), resolveCurrentDraftRankings(state), listGamesCaps(week.season), store.read(week.season, new Date(Date.now() - 30 * 86400000).toISOString(), false)]);
      const scoring = week.scoringItems ?? LEAGUE_SCORING;
      const priors = Object.fromEntries(historicalScoreBaselines);
      if (snapshot.season === week.season) for (const player of snapshot.players) {
        const value = projectedFppg(player.projection, scoring); if (value !== null) priors[String(player.espnId)] = value;
      }
      const availableAt = snapshot.season === week.season && snapshot.players.length ? new Date(Math.max(...[week.fetchedAt, snapshot.createdAt, snapshot.fetchedAt, state.draftRankings?.acceptedAt ?? snapshot.createdAt].map(Date.parse))).toISOString() : week.fetchedAt;
      const captureTime = Date.now(), environment = feed.environment;
      const additions: EvaluationRecord[] = buildEvaluationForecasts(week, priors, environment, availableAt, scoring, captureTime);
      if (environment && additions.some(row => row.kind === 'forecast' && row.source === 'matchup')) additions.unshift({ kind: 'environment', id: environmentKey(environment), season: week.season, model: EVALUATION_MODEL, capturedAt: environment.fetchedAt, environment });
      await store.append(additions);
      forecasts = additions.filter(row => row.kind === 'forecast').length;
      const provider = new EspnReadOnlyLineupProvider();
      // Capture frozen lineup choices only for already-authorized pilot teams; no access is granted here.
      for (const grant of Object.values(state.lineupManagement?.grants ?? {})) {
        if (!grant.enabled || existing.some(row => row.kind === 'plan' && row.week === week.matchupPeriodId && row.teamId === grant.teamId)) continue;
        const side = week.matchups.flatMap(match => [match.home, match.away]).find(team => team.teamId === grant.teamId);
        if (!side) continue;
        try {
          const lineup = await provider.read(grant);
          const plan = buildEvaluationPlan(week, side, lineup, capForWeek(caps, week.matchupPeriodId, week.gamesCap), priors, environment, availableAt, scoring, Date.now());
          if (plan) { await store.append(environment ? [{ kind: 'environment', id: environmentKey(environment), season: week.season, model: EVALUATION_MODEL, capturedAt: environment.fetchedAt, environment }, plan] : [plan]); plans++; }
        } catch { planFailures++; }
      }
    } catch { captureFailed = true; }
    const settled = await settleEvaluationResults(store, state.season);
    return { forecastCandidates: forecasts, plans, planFailures, captureFailed, ...settled };
  })().finally(() => { running = null; });
  return running;
}
