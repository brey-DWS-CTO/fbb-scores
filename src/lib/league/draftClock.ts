/**
 * The draft clock, rule 2.3: roughly 90 seconds a pick, no clock kept, but
 * anyone may call CLOCK on the team picking and they then get 30 seconds.
 *
 * The server stamps every moment; the screens only do arithmetic on those
 * stamps, so every phone and the TV agree. Nothing here skips a pick when
 * time runs out: the yield in rule 2.3.2.1 is the commissioner's call at
 * the table.
 */
import type { BoardCell, ClockCall, DraftClockState, DraftPickState } from '../keeper/types.js';

export type { ClockCall, DraftClockState };

/** Rule 2.3: the soft limit before a pick is slow. */
export const SOFT_CLOCK_SECONDS = 90;
/** Rule 2.3.2: what CLOCK gives you. */
export const CALLED_CLOCK_SECONDS = 30;
/** A member may call CLOCK once this many picks. The commissioner has no limit. */
export const CLOCK_COOLDOWN_PICKS = 5;
/** Nobody may call CLOCK before the team has had this long: two minutes early, ninety seconds late. */
export const EARLY_ROUNDS = 5;
export const EARLY_CALL_SECONDS = 120;
export const LATE_CALL_SECONDS = 90;

/** How long the team picking gets before anyone may call CLOCK on them. */
export function earliestCallSeconds(round: number): number {
  return round <= EARLY_ROUNDS ? EARLY_CALL_SECONDS : LATE_CALL_SECONDS;
}

export const EMPTY_CLOCK: DraftClockState = { pickStartedAt: null, pausedAt: null, pausedMs: 0, call: null };

const ms = (iso: string) => Date.parse(iso);

/** A fresh clock for the pick that is on the clock from `now`. A pause carries over. */
export function startPickClock(now: string, paused = false): DraftClockState {
  return { pickStartedAt: now, pausedAt: paused ? now : null, pausedMs: 0, call: null };
}

/** Time the team has had the pick, pauses taken out. Zero before the draft starts. */
export function elapsedMs(clock: DraftClockState | null | undefined, now: string | number): number {
  if (!clock?.pickStartedAt) return 0;
  const at = typeof now === 'number' ? now : ms(now);
  const paused = clock.pausedMs + (clock.pausedAt ? Math.max(0, at - ms(clock.pausedAt)) : 0);
  return Math.max(0, at - ms(clock.pickStartedAt) - paused);
}

/** Milliseconds left on a called clock, or null when nobody has called it. Never below zero. */
export function remainingMs(
  clock: DraftClockState | null | undefined,
  now: string | number,
  seconds = CALLED_CLOCK_SECONDS,
): number | null {
  if (!clock?.call) return null;
  return Math.max(0, seconds * 1000 - (elapsedMs(clock, now) - clock.call.atElapsedMs));
}

export function isPaused(clock: DraftClockState | null | undefined): boolean {
  return clock?.pausedAt != null;
}

export function pauseClock(clock: DraftClockState, now: string): DraftClockState {
  if (clock.pausedAt) return clock;
  return { ...clock, pausedAt: now };
}

export function resumeClock(clock: DraftClockState, now: string): DraftClockState {
  if (!clock.pausedAt) return clock;
  return { ...clock, pausedAt: null, pausedMs: clock.pausedMs + Math.max(0, ms(now) - ms(clock.pausedAt)) };
}

/** The pick a member last called CLOCK on, or null. Cleared picks do not count. */
export function lastClockCallBy(picks: Readonly<Record<string, DraftPickState>>, caller: string): number | null {
  let last: number | null = null;
  for (const [overall, pick] of Object.entries(picks)) {
    if (pick.clockCalledBy !== caller) continue;
    const n = Number(overall);
    if (last === null || n > last) last = n;
  }
  return last;
}

export type ClockCallCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'not-started' | 'complete' | 'own-pick' | 'already-called' | 'paused' | 'too-early' | 'cooldown';
      picksToWait?: number;
      /** Whole seconds until the call is allowed, for `too-early`. */
      secondsToWait?: number;
    };

/**
 * Whether `caller` may call CLOCK right now. Nobody may call it on
 * themselves, while a call is running, while the clock is paused, or before
 * the team has had its time (two minutes in rounds 1 to 5, ninety seconds
 * after). The commissioner skips only the five-pick cooldown.
 */
export function canCallClock(input: {
  clock: DraftClockState | null | undefined;
  picks: Readonly<Record<string, DraftPickState>>;
  onClock: Pick<BoardCell, 'pick'> | null;
  caller: string;
  isCommissioner: boolean;
  now: string | number;
}): ClockCallCheck {
  const { clock, picks, onClock, caller, isCommissioner, now } = input;
  if (!clock?.pickStartedAt) return { ok: false, reason: 'not-started' };
  if (!onClock) return { ok: false, reason: 'complete' };
  if (onClock.pick.currentOwner === caller) return { ok: false, reason: 'own-pick' };
  if (clock.call) return { ok: false, reason: 'already-called' };
  if (clock.pausedAt) return { ok: false, reason: 'paused' };
  const waitMs = earliestCallSeconds(onClock.pick.round) * 1000 - elapsedMs(clock, now);
  if (waitMs > 0) return { ok: false, reason: 'too-early', secondsToWait: Math.ceil(waitMs / 1000) };
  if (isCommissioner) return { ok: true };
  const last = lastClockCallBy(picks, caller);
  if (last !== null) {
    const wait = CLOCK_COOLDOWN_PICKS - (onClock.pick.overall - last);
    if (wait > 0) return { ok: false, reason: 'cooldown', picksToWait: wait };
  }
  return { ok: true };
}

export function callClock(clock: DraftClockState, by: string, now: string): DraftClockState {
  return { ...clock, call: { by, at: now, atElapsedMs: elapsedMs(clock, now) } };
}

/** What the pick record keeps once it lands: how long it took and who called CLOCK, if anyone. */
export function pickTiming(clock: DraftClockState | null | undefined, now: string): Pick<DraftPickState, 'seconds' | 'clockCalledBy'> {
  if (!clock?.pickStartedAt) return {};
  return {
    seconds: Math.round(elapsedMs(clock, now) / 1000),
    clockCalledBy: clock.call?.by ?? null,
  };
}

/** m:ss for a timer. */
export function formatClock(msValue: number): string {
  const total = Math.max(0, Math.floor(msValue / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ─── Fun stats at the end ────────────────────────────────────────────────────

export interface OwnerTiming {
  owner: string;
  picks: number;
  totalSeconds: number;
  /** Null until the owner has made a timed pick. */
  averageSeconds: number | null;
  longest: { overall: number; seconds: number; playerName: string } | null;
  /** Picks of theirs somebody called CLOCK on. */
  clocked: number;
  /** CLOCK calls they made on other people. */
  calls: number;
}

export interface DraftTimingStats {
  owners: OwnerTiming[];
  fastest: OwnerTiming | null;
  slowest: OwnerTiming | null;
  longestPick: { owner: string; overall: number; seconds: number; playerName: string } | null;
  mostClocked: OwnerTiming | null;
  mostCalls: OwnerTiming | null;
  /** Timed live picks counted. Zero means nothing to show yet. */
  timedPicks: number;
}

/**
 * Who was quick, who was slow, who got CLOCK called on them and who called
 * it. Keepers are not picks and are left out. Ties go to the first owner in
 * draft order.
 */
export function draftTimingStats(board: readonly BoardCell[], owners: readonly string[]): DraftTimingStats {
  const byOwner = new Map<string, OwnerTiming>(
    owners.map((owner) => [owner, { owner, picks: 0, totalSeconds: 0, averageSeconds: null, longest: null, clocked: 0, calls: 0 }]),
  );
  const get = (owner: string): OwnerTiming => {
    let row = byOwner.get(owner);
    if (!row) {
      row = { owner, picks: 0, totalSeconds: 0, averageSeconds: null, longest: null, clocked: 0, calls: 0 };
      byOwner.set(owner, row);
    }
    return row;
  };
  let timedPicks = 0;
  let longestPick: DraftTimingStats['longestPick'] = null;
  for (const cell of board) {
    const pick = cell.selection;
    if (!pick || pick.isKeeper || cell.keeper || typeof pick.seconds !== 'number') continue;
    const owner = cell.pick.currentOwner;
    const row = get(owner);
    row.picks += 1;
    row.totalSeconds += pick.seconds;
    timedPicks += 1;
    const playerName = pick.playerName ?? pick.playerKey ?? '';
    if (!row.longest || pick.seconds > row.longest.seconds) {
      row.longest = { overall: cell.pick.overall, seconds: pick.seconds, playerName };
    }
    if (!longestPick || pick.seconds > longestPick.seconds) {
      longestPick = { owner, overall: cell.pick.overall, seconds: pick.seconds, playerName };
    }
    if (pick.clockCalledBy) {
      row.clocked += 1;
      get(pick.clockCalledBy).calls += 1;
    }
  }
  const rows = [...byOwner.values()];
  for (const row of rows) row.averageSeconds = row.picks > 0 ? Math.round(row.totalSeconds / row.picks) : null;
  const timed = rows.filter((row) => row.averageSeconds !== null);
  const best = <T>(list: readonly T[], better: (a: T, b: T) => boolean): T | null =>
    list.reduce<T | null>((keep, row) => (keep === null || better(row, keep) ? row : keep), null);
  const fastest = best(timed, (a, b) => (a.averageSeconds ?? 0) < (b.averageSeconds ?? 0));
  const slowest = best(timed, (a, b) => (a.averageSeconds ?? 0) > (b.averageSeconds ?? 0));
  const clocked = rows.filter((row) => row.clocked > 0);
  const callers = rows.filter((row) => row.calls > 0);
  return {
    owners: rows,
    fastest,
    slowest,
    longestPick,
    mostClocked: best(clocked, (a, b) => a.clocked > b.clocked),
    mostCalls: best(callers, (a, b) => a.calls > b.calls),
    timedPicks,
  };
}
