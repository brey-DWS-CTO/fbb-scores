/**
 * Win % trend: how each matchup's win chance moved over the week.
 *
 * A clock runs every 15 minutes. It reads one NBA scoreboard and stops
 * unless a game is on, a game just ended, or it is the 7 AM morning check.
 * When it runs, it works out every matchup's win chance the way the score
 * pages do and saves a point only when something moved.
 *
 * Days that are over do not change, so the clock keeps a trimmed copy of
 * each one (lineups and that day's stat rows) and reads only today from
 * ESPN. Future days are kept for the day they were read on.
 *
 * Pure. No server, no browser.
 */
import { expectedPointsForGame } from './dailyProjection.js';
import {
  matchupChance,
  sideOdds,
  type ExpectedPoints,
  type GameLine,
  type ScoresWeek,
} from './scores.js';
import { sideMean } from './winOdds.js';

/** One saved moment for one matchup. */
export interface TrendPoint {
  matchupId: number;
  /** ISO. */
  takenAt: string;
  /** The home side's chance, whole percents. The away side has the rest. */
  homePct: number;
  homePoints: number;
  awayPoints: number;
  /** Projected finals at that moment, for checking the model against results later. */
  homeProj: number;
  awayProj: number;
}

export interface TrendRow extends TrendPoint {
  season: number;
  matchupPeriodId: number;
  homeTeamId: number;
  awayTeamId: number;
}

/** Why a clock run does the full read, or null when it stops at the scoreboard. */
export type TrendRun = 'morning' | 'live' | 'final';

/** A game ends about two and a half hours after tip-off; this leaves room for overtime and delays. */
export const FINAL_WINDOW_MS = 3.25 * 60 * 60 * 1000;

const round1 = (value: number): number => Math.round(value * 10) / 10;

function zoneParts(now: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: read('hour'), minute: read('minute') };
}

/**
 * West Coast games run past midnight in New York, where ESPN keeps its
 * days. Until 6 AM there, last night's slate still counts.
 */
export function slateDates(now: Date, espnToday: string, addDays: (iso: string, days: number) => string): string[] {
  return zoneParts(now, 'America/New_York').hour < 6 ? [addDays(espnToday, -1), espnToday] : [espnToday];
}

/**
 * The cheap check. A live game, or a final whose tip-off was in the last
 * few hours, means scores may have moved. 7:00 to 7:14 AM Pacific is the
 * morning point, taken whether or not anything moved overnight.
 */
export function trendRunReason(now: Date, games: readonly GameLine[]): TrendRun | null {
  if (games.some((game) => game.status === 'live')) return 'live';
  const at = now.getTime();
  const justEnded = games.some((game) => {
    if (game.status !== 'final' || !game.tipoff) return false;
    const since = at - Date.parse(game.tipoff);
    return since >= 0 && since <= FINAL_WINDOW_MS;
  });
  if (justEnded) return 'final';
  const pacific = zoneParts(now, 'America/Los_Angeles');
  return pacific.hour === 7 && pacific.minute < 15 ? 'morning' : null;
}

/**
 * Expected points the way a signed-out viewer's score page has them:
 * ESPN's daily projection, else the blend, with the preseason figure taken
 * from `preseason` by ESPN player id.
 */
export function expectedFromPreseason(preseason: ReadonlyMap<number, number>): ExpectedPoints {
  return (player, scoringPeriodId) => expectedPointsForGame(player, { scoringPeriodId, preseason: preseason.get(player.id) ?? null });
}

/** One point per matchup in the week being read. */
export function snapshotRows(week: ScoresWeek, expected: ExpectedPoints, takenAt: string): TrendRow[] {
  return week.matchups.map((matchup) => ({
    season: week.season,
    matchupPeriodId: week.matchupPeriodId,
    matchupId: matchup.id,
    homeTeamId: matchup.home.teamId,
    awayTeamId: matchup.away.teamId,
    takenAt,
    homePct: matchupChance(matchup, week, expected).home,
    homePoints: round1(matchup.home.total),
    awayPoints: round1(matchup.away.total),
    homeProj: round1(sideMean(sideOdds(matchup.home, week, expected))),
    awayProj: round1(sideMean(sideOdds(matchup.away, week, expected))),
  }));
}

/**
 * The rows worth saving: those whose chance or score moved since the last
 * saved point for that matchup. A morning run saves every row.
 */
export function rowsToSave(rows: readonly TrendRow[], latest: ReadonlyMap<number, TrendPoint>, run: TrendRun): TrendRow[] {
  if (run === 'morning') return [...rows];
  return rows.filter((row) => {
    const last = latest.get(row.matchupId);
    return !last || last.homePct !== row.homePct || last.homePoints !== row.homePoints || last.awayPoints !== row.awayPoints;
  });
}

// ─── Trimmed days ───────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;
const dict = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function dayRows(rows: unknown, scoringPeriodId: number): unknown[] {
  return list(rows).filter((row) => dict(row).scoringPeriodId === scoringPeriodId);
}

/**
 * What the week reader needs from a day that is not today: who was in
 * which slot, and the stat rows filed for that day. Totals, team details
 * and season splits come from today's read, so they are left out. A few
 * kilobytes instead of ESPN's full answer.
 */
export function trimDayPayload(payload: unknown, scoringPeriodId: number, matchupPeriodId: number): unknown {
  const schedule = list(dict(payload).schedule)
    .map(dict)
    .filter((matchup) => matchup.matchupPeriodId === matchupPeriodId)
    .map((matchup) => {
      const side = (raw: unknown) => {
        const body = dict(raw);
        return {
          teamId: body.teamId,
          rosterForCurrentScoringPeriod: {
            entries: list(dict(body.rosterForCurrentScoringPeriod).entries).map((rawEntry) => {
              const entry = dict(rawEntry);
              const pool = dict(entry.playerPoolEntry);
              const player = dict(pool.player);
              return {
                lineupSlotId: entry.lineupSlotId,
                playerPoolEntry: {
                  id: pool.id,
                  appliedStatTotal: pool.appliedStatTotal,
                  stats: dayRows(pool.stats, scoringPeriodId),
                  player: {
                    id: player.id,
                    fullName: player.fullName,
                    proTeamId: player.proTeamId,
                    defaultPositionId: player.defaultPositionId,
                    injuryStatus: player.injuryStatus,
                    stats: dayRows(player.stats, scoringPeriodId),
                  },
                },
              };
            }),
          },
        };
      };
      return { id: matchup.id, matchupPeriodId: matchup.matchupPeriodId, home: side(matchup.home), away: side(matchup.away) };
    });
  return { scoringPeriodId, schedule };
}

/** A kept day, with what is needed to know whether it can be used again. */
export interface CachedDay {
  scoringPeriodId: number;
  date: string;
  /** The ESPN day it was read on. */
  readOn: string;
  payload: unknown;
  games: Record<string, GameLine> | null;
}

/**
 * A day that was over when it was read never changes. A day still to come
 * is good for the ESPN day it was read on: lineups and game times rarely
 * move within a day, and a new day reads it again.
 */
export function cachedDayUsable(day: CachedDay | null | undefined, currentScoringPeriodId: number, espnToday: string): day is CachedDay {
  if (!day) return false;
  if (day.scoringPeriodId < currentScoringPeriodId) return day.readOn > day.date;
  if (day.scoringPeriodId > currentScoringPeriodId) return day.readOn === espnToday;
  return false;
}

// ─── The chart ──────────────────────────────────────────────────────────────

export interface TrendDot {
  x: number;
  y: number;
  point: TrendPoint;
}

export interface TrendChart {
  /** SVG path through every point. Empty with no points. */
  path: string;
  dots: TrendDot[];
  /** One mark per day that has points, at its first point. */
  days: Array<{ x: number; date: string }>;
  /** Where 50% sits. */
  midY: number;
}

/** Start of an ESPN day, close enough for a chart: midnight in New York. */
function dayStartMs(date: string): number {
  return Date.parse(`${date}T05:00:00Z`);
}

/**
 * Lay the points out evenly, oldest on the left, with the home side's
 * chance bottom (0%) to top (100%). Even spacing, not clock time: the
 * swings happen in a few game hours a night, and a clock axis would squeeze
 * them into slivers between long flat nights. Each day is marked at its
 * first point.
 */
export function trendChart(points: readonly TrendPoint[], dates: readonly string[], width: number, height: number): TrendChart {
  const midY = height / 2;
  const sorted = [...points].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const step = sorted.length > 1 ? width / (sorted.length - 1) : 0;
  const y = (pct: number) => round1(height - (Math.min(100, Math.max(0, pct)) / 100) * height);
  const dots = sorted.map((point, index) => ({ x: round1(sorted.length > 1 ? index * step : width / 2), y: y(point.homePct), point }));
  const path = dots.map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x} ${dot.y}`).join(' ');
  const days: TrendChart['days'] = [];
  for (const [index, date] of dates.entries()) {
    const from = dayStartMs(date);
    const to = index + 1 < dates.length ? dayStartMs(dates[index + 1]) : Infinity;
    const first = dots.find((dot) => {
      const at = Date.parse(dot.point.takenAt);
      return at >= from && at < to;
    });
    if (first) days.push({ x: first.x, date });
  }
  return { path, dots, days, midY };
}

/** The point nearest an x position on the chart, for a tap or a hover. */
export function nearestDot(dots: readonly TrendDot[], x: number): TrendDot | null {
  let best: TrendDot | null = null;
  for (const dot of dots) if (!best || Math.abs(dot.x - x) < Math.abs(best.x - x)) best = dot;
  return best;
}
