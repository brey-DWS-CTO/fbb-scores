/**
 * Games the commissioner expects a player to miss that ESPN's projection
 * does not show yet. Only the games change: a player's points per game stay
 * ESPN's, and his season total and draft value fall with the games.
 *
 * Take an entry out once ESPN's own projection catches up.
 */
export interface GamesOverride {
  espnId: number;
  name: string;
  /** Games he is expected to play, out of 82. */
  games: number;
  note: string;
  /** When the estimate was set. */
  since: string;
}

export const GAMES_OVERRIDES: readonly GamesOverride[] = [
  { espnId: 3102531, name: 'Kristaps Porzingis', games: 25, note: 'Hurt. Commissioner estimate.', since: '2026-10-01' },
  { espnId: 3913176, name: 'Brandon Ingram', games: 45, note: 'Hurt. Commissioner estimate.', since: '2026-10-01' },
];

const BY_ID = new Map(GAMES_OVERRIDES.map((entry) => [entry.espnId, entry]));

/** The override for a player, if there is one. */
export function gamesOverride(espnId: number | null | undefined): GamesOverride | null {
  return espnId === null || espnId === undefined ? null : BY_ID.get(espnId) ?? null;
}
