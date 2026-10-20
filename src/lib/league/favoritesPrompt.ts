/**
 * How often the app may ask someone for a favorite team: twice, then never.
 * The count lives on the phone; the server only ever sees the pick.
 *
 * Pure. No server, no browser.
 */

export const MAX_FAVORITES_SKIPS = 2;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const key = (owner: string) => `nerds.favorites.skips.${owner}`;

export function readFavoritesSkips(storage: StorageLike | undefined, owner: string): number {
  try {
    const raw = storage?.getItem(key(owner));
    const count = raw === null || raw === undefined ? 0 : Number(raw);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch {
    return 0;
  }
}

export function writeFavoritesSkips(storage: StorageLike | undefined, owner: string, count: number): void {
  try {
    storage?.setItem(key(owner), String(Math.max(0, Math.floor(count))));
  } catch {
    /* a phone with storage off asks every time; that is fine */
  }
}
