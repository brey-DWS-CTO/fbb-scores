/**
 * When the live draft makes a sound on your phone: your pick comes up, your
 * pick has run two minutes, and anyone calls CLOCK, on any team. A CLOCK
 * call is heard by the whole table, the same as when it is shouted. The screen takes
 * a look every half second; this says which sounds the change between two
 * looks earns.
 *
 * Pure. No server, no browser.
 */

/** Your pick has run this long: the two-minute sound. */
export const TWO_MINUTES_MS = 120_000;

export type DraftCue = 'up' | 'two-minutes' | 'clock';

export interface ClockLook {
  /** The pick on the clock is the viewer's own. */
  mine: boolean;
  /** Overall number of the pick on the clock, or null when none is. */
  overall: number | null;
  /** Time on that pick so far, pauses taken out. */
  elapsedMs: number;
  /** When CLOCK was called on that pick, or null. */
  calledAt: string | null;
}

/**
 * The sounds a change earns. The first look earns none, so opening the page
 * in the middle of your pick stays quiet.
 */
export function draftCues(before: ClockLook | null, after: ClockLook): DraftCue[] {
  if (before === null || after.overall === null) return [];
  const samePick = before.overall === after.overall;
  const cues: DraftCue[] = [];
  if (after.mine && !(samePick && before.mine)) cues.push('up');
  if (after.mine && samePick && before.elapsedMs < TWO_MINUTES_MS && after.elapsedMs >= TWO_MINUTES_MS) cues.push('two-minutes');
  if (after.calledAt !== null && after.calledAt !== (samePick ? before.calledAt : null)) cues.push('clock');
  return cues;
}
