import type { Poll } from './polls.js';

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

/** Closed polls and manual edits share one chronological source of weekly caps. */
export function effectiveGamesCaps(manual: GamesCapRow[], polls: Poll[]): GamesCapRow[] {
  const selected = new Map<number, GamesCapRow>();
  for (const row of manual) selected.set(row.matchupPeriodId, row);
  for (const poll of polls) {
    if (poll.kind !== 'game-limit' || poll.status !== 'closed' || !poll.closedAt || !Number.isInteger(poll.matchupPeriodId) || poll.matchupPeriodId! < 1 || poll.matchupPeriodId! > 30) continue;
    const counts = (poll.options ?? []).map((option) => ({ option, count: poll.votes.filter((vote) => vote.choice === option && poll.eligibleVoters.includes(vote.owner)).length }));
    const high = Math.max(0, ...counts.map((row) => row.count));
    const leaders = counts.filter((row) => row.count === high);
    const cap = high && leaders.length === 1 ? parseGamesCap(leaders[0].option) : null;
    if (cap === null) continue;
    const previous = selected.get(poll.matchupPeriodId!);
    if (previous && Date.parse(previous.updatedAt) >= Date.parse(poll.closedAt)) continue;
    selected.set(poll.matchupPeriodId!, { season: poll.season, matchupPeriodId: poll.matchupPeriodId!, cap, updatedAt: poll.closedAt, updatedBy: poll.closedBy ?? poll.proposedBy });
  }
  return [...selected.values()].sort((a, b) => a.matchupPeriodId - b.matchupPeriodId);
}
