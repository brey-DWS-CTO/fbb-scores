/**
 * While the draft runs, members pick from names alone. The mock draft and
 * the stats pages close for them, so nobody leaves the draft to look up a
 * number. The commissioner keeps everything.
 *
 * Pure. No server, no browser.
 */
import type { LeagueDynamicState } from '../keeper/types.js';

export type DraftPhase = 'before' | 'live' | 'done';

/** Before the commissioner starts it, while it runs, and once it is closed. */
export function draftPhase(draft: Pick<LeagueDynamicState['draft'], 'startedAt' | 'closedAt'>): DraftPhase {
  if (draft.closedAt) return 'done';
  return draft.startedAt !== null ? 'live' : 'before';
}

export function statsLocked(input: {
  /** The league's own state, not the test copy. */
  league: Pick<LeagueDynamicState, 'draft'>;
  isCommissioner: boolean;
  /** This device has joined the shared test draft. */
  inTestDraft: boolean;
}): boolean {
  if (input.isCommissioner) return false;
  if (input.inTestDraft) return true;
  const { startedAt, closedAt } = input.league.draft;
  return startedAt !== null && !closedAt;
}
