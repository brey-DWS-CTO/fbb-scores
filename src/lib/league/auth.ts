/**
 * Signing in: the link a member is emailed, the session it grants, and how
 * often one address may ask for another link.
 *
 * Pure and shared by client and server, so the wait a member is shown is the
 * same wait the server enforces.
 *
 * The league has no passwords. A member types their address, gets a link, and
 * clicking it starts a session. Everything here is arithmetic on times and
 * addresses. Nothing sends mail, reads a row, or reads the clock: the caller
 * passes `now`, so a test can name the exact second it cares about and the
 * server can use one timestamp for a whole request.
 */

/** How long a sign-in link works. Short, because email sits in inboxes. */
export const LINK_TTL_MINUTES = 15;

/** How long a session lasts. Long, because this is a league, not a bank. */
export const SESSION_TTL_DAYS = 30;

/** Links one address may hold inside LINK_WINDOW_MINUTES. */
export const MAX_LINKS_PER_WINDOW = 3;

export const LINK_WINDOW_MINUTES = 15;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Lower-case and trim. Gmail dots and plus tags are NOT stripped: two people can legitimately use them. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// One @, a local part, then domain labels split by dots. Every label has to
// hold something, so a@b, a@b. and a@.com all fail.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** A practical check, not RFC 5322. One @, something either side, a dot in the domain, no spaces. */
export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(normalizeEmail(value));
}

/**
 * When a link issued now stops working.
 *
 * ISO strings all the way through, so the value written to a row is the value
 * read back, with no local timezone getting in between.
 */
export function linkExpiresAt(issuedAt: Date): string {
  return new Date(issuedAt.getTime() + LINK_TTL_MINUTES * MINUTE_MS).toISOString();
}

/** When a session started now runs out. Same ISO reasoning as the link. */
export function sessionExpiresAt(issuedAt: Date): string {
  return new Date(issuedAt.getTime() + SESSION_TTL_DAYS * DAY_MS).toISOString();
}

/**
 * True once the deadline has arrived.
 *
 * The moment itself counts as expired, the way the draft deadline does: a
 * deadline you can squeak past is not a deadline. A time nobody can read is
 * treated as expired too, because a broken row must never hand out a session.
 */
export function isExpired(expiresAt: string, now: Date): boolean {
  const ends = Date.parse(expiresAt);
  if (Number.isNaN(ends)) return true;
  return now.getTime() >= ends;
}

export interface LinkRequestDecision {
  ok: boolean;
  reason?: string;             // plain English, shown to the user
  retryAfterSeconds?: number;
}

/**
 * Whether this address may be sent another link.
 *
 * Anyone who knows a member's address could otherwise sit on the sign-in form
 * and fill their inbox. Three in fifteen minutes covers a person who mistypes,
 * deletes the mail, or waits and tries again, and stops the rest.
 *
 * recentIssuedAt is every link issued to this address, ISO strings, any order.
 * Entries that will not parse are skipped rather than thrown, since one bad
 * row should not lock a member out of their own league.
 */
export function canRequestLink(recentIssuedAt: string[], now: Date): LinkRequestDecision {
  const windowMs = LINK_WINDOW_MINUTES * MINUTE_MS;
  const cutoff = now.getTime() - windowMs;
  const inWindow = recentIssuedAt
    .map((at) => Date.parse(at))
    .filter((ms) => !Number.isNaN(ms) && ms > cutoff)
    .sort((a, b) => a - b);

  if (inWindow.length < MAX_LINKS_PER_WINDOW) return { ok: true };

  // The oldest link in the window is the one that ages out first, so it is the
  // one that frees a slot. Round the seconds up: telling someone to come back
  // a moment early only earns them a second refusal.
  const oldest = inWindow[0];
  const retryAfterSeconds = Math.ceil((oldest + windowMs - now.getTime()) / 1000);
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const word = minutes === 1 ? 'minute' : 'minutes';
  return {
    ok: false,
    reason: `Too many sign-in links. Try again in ${minutes} ${word}.`,
    retryAfterSeconds,
  };
}

export interface OwnerEmail { owner: string; email: string }

// Owner names come from the league roster, so a stray capital is the same
// person and not a second one.
const sameOwner = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Case-insensitive match on the normalized address. Returns null when nobody owns it. */
export function ownerForEmail(entries: OwnerEmail[], email: string): string | null {
  const wanted = normalizeEmail(email);
  // An empty address belongs to nobody, and would otherwise match every owner
  // who has not saved one yet.
  if (!wanted) return null;
  return entries.find((entry) => normalizeEmail(entry.email) === wanted)?.owner ?? null;
}

/**
 * True when the same address is already claimed by a different owner.
 *
 * Two teams on one inbox would mean a link that could sign in as either, so
 * the save has to be refused. A member saving the address they already had is
 * not a clash, which is why the owner is part of the question.
 */
export function emailTakenBy(entries: OwnerEmail[], email: string, owner: string): string | null {
  const holder = ownerForEmail(entries, email);
  if (holder === null) return null;
  return sameOwner(holder, owner) ? null : holder;
}
