/**
 * Double-double and triple-double odds from a projected per-game line.
 *
 * This league pays for both, and ESPN's projections carry neither: a
 * projection dictionary has points, rebounds, assists, steals and blocks,
 * but no stat 37 or 38. Left out, every double-double player is scored
 * short. Jokic loses about five points a game, Sabonis two or three.
 *
 * The league also pays 170 for a quadruple-double, stat 39. That is not
 * estimated. Nobody projects to one, and a guess would only add noise.
 *
 * A per-game average hides the spread between games, and a double-double is
 * a question about spread: how often does a 9-rebound player reach 10? Each
 * category is treated as roughly normal around its average with a spread of
 * about 1.1 times the square root of the average, and a game counts a category
 * when it lands at 9.5 or above. The five categories are taken as
 * independent. Both are approximations, checked against real seasons in the
 * tests, and they are honest to within a few points of odds. Nothing here is
 * used when ESPN does send the stat itself.
 */
import { normalCdf } from '../espn/calculations.js';

/** ESPN stat ids: points, rebounds, assists, steals, blocks. */
export const TEN_PLUS_STATS = ['0', '6', '3', '2', '1'] as const;

export const DOUBLE_DOUBLE_STAT = 37;
export const TRIPLE_DOUBLE_STAT = 38;
export const BONUS_STATS: ReadonlySet<number> = new Set([DOUBLE_DOUBLE_STAT, TRIPLE_DOUBLE_STAT]);

/** How far a single game strays from the average, in square roots of it. */
export const GAME_SPREAD = 1.1;

/** Odds that one category reaches ten in a game, from its per-game average. */
export function tenPlusOdds(average: number, spread = GAME_SPREAD): number {
  if (!Number.isFinite(average) || average <= 0) return 0;
  const sd = spread * Math.sqrt(average);
  return 1 - normalCdf((9.5 - average) / sd);
}

export interface BonusOdds {
  /** Odds of two or more categories at ten, per game. */
  doubleDouble: number;
  /** Three or more. */
  tripleDouble: number;
}

/**
 * Odds per game of a double- and triple-double from a per-game line. Exact
 * over the 32 ways five independent categories can land.
 */
export function bonusOdds(perGame: Readonly<Record<string, number>>, spread = GAME_SPREAD): BonusOdds {
  const odds = TEN_PLUS_STATS.map((id) => tenPlusOdds(perGame[id] ?? 0, spread));
  // atLeast[k] = odds that k or more categories reach ten.
  const countOdds = [1, 0, 0, 0, 0, 0];
  for (const p of odds) {
    for (let k = 5; k >= 1; k -= 1) countOdds[k] = countOdds[k] * (1 - p) + countOdds[k - 1] * p;
    countOdds[0] *= 1 - p;
  }
  const atLeast = (k: number) => countOdds.slice(k).reduce((sum, value) => sum + value, 0);
  return {
    doubleDouble: atLeast(2),
    tripleDouble: atLeast(3),
  };
}

/**
 * Points per game the league's double-double bonuses are worth for this line,
 * counting only the bonus items ESPN left out of the projection.
 */
export function estimatedBonusPerGame(
  perGame: Readonly<Record<string, number>>,
  scoringItems: readonly { statId: number; points: number }[],
): number {
  const missing = scoringItems.filter((item) => BONUS_STATS.has(item.statId) && perGame[String(item.statId)] === undefined);
  if (missing.length === 0) return 0;
  const odds = bonusOdds(perGame);
  let total = 0;
  for (const item of missing) {
    total += (item.statId === DOUBLE_DOUBLE_STAT ? odds.doubleDouble : odds.tripleDouble) * item.points;
  }
  return total;
}
