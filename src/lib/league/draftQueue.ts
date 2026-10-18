/**
 * Each owner's draft queue, saved on the server so it still works with their
 * phone asleep. When a called CLOCK runs out, the owner on the clock takes
 * the top player in their queue who is still there. With nobody left in the
 * queue, the pick is yielded as before (rule 2.3.2.1).
 *
 * Pure. No server, no browser.
 */

/** More than a draft's worth of names is a mistake, not a queue. */
export const MAX_QUEUE = 60;

/** A queue from a request: player keys, no repeats, at most MAX_QUEUE. Null when it is not a list of keys. */
export function cleanQueue(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 120)) return null;
  return [...new Set(raw as string[])].slice(0, MAX_QUEUE);
}

/** The first queued player still available, or null. */
export function firstQueued(queue: readonly string[] | undefined, available: ReadonlySet<string>): string | null {
  return queue?.find((key) => available.has(key)) ?? null;
}
