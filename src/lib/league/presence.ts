/**
 * Who is in the draft room: every owner with the draft page open. Each open
 * page checks in every few seconds; an owner who has not checked in for a
 * while has left. The test draft and the league keep separate rooms.
 *
 * Pure. No server, no browser.
 */

/** How often an open draft page checks in. */
export const PRESENCE_POLL_MS = 5_000;
/** Three missed check-ins and you have left. */
export const PRESENCE_WINDOW_MS = 15_000;

export interface PresenceRow {
  owner: string;
  seenAt: string;
}

/** Owners seen inside the window, in draft order. */
export function inRoom(rows: readonly PresenceRow[], now: number, order: readonly string[]): string[] {
  const here = new Set(
    rows
      .filter((row) => now - Date.parse(row.seenAt) <= PRESENCE_WINDOW_MS)
      .map((row) => row.owner),
  );
  return order.filter((owner) => here.has(owner));
}

/** Who came in and who went out between two looks at the room. The first look reports nothing. */
export function roomChanges(
  before: readonly string[] | null,
  after: readonly string[],
): { joined: string[]; left: string[] } {
  if (before === null) return { joined: [], left: [] };
  return {
    joined: after.filter((owner) => !before.includes(owner)),
    left: before.filter((owner) => !after.includes(owner)),
  };
}
