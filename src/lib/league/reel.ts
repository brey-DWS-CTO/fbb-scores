/**
 * The slot-machine wheel on the keeper reveal: which name shows when, so the
 * names race at first, slow down, and stop on the team the server picked.
 *
 * Pure. No server, no browser.
 */

export interface ReelStep {
  name: string;
  /** Milliseconds from the start of the slow-down. */
  at: number;
}

/** How many names pass before it stops. */
export const REEL_STEPS = 18;

/**
 * Names cycle in order and the gaps grow, fast to slow. The last step is
 * always `target`, wherever the cycle would have been.
 */
export function reelSchedule(names: readonly string[], target: string, steps = REEL_STEPS): ReelStep[] {
  const pool = names.length > 0 ? names : [target];
  const out: ReelStep[] = [];
  let at = 0;
  for (let i = 0; i < steps; i += 1) {
    // 60ms at the start, about 420ms at the end.
    at += Math.round(60 + 360 * (i / (steps - 1)) ** 2);
    out.push({ name: i === steps - 1 ? target : pool[i % pool.length], at });
  }
  return out;
}
