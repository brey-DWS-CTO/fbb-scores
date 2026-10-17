/**
 * The shared test draft: a copy of the league that every signed-in member can
 * join and pick in, so the live draft can be tried end to end before it
 * counts. The server keeps it apart from the league; this file says what the
 * copy holds.
 *
 * Pure. No server, no browser.
 */
import type { LeagueDynamicState } from '../keeper/types.js';
import { startPickClock } from './draftClock.js';

/** The header a device sends to read and write the test draft instead of the league. */
export const TEST_DRAFT_HEADER = 'x-test-draft';

/**
 * The test draft's opening state, already started with the clock running.
 *
 * Keepers come across only once the commissioner has revealed them. Before
 * that the copy has none, because everyone in the test sees the whole board
 * and secret keepers must stay secret. Pick trades come across, since they
 * decide who owns each pick. Pending trade offers do not.
 */
export function testDraftState(
  live: LeagueDynamicState,
  now: string,
  fallbackPoolId: string,
): LeagueDynamicState {
  const copy = structuredClone(live);
  return {
    ...copy,
    keepers: live.keepersRevealed === true ? copy.keepers : {},
    keepersRevealed: true,
    draft: {
      picks: {},
      startedAt: now,
      closedAt: null,
      playerPoolSnapshotId: live.draft.playerPoolSnapshotId ?? live.playerPool?.activeSnapshotId ?? fallbackPoolId,
      clock: startPickClock(now),
      skipped: {},
    },
    pickTradeProposals: [],
  };
}

/** What a state reply says about the test draft. */
export interface TestDraftMeta {
  /** A test draft exists for members to join. */
  running: boolean;
  /** This reply is the test draft, not the league. */
  serving: boolean;
}

/**
 * Whether a state reply belongs on a screen. A device in the test shows only
 * test replies, and a device out of it shows only league replies, so a stray
 * reply from the other side never flashes onto the board.
 */
export function replyFits(joined: boolean, meta: { testDraft?: TestDraftMeta } | null | undefined): boolean {
  return joined === (meta?.testDraft?.serving === true);
}
