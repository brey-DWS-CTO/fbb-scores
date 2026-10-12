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
import { createMockRun, prepareMock, runSeed, type MockCandidate, type MockPick, type MockRun, type MockSlot, type PreparedMock } from './mockDraft.js';

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
 * they stand, gives the person's current pick to the last man on the board
 * (the sim never assumes they take anyone), and plays the other teams
 * forward under a fresh seed until the person's next slot. Zero runs when
 * there is no next slot.
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
    // The person's own pick never takes anyone good: the question is whether
    // a player is still there NEXT time, so this slot takes the last man on
    // the board and is not counted as gone.
    const own = run.next(run.available().at(-1)?.playerKey);
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

/**
 * At one of the person's own keeper slots: how often that player would still
 * have been on the board had he not been kept. The slot is made live and the
 * player put back in the pool, then the draft is played to that slot `runs`
 * times under fresh seeds. The person's earlier choices stand; their other
 * live picks before the slot go to the team's best value. Null when the slot
 * is not one of the person's keepers.
 */
export function oddsKeeperThere(
  prepared: PreparedMock,
  seed: number,
  person: string,
  overall: number,
  choices: LiveChoices,
  runs = 60,
): number | null {
  const slot = prepared.input.board.slots.find((entry) => entry.pick.overall === overall);
  const keeper = slot?.keeper ?? null;
  if (!slot || !keeper || slot.pick.currentOwner !== person || runs <= 0) return null;
  const board = prepared.input.board;
  const open = prepareMock({
    ...prepared.input,
    board: {
      ...board,
      slots: board.slots.map((entry) => (entry.pick.overall === overall ? { ...entry, keeper: null } : entry)),
      taken: board.taken.filter((key) => key !== keeper.playerKey),
    },
  });
  if (!open.pool.some((candidate) => candidate.playerKey === keeper.playerKey)) return null;

  let there = 0;
  for (let k = 0; k < runs; k += 1) {
    const run = createMockRun(open, runSeed(seed, 5000 + k));
    let gone = false;
    for (let next = run.nextSlot(); next && next.pick.overall < overall; next = run.nextSlot()) {
      const live = !next.keeper && !next.made;
      const chosen = live && next.pick.currentOwner === person ? choices[next.pick.overall] : undefined;
      const pick = chosen !== undefined && run.available().some((candidate) => candidate.playerKey === chosen)
        ? run.next(chosen)
        : run.next();
      if (pick.playerKey === keeper.playerKey) {
        gone = true;
        break;
      }
    }
    if (!gone) there += 1;
  }
  return there / runs;
}

/**
 * The real board, from the pick on the clock: for every player still on it,
 * how often he is gone before `person`'s next open pick, across `runs`
 * drafts played from here. Picks already made stand as made. When the pick
 * on the clock is the person's own, the question is "if I pass on him now,
 * is he there next time?", so that slot takes the last man on the board
 * and nobody good is counted as the person's own pick. Empty when the
 * person has no open pick left.
 */
export function oddsGoneFromClock(
  prepared: PreparedMock,
  seed: number,
  person: string,
  onClock: number,
  runs = 60,
): Map<string, number> {
  const gone = new Map<string, number>();
  if (runs <= 0) return gone;
  const until = nextLiveSlot(prepared, person, onClock);
  if (!until) return gone;

  for (let k = 0; k < runs; k += 1) {
    const run = createMockRun(prepared, runSeed(seed, 1000 + k));
    for (let slot = run.nextSlot(); slot && slot.pick.overall < until.pick.overall; slot = run.nextSlot()) {
      const fixed = slot.keeper !== null || slot.made !== null;
      const own = slot.pick.overall === onClock && slot.pick.currentOwner === person;
      const pick = own && !fixed ? run.next(run.available().at(-1)?.playerKey) : run.next();
      if (fixed || own || slot.pick.overall < onClock || !pick.playerKey) continue;
      gone.set(pick.playerKey, (gone.get(pick.playerKey) ?? 0) + 1);
    }
  }
  for (const [key, count] of gone) gone.set(key, count / runs);
  return gone;
}
