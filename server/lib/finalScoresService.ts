import { gamesOn } from './nbaDay.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import { round1 } from '../../src/lib/espn/calculations.js';
import { addDaysIso, gamesCapProjection, type ScoresWeek } from '../../src/lib/league/scores.js';
import { capForWeek } from '../../src/lib/league/gamesCap.js';
import { appendAudit, listGamesCaps, readAudit } from './leagueStore.js';
import { describeWrite, espnLmConfig, setMatchupAdjustments } from './espnLm.js';
import { loadWeek, loadWeekPlan } from './scoresWeekService.js';

interface EspnSide { teamId: number; totalPoints: number; totalPointsLive?: number; adjustment?: number; adjustmentReason?: string }
export interface EspnFinalMatchup { id: number; matchupPeriodId: number; home: EspnSide; away: EspnSide }
const REASON = 'FBB Scores: uncapped NBA box scores and league game limit';

/** Replacements, never additive corrections: retrying cannot double-credit points. */
export function finalScoreUpdates(week: ScoresWeek, raw: EspnFinalMatchup[]) {
  if (!week.scoringItems?.length || !week.matchups.length) throw new Error('Missing scoring rules or matchups');
  if (week.days.some(day => !day.games || Object.values(day.games).some(game => game.status !== 'final' && game.status !== 'off'))) {
    throw new Error('Games are unfinished or the NBA scoreboard is incomplete');
  }
  const finalWeek = { ...week, currentScoringPeriodId: Math.max(...week.days.map(day => day.scoringPeriodId)) + 1 };
  return week.matchups.flatMap(matchup => {
    const source = raw.find(row => row.id === matchup.id && row.matchupPeriodId === week.matchupPeriodId);
    if (!source) throw new Error(`Missing ESPN matchup ${matchup.id}`);
    const update = { id: matchup.id, home: {}, away: {} };
    let changed = false;
    for (const key of ['home', 'away'] as const) {
      const side = matchup[key], original = source[key];
      if (!side.players.length || week.days.some(day => !side.players.some(player => player.days[String(day.scoringPeriodId)]))) throw new Error(`Missing historical lineup for team ${side.teamId}`);
      if (original.teamId !== side.teamId) throw new Error('ESPN matchup teams changed');
      for (const player of side.players) for (const day of week.days) {
        const line = player.days[String(day.scoringPeriodId)];
        if (!line) continue;
        if (line.started && line.game?.status === 'final' && !line.rawStats) throw new Error(`Missing stats for player ${player.id}`);
      }
      const target = round1(side.total - gamesCapProjection(side, finalWeek, () => 0).scoredDeduction);
      const total = original.totalPointsLive ?? original.totalPoints;
      const previous = original.adjustment ?? 0;
      if (!Number.isFinite(total) || !Number.isFinite(target) || !Number.isFinite(previous)) throw new Error('Invalid final score');
      const adjustment = round1(target - (total - previous));
      if (Math.abs(adjustment - previous) < 0.05) continue;
      if (previous !== 0 && original.adjustmentReason !== REASON) throw new Error(`Team ${side.teamId} has a manual ESPN adjustment; review required`);
      update[key] = { teamId: side.teamId, adjustment, adjustmentReason: REASON };
      changed = true;
    }
    // ESPN requires both sides, even when only one changes.
    for (const key of ['home', 'away'] as const) if (!('teamId' in update[key])) {
      update[key] = { teamId: source[key].teamId, adjustment: source[key].adjustment ?? 0, adjustmentReason: source[key].adjustmentReason ?? '' };
    }
    return changed ? [update] : [];
  });
}

export function finalScoreNotBefore(schedule: readonly { tipoff: string }[]): number | null {
  const latest = Math.max(...schedule.map(game => Date.parse(game.tipoff)));
  return Number.isFinite(latest) ? latest + 150 * 60_000 : null;
}

/** Scheduled after the final tipoff; hourly fallback runs stop after verified success. */
export async function reconcileFinalScores(now = new Date()) {
  const config = espnLmConfig();
  if (!config) throw new Error('Missing ESPN league-manager credentials');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const client = new EspnClient({ leagueId: config.leagueId, seasonId: config.seasonId, cookieOverride: config.cookie });
  const { plan } = await loadWeekPlan(client, null);
  const closing = plan.weeks.find(ref => ref.endDate === today || ref.endDate === addDaysIso(today, -1));
  if (!closing) return { skipped: 'No fantasy week closing today or yesterday' };
  const verified = (await readAudit(1000)).some(row => row.action === 'scores.final.verified'
    && (row.detail as { season?: number; matchupPeriodId?: number })?.season === plan.season
    && (row.detail as { matchupPeriodId?: number })?.matchupPeriodId === closing.matchupPeriodId);
  if (verified) return { skipped: 'Final scores already verified', matchupPeriodId: closing.matchupPeriodId };
  const schedule = await gamesOn(closing.endDate);
  const notBefore = finalScoreNotBefore(schedule);
  if (notBefore !== null && now.getTime() < notBefore) return { skipped: 'Before scheduled final-game completion' };
  const week = await loadWeek(client, closing.matchupPeriodId);
  if (week.days.some(day => !day.games || Object.values(day.games).some(game => game.status !== 'final' && game.status !== 'off'))) return { skipped: 'Waiting for every game to finish' };
  week.gamesCap = capForWeek(await listGamesCaps(week.season), week.matchupPeriodId);
  const raw = await client.fetchDailyBoxScore(week.days.at(-1)!.scoringPeriodId);
  const updates = finalScoreUpdates(week, raw.schedule as unknown as EspnFinalMatchup[]);
  if (!updates.length) {
    await appendAudit(null, 'scores.final.verified', { season: week.season, matchupPeriodId: week.matchupPeriodId, changed: 0 });
    return { changed: 0, matchupPeriodId: week.matchupPeriodId };
  }
  await appendAudit(null, 'scores.final.planned', { season: week.season, matchupPeriodId: week.matchupPeriodId, cap: week.gamesCap, updates });
  const result = await setMatchupAdjustments(config, updates);
  await appendAudit(null, 'scores.final.result', { matchupPeriodId: week.matchupPeriodId, result });
  if (!result.ok) throw new Error(describeWrite(result));
  if (!result.dryRun) {
    const verify = await client.fetchDailyBoxScore(week.days.at(-1)!.scoringPeriodId);
    if (finalScoreUpdates(week, verify.schedule as unknown as EspnFinalMatchup[]).length) throw new Error('ESPN has not confirmed the corrected totals; next run will retry');
    await appendAudit(null, 'scores.final.verified', { season: week.season, matchupPeriodId: week.matchupPeriodId, changed: updates.length });
  }
  return { changed: updates.length, dryRun: result.dryRun, matchupPeriodId: week.matchupPeriodId };
}
