/**
 * The keeper question, as a number: how often would this player be gone by
 * the pick the keep costs? Commissioner only, on the keeper page.
 *
 * The owner's own keeper slots are opened (made live, players back in the
 * pool) so every candidate is judged as if not kept. Then the room drafts
 * `runs` times under fresh seeds and each player's pick number is kept per
 * run. The share of runs where he went before a given pick is the answer.
 *
 * Pure. No server, no browser.
 */
import { runMock, runSeed, type MockBoard, type MockSlot, type PreparedMock } from './mockDraft.js';

export interface TakenAt {
  runs: number;
  /** For each player, the overall pick he went at, one entry per run he was taken in. */
  at: ReadonlyMap<string, readonly number[]>;
}

/** The board with every one of `owner`'s keeper slots live and their players back in the pool. */
export function openOwnerBoard(board: MockBoard, owner: string): MockBoard {
  const returned = new Set<string>();
  const slots = board.slots.map((slot) => {
    if (slot.pick.currentOwner !== owner || !slot.keeper) return slot;
    returned.add(slot.keeper.playerKey);
    return { ...slot, keeper: null };
  });
  return { ...board, slots, taken: board.taken.filter((key) => !returned.has(key)) };
}

/** Draft `runs` times and note where every player went. */
export function simulateTakenAt(prepared: PreparedMock, seed: number, runs = 60): TakenAt {
  const at = new Map<string, number[]>();
  for (let k = 0; k < runs; k += 1) {
    const result = runMock(prepared, runSeed(seed, 7000 + k));
    for (const pick of result.picks) {
      if (!pick.playerKey) continue;
      const list = at.get(pick.playerKey) ?? [];
      list.push(pick.overall);
      at.set(pick.playerKey, list);
    }
  }
  return { runs, at };
}

/** How often `playerKey` went before pick `overall`, 0 to 1. */
export function shareGoneBefore(taken: TakenAt, playerKey: string, overall: number): number {
  if (taken.runs <= 0) return 0;
  const list = taken.at.get(playerKey) ?? [];
  return list.filter((at) => at < overall).length / taken.runs;
}

/**
 * The pick a keep in `round` would cost `owner` on this board: their own
 * slot in that round, skipping any already charged to another keeper. When
 * that pick is gone (charged, or traded away) the keep bumps to the next
 * earlier round, the way the engine charges a duplicate tier. Null when no
 * pick from that round up is left.
 */
export function keeperCostSlot(slots: readonly MockSlot[], owner: string, round: number, charged: ReadonlySet<number> = new Set()): MockSlot | null {
  for (let at = round; at >= 1; at -= 1) {
    const slot = slots.find((entry) =>
      entry.pick.currentOwner === owner && entry.pick.round === at && !entry.made && !charged.has(entry.pick.overall));
    if (slot) return slot;
  }
  return null;
}

/**
 * What the number says about the keep. Gone 70% of the time or more: keep
 * him, you would not get him back. Under 40%: you could draft him anyway.
 */
export function oddsTone(share: number): 'keep' | 'maybe' | 'skip' {
  return share >= 0.7 ? 'keep' : share >= 0.4 ? 'maybe' : 'skip';
}
