/**
 * The weekly games cap: how many started player-games a team may count in
 * one fantasy week. The rule book says 30 (`season.gameLimit`) and gives the
 * All-Star week its own formula, so the number can differ by week. The
 * commissioner sets it per week here; a week nobody has set takes ESPN's
 * own limit for that week, and 30 when ESPN has not said.
 *
 * Pure. No server, no browser.
 */

export const DEFAULT_GAMES_CAP = 30;
export const MIN_GAMES_CAP = 1;
export const MAX_GAMES_CAP = 70;

export interface GamesCapRow {
  season: number;
  /** ESPN's fantasy week. */
  matchupPeriodId: number;
  cap: number;
  updatedAt: string;
  updatedBy: string;
}

/** A whole number from 1 to 70, else null. Takes a number or the text of one. */
export function parseGamesCap(input: unknown): number | null {
  const value = typeof input === 'string' ? Number(input.trim()) : input;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_GAMES_CAP || value > MAX_GAMES_CAP) return null;
  return value;
}

/**
 * The cap for one week: what the commissioner set, else ESPN's limit for
 * that week (`espnCap`, from the lineup settings), else the default.
 */
export function capForWeek(rows: readonly GamesCapRow[], matchupPeriodId: number, espnCap: number | null = null): number {
  const set = rows.find((row) => row.matchupPeriodId === matchupPeriodId)?.cap;
  if (set !== undefined) return set;
  return espnCap !== null && espnCap > 0 ? espnCap : DEFAULT_GAMES_CAP;
}

/** "14 of 30". */
export function gamesText(played: number, cap: number): string {
  return `${played} of ${cap}`;
}
