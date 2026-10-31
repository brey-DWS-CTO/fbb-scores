/**
 * The win % clock: every 15 minutes, save how each matchup's chance moved.
 *
 * The cheap check reads one NBA scoreboard (two in the small hours, when
 * last night's late games still count) and stops there unless a game is on,
 * one just ended, or it is the 7 AM morning point. Only then does it touch
 * ESPN's league data or the database, so a quiet hour wakes neither.
 *
 * The full read takes the league settings and today's box score from ESPN.
 * Every other day of the week comes from a trimmed copy kept in the
 * database: a finished day is read once, a day still to come once a day.
 * The rules live in src/lib/league/winTrend.ts.
 */
import {
  addDaysIso,
  beforeSeason,
  espnToday,
  planWeek,
  readEspnWeek,
  scoringPeriodDates,
  type EspnDayInput,
  type GameLine,
} from '../../src/lib/league/scores.js';
import {
  cachedDayUsable,
  expectedFromPreseason,
  rowsToSave,
  slateDates,
  snapshotRows,
  trendRunReason,
  trimDayPayload,
  type CachedDay,
  type TrendRun,
} from '../../src/lib/league/winTrend.js';
import { historicalScoreBaselines } from '../../src/lib/league/scoreBaseline.js';
import { projectedFppg } from '../../src/lib/league/draftRankings.js';
import { capForWeek } from '../../src/lib/league/gamesCap.js';
import { resolveCurrentDraftRankings } from './draftRankingService.js';
import {
  getState,
  getTrendDays,
  latestTrendPoints,
  listGamesCaps,
  saveTrendDay,
  saveTrendRows,
} from './leagueStore.js';
import { espnClientFromEnv, fetchNbaGamesForDate } from './scoresWeekService.js';

export interface WinTrendRun {
  run: TrendRun | null;
  /** Points saved this run. */
  saved: number;
  /** ESPN league reads this run, for the cost log. */
  espnReads: number;
  /** Why a run stopped early, when it did. */
  skipped?: string;
}

/** The preseason figure for each player: last season's average, then the active projection. */
async function preseasonFigures(): Promise<Map<number, number>> {
  const byId = new Map(historicalScoreBaselines);
  try {
    const { state } = await getState();
    const snapshot = await resolveCurrentDraftRankings(state);
    for (const player of snapshot.players) {
      const value = projectedFppg(player.projection, snapshot.scoringItems);
      if (value !== null) byId.set(player.espnId, value);
    }
  } catch (err) {
    // Last season's averages still give every player a figure.
    console.error('[win-trend] projections unavailable:', err instanceof Error ? err.message : err);
  }
  return byId;
}

export async function runWinTrendClock(now: Date = new Date()): Promise<WinTrendRun> {
  const today = espnToday(now);
  const slate = new Map<string, Record<string, GameLine> | null>();
  for (const date of slateDates(now, today, addDaysIso)) slate.set(date, await fetchNbaGamesForDate(date));
  const games = [...slate.values()].flatMap((day) => (day ? Object.values(day) : []));
  const run = trendRunReason(now, games);
  if (!run) return { run, saved: 0, espnReads: 0 };
  if (beforeSeason(today)) return { run, saved: 0, espnReads: 0, skipped: 'before the season' };

  const client = espnClientFromEnv();
  const settings = await client.fetchWeekSettings();
  let espnReads = 1;
  const known = scoringPeriodDates((settings as { settings?: { proTeams?: unknown } } | null)?.settings?.proTeams);
  const first = known.entries().next().value;
  if (!first) return { run, saved: 0, espnReads, skipped: 'no schedule from ESPN' };
  const plan = planWeek(settings, null, { scoringPeriodId: first[0], date: first[1], source: 'pro-schedule' });
  if (plan.matchupPeriodId !== plan.currentMatchupPeriodId) return { run, saved: 0, espnReads, skipped: 'between weeks' };

  const current = plan.currentScoringPeriodId;
  const others = plan.days.filter((day) => day.scoringPeriodId !== current);
  const kept = new Map((await getTrendDays(plan.season, others.map((day) => day.scoringPeriodId)))
    .map((day) => [day.scoringPeriodId, day]));
  const gamesFor = async (date: string) => (slate.has(date) ? slate.get(date) ?? null : fetchNbaGamesForDate(date));

  const days: EspnDayInput[] = [];
  // Today goes first: the reader takes names, injuries and totals from the
  // first day it sees, and only today's read is current.
  const todayPlan = plan.days.find((day) => day.scoringPeriodId === current);
  if (todayPlan) {
    const [payload, dayGames] = await Promise.all([client.fetchDailyBoxScore(current), gamesFor(todayPlan.date)]);
    espnReads += 1;
    days.push({ scoringPeriodId: current, date: todayPlan.date, payload, games: dayGames });
  }
  for (const day of others) {
    const cached = kept.get(day.scoringPeriodId);
    if (cachedDayUsable(cached, current, today)) {
      days.push(cached);
      continue;
    }
    const [payload, dayGames] = await Promise.all([client.fetchDailyBoxScore(day.scoringPeriodId), gamesFor(day.date)]);
    espnReads += 1;
    const fresh: CachedDay = {
      scoringPeriodId: day.scoringPeriodId,
      date: day.date,
      readOn: today,
      payload: trimDayPayload(payload, day.scoringPeriodId, plan.matchupPeriodId),
      games: dayGames,
    };
    await saveTrendDay(plan.season, fresh);
    days.push(fresh);
  }

  const loaded = readEspnWeek({ plan, settings, days, fetchedAt: now.toISOString() });
  const [caps, preseason, latest] = await Promise.all([
    listGamesCaps(loaded.season),
    preseasonFigures(),
    latestTrendPoints(loaded.season, loaded.matchupPeriodId),
  ]);
  const week = { ...loaded, gamesCap: capForWeek(caps, loaded.matchupPeriodId, loaded.gamesCap) };
  const rows = snapshotRows(week, expectedFromPreseason(preseason), now.toISOString());
  const save = rowsToSave(rows, new Map(latest.map((point) => [point.matchupId, point])), run);
  await saveTrendRows(save);
  return { run, saved: save.length, espnReads };
}
