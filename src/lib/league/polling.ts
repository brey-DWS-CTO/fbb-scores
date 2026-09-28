/**
 * How often a page asks the server for fresh league state.
 *
 * Every ask reads the database, and the database only sleeps after five
 * quiet minutes. A tab that polls forever keeps it awake forever, and that
 * is what the bill charges for. So a page polls while someone uses it, and
 * stops once they walk away. Coming back (a tap, a key, the tab in front
 * again) asks at once and starts the clock again.
 *
 * The one exception is the live draft. A TV on the wall has nobody touching
 * it, and it must keep up with every pick.
 */
import type { LeagueDynamicState } from '../keeper/types.js';

/** The live draft board. */
export const LIVE_DRAFT_POLL_MS = 3_000;
/** Any other page while someone is using it. */
export const ACTIVE_POLL_MS = 30_000;
/** No tap, key or scroll for this long and the page stops asking. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** Started and not yet closed by the commissioner. */
export function draftIsLive(state: Pick<LeagueDynamicState, 'draft'> | undefined): boolean {
  if (!state) return false;
  return state.draft.startedAt !== null && !state.draft.closedAt;
}

export interface PollInput {
  /** The page wants the fast draft pace, if the draft is on. */
  fast: boolean;
  draftLive: boolean;
  /** Time since the last tap, key or scroll. */
  idleForMs: number;
}

/** Milliseconds to the next ask, or false to stop asking. */
export function pollInterval(input: PollInput): number | false {
  if (input.fast && input.draftLive) return LIVE_DRAFT_POLL_MS;
  if (input.idleForMs >= IDLE_AFTER_MS) return false;
  return ACTIVE_POLL_MS;
}
