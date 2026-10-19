/**
 * Daily projections: what a player should score in one game, and what a
 * side should finish a day and the week on.
 *
 * ESPN's own projection for the day wins when it sends one. Otherwise the
 * number is a blend of three averages, each a fantasy points a game figure:
 * the last 15 days, the season so far, and the preseason projection the
 * commissioner keeps. A missing source hands its weight to the others, so
 * on opening night the preseason projection stands alone. A player who is
 * out or suspended projects to nothing.
 *
 * The side totals reuse the odds model's view of the week: the games each
 * player still has, the live share of a game under way, and the games cap.
 * One projected week total is exactly the mean the win chance works from.
 *
 * Pure. No server, no browser.
 */
import {
  gamesLeft,
  isOut,
  remainingGames,
  sideOdds,
  type ExpectedPoints,
  type ScorePlayer,
  type ScoreSide,
  type ScoresWeek,
} from './scores.js';
import { sideMean } from './winOdds.js';

/** How much each average counts in the blend. They add to one. */
export const BLEND_WEIGHTS = { last15: 0.5, season: 0.3, preseason: 0.2 } as const;

export interface BlendSources {
  /** Fantasy points a game over the last 15 days. */
  last15: number | null;
  /** Fantasy points a game this season. */
  season: number | null;
  /** The preseason projection, fantasy points a game. */
  preseason: number | null;
}

export interface ProjectionContext {
  /** The day the game is on. */
  scoringPeriodId: number;
  /** The preseason projection for this player, when the league has one. */
  preseason: number | null;
}

/**
 * The weighted average of the sources that exist. With one source missing
 * the other weights are scaled up to add to one again. Null with none.
 */
export function blendExpected(sources: BlendSources): number | null {
  let total = 0;
  let weight = 0;
  for (const key of ['last15', 'season', 'preseason'] as const) {
    const value = sources[key];
    if (value === null || !Number.isFinite(value)) continue;
    total += BLEND_WEIGHTS[key] * Math.max(0, value);
    weight += BLEND_WEIGHTS[key];
  }
  return weight > 0 ? total / weight : null;
}

/**
 * Expected fantasy points for one player in one game: ESPN's projection
 * for that day when it has one, else the blend. Out or suspended is 0.
 */
export function expectedPointsForGame(player: ScorePlayer, ctx: ProjectionContext): number {
  if (isOut(player)) return 0;
  const espn = player.projByDay?.[String(ctx.scoringPeriodId)];
  if (typeof espn === 'number' && Number.isFinite(espn)) return Math.max(0, espn);
  return blendExpected({ last15: player.last15 ?? null, season: player.seasonAvg, preseason: ctx.preseason }) ?? 0;
}

export interface SideProjection {
  /** Where the side should finish the week: points so far plus every game left, up to the cap. */
  week: number;
  /** Where the side should finish each day, by scoring period id: that day's points plus its games left. */
  byDay: Record<string, number>;
}

type WeekView = Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'>;

/**
 * A side's projected finish for the week and for each day. A day gone by
 * projects to what it scored. The games cap cuts the future off in date
 * order, as ESPN does.
 */
export function sideProjection(side: ScoreSide, week: WeekView, expected: ExpectedPoints): SideProjection {
  const byDay: Record<string, number> = {};
  for (const day of week.days) byDay[String(day.scoringPeriodId)] = side.pointsByDay[String(day.scoringPeriodId)] ?? 0;
  for (const game of remainingGames(side, week, expected)) {
    const key = String(game.scoringPeriodId);
    byDay[key] = (byDay[key] ?? 0) + game.expected * game.share;
  }
  for (const key of Object.keys(byDay)) byDay[key] = Math.round(byDay[key] * 10) / 10;
  return { week: Math.round(sideMean(sideOdds(side, week, expected)) * 10) / 10, byDay };
}

/**
 * One player's projected points for one day: what he has plus what his
 * game still holds. Null when he has no game left that day, so the screen
 * shows nothing rather than a zero.
 */
export function playerDayProjection(
  player: ScorePlayer,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>,
  expected: ExpectedPoints,
  scoringPeriodId: number,
): number | null {
  const left = gamesLeft(player, week).find((game) => game.scoringPeriodId === scoringPeriodId);
  if (!left) return null;
  const sofar = player.days[String(scoringPeriodId)]?.points ?? 0;
  return Math.round((sofar + expected(player, scoringPeriodId) * left.share) * 10) / 10;
}

/** One player's projected points for the week: started points so far plus every game left. */
export function playerWeekProjection(
  player: ScorePlayer,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>,
  expected: ExpectedPoints,
): number {
  let total = 0;
  for (const day of Object.values(player.days)) if (day.started) total += day.points;
  for (const game of gamesLeft(player, week)) total += expected(player, game.scoringPeriodId) * game.share;
  return Math.round(total * 10) / 10;
}

/** "1,240" for a projected total. Projections are rough, so no decimals. */
export function projText(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
