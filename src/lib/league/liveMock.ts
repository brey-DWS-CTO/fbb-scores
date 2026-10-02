/**
 * A live mock draft: one person at the table, nine teams picking for
 * themselves.
 *
 * The whole draft is a replay. The person's choices are kept by pick number,
 * and the draft is rebuilt from the seed every time: fixed slots fill, the
 * other teams pick under the same rules and random stream as the odds, and
 * the person's slots take their saved choice or stop and wait. Undo is
 * dropping the last choice. Same seed and same choices, same draft.
 */
import { fillsSlot } from './draftValue.js';
import { createMockRun, runSeed, type MockCandidate, type MockPick, type MockRun, type MockSlot, type PreparedMock } from './mockDraft.js';

/** The person's picks, by overall pick number. */
export type LiveChoices = Readonly<Record<number, string>>;

export interface LiveState {
  run: MockRun;
  /** Every pick made so far, fixed slots and the other teams' picks included. */
  picks: readonly MockPick[];
  /** The person's slot waiting on a choice, or null. */
  waitingOn: MockSlot | null;
  /** True once every slot is filled. */
  over: boolean;
}

/** Rebuild the draft from the seed and the person's choices, up to the next choice needed. */
export function replayLive(prepared: PreparedMock, seed: number, person: string, choices: LiveChoices): LiveState {
  const run = createMockRun(prepared, seed);
  let waitingOn: MockSlot | null = null;
  for (let slot = run.nextSlot(); slot; slot = run.nextSlot()) {
    const live = !slot.keeper && !slot.made;
    if (live && slot.pick.currentOwner === person) {
      const chosen = choices[slot.pick.overall];
      if (chosen === undefined) {
        waitingOn = slot;
        break;
      }
      run.next(chosen);
    } else {
      run.next();
    }
  }
  return { run, picks: run.picks, waitingOn, over: run.nextSlot() === null };
}

/** The person's next live slot after `overall`, or null. */
export function nextLiveSlot(prepared: PreparedMock, person: string, overall: number): MockSlot | null {
  return prepared.input.board.slots.find(
    (slot) => slot.pick.overall > overall && slot.pick.currentOwner === person && !slot.keeper && !slot.made,
  ) ?? null;
}

/**
 * For every player on the board at the person's current pick, how often he is
 * gone by their next one. Each run replays the picks already made exactly as
 * they stand, lets the person's current pick go to their best value (so it
 * is not counted against him), and plays the other teams forward under a
 * fresh seed until the person's next slot. Zero runs when there is no next
 * slot.
 */
export function oddsGoneByNextPick(
  prepared: PreparedMock,
  seed: number,
  person: string,
  state: LiveState,
  runs = 60,
): Map<string, number> {
  const gone = new Map<string, number>();
  if (!state.waitingOn || runs <= 0) return gone;
  const from = state.waitingOn.pick.overall;
  const until = nextLiveSlot(prepared, person, from);
  if (!until) return gone;
  const made = state.picks.map((pick) => pick.playerKey);

  for (let k = 0; k < runs; k += 1) {
    const run = createMockRun(prepared, runSeed(seed, 1000 + k));
    // Everything already on the board, exactly as it stands.
    for (const key of made) {
      const slot = run.nextSlot();
      if (!slot) break;
      if (slot.keeper || slot.made || key === null) run.next();
      else run.next(key);
    }
    // The person's own pick, as the team would make it, not counted as gone.
    const own = run.next();
    while (run.nextSlot() && run.nextSlot()!.pick.overall < until.pick.overall) {
      const pick = run.next();
      if (pick.playerKey && pick.playerKey !== own.playerKey) gone.set(pick.playerKey, (gone.get(pick.playerKey) ?? 0) + 1);
    }
  }
  for (const [key, count] of gone) gone.set(key, count / runs);
  return gone;
}

/**
 * The player the team would take for the person, when the clock runs out:
 * the best value who fills a starting slot still open, else the best value.
 */
export function autoPick(state: LiveState): MockCandidate | null {
  if (!state.waitingOn) return null;
  const available = state.run.available();
  const open = state.run.lineupOf(state.waitingOn.pick.currentOwner).open;
  const fits = open.length > 0
    ? available.find((candidate) => open.some((slot) => fillsSlot(candidate.positions, slot)))
    : undefined;
  return fits ?? available[0] ?? null;
}
