/**
 * Each owner's draft queue, saved on the server so it still works with their
 * phone asleep. When a called CLOCK runs out, the owner on the clock takes
 * the top player in their queue who is still there. With nobody left in the
 * queue, the pick is yielded as before (rule 2.3.2.1).
 *
 * Pure. No server, no browser.
 */

/** Room for a whole rankings list; a queue longer than that is a mistake. */
export const MAX_QUEUE = 300;

/**
 * A queue built from saved rankings: the matched players, best first. The
 * draft page fills an empty queue with it, and the server reads it for an
 * owner who never touched their queue, so a clock that runs out takes the
 * top ranked player still there.
 */
export function queueFromRankings(entries: readonly { playerKey: string | null }[]): string[] {
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.playerKey && !keys.includes(entry.playerKey)) keys.push(entry.playerKey);
    if (keys.length >= MAX_QUEUE) break;
  }
  return keys;
}

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
