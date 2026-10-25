/** Guest sessions are separate from every owner seat. */
export const GUEST_PREFIX = 'guest:';
/** Finite storage value compatible with the existing Postgres session column. */
export const PERMANENT_GUEST_EXPIRY = '9999-12-31T23:59:59.999Z';
export function isGuestOwner(owner: string): boolean { return owner.startsWith(GUEST_PREFIX); }
export function guestName(owner: string): string { return owner.split(':').slice(2).join(':') || 'Guest'; }
export interface GuestAccess { id: string; name: string; issuedAt: string; expiresAt: string | null; }
export function guestPageAllowed(path: string): boolean {
  return path === '/' || path.startsWith('/guest/') || path === '/teams' || path === '/history' || path === '/scores' || path.startsWith('/scores/');
}
/** Defense in depth: guest sessions can only read the spectator endpoints. */
export function guestRequestAllowed(method: string, path: string): boolean {
  if (method === 'POST') return ['/auth/sign-out', '/auth/guest/consume'].includes(path);
  if (method !== 'GET') return false;
  return ['/auth/me', '/league/state', '/league/player-pool', '/league/fantasy-cast', '/league/daily-scorers', '/league/performer-dates', '/league/history', '/league/history/versions', '/league/games-caps', '/league/missed-games', '/espn/scoreboard', '/espn/league-info', '/espn/week'].includes(path)
    || /^\/espn\/(?:daily|matchup)\/\d+$/.test(path)
    || /^\/espn\/trends\/(?:player|team)\/\d+$/.test(path);
}
