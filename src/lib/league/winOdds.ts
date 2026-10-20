/**
 * Win chance for one head-to-head matchup, the way Sleeper shows it.
 *
 * A team's final total is the points it already has, which do not move,
 * plus one draw for every player-game still to come this week. Each draw is
 * normal around that player's expected points for the game, with a spread of
 * SPREAD times the mean. A sum of normals is normal, so the margin between
 * two teams is normal too, and P(A wins) is one Φ.
 *
 * Pure. No server, no browser, no dependency.
 */

/** Standard deviation of one player-game, as a share of its expected points. */
export const SPREAD = 0.4;
/** Shared forecast uncertainty across a team's remaining games. */
export const FORECAST_UNCERTAINTY = 0.1;

export interface RemainingGame {
  /** Expected fantasy points for a whole game. */
  expected: number;
  /**
   * The share of the game still to be played, 0 to 1. A game that has not
   * started is 1; a game in the third quarter is about 0.3. Defaults to 1.
   */
  share?: number;
}

export interface SideOdds {
  /** Points already scored. These are fixed. */
  points: number;
  remaining: readonly RemainingGame[];
}

/** Whole percents. `a` and `b` always add to 100. */
export interface WinChance {
  a: number;
  b: number;
}

/**
 * The error function, Abramowitz and Stegun 7.1.26. Largest error 1.5e-7,
 * which is far below a whole percent.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = t * (0.254829592
    + t * (-0.284496736
    + t * (1.421413741
    + t * (-1.453152027
    + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Φ: the standard normal cumulative distribution. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function gameMean(game: RemainingGame): number {
  const expected = Number.isFinite(game.expected) ? Math.max(0, game.expected) : 0;
  const share = game.share === undefined ? 1 : Math.min(1, Math.max(0, game.share));
  return expected * share;
}

/** Points so far plus the expected points of every game still to come. */
export function sideMean(side: SideOdds): number {
  let total = side.points;
  for (const game of side.remaining) total += gameMean(game);
  return total;
}

/** Game variance shrinks with time left, plus uncertainty shared across future forecasts. */
export function sideVariance(side: SideOdds): number {
  let total = 0;
  let remainingMean = 0;
  let independentMeansSquared = 0;
  for (const game of side.remaining) {
    const expected = Number.isFinite(game.expected) ? Math.max(0, game.expected) : 0;
    const share = game.share === undefined ? 1 : Math.min(1, Math.max(0, game.share));
    const mean = expected * share;
    total += (SPREAD * expected) ** 2 * share;
    remainingMean += mean;
    independentMeansSquared += mean * mean;
  }
  return total + FORECAST_UNCERTAINTY ** 2 * Math.max(0, remainingMean ** 2 - independentMeansSquared);
}

/**
 * P(a wins) and P(b wins), in whole percents.
 *
 * With nothing left to play on either side the answer is settled: 100/0,
 * 0/100, or 50/50 on a tie. While games remain the display is capped at 1
 * and 99, so a near-certain lead still reads as a chance.
 */
export function winChance(a: SideOdds, b: SideOdds): WinChance {
  const meanA = sideMean(a);
  const meanB = sideMean(b);
  const variance = sideVariance(a) + sideVariance(b);

  if (variance <= 0) {
    if (meanA > meanB) return { a: 100, b: 0 };
    if (meanB > meanA) return { a: 0, b: 100 };
    return { a: 50, b: 50 };
  }

  const p = normalCdf((meanA - meanB) / Math.sqrt(variance));
  const pctA = Math.min(99, Math.max(1, Math.round(p * 100)));
  return { a: pctA, b: 100 - pctA };
}
