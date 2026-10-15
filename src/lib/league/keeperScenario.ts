import type { KeeperSelection, LeagueDynamicState } from '../keeper/types.js';

export type KeeperScenario = Record<string, KeeperSelection[]>;

export function scenarioWithProjectedKeepers(
  scenario: KeeperScenario,
  target: string,
  selections: KeeperSelection[],
): KeeperScenario {
  const next: KeeperScenario = Object.fromEntries(
    Object.entries(scenario).map(([owner, existing]) => [
      owner,
      existing.map((selection) => ({ ...selection })),
    ]),
  );
  if (selections.length === 0) delete next[target];
  else next[target] = selections.slice(0, 2).map((selection) => ({ ...selection }));
  return next;
}

/**
 * Keepers you know for one team, topped up from your guess.
 *
 * Before the reveal a member knows another team's keepers only by spending
 * achievement reveals, often one of two. What is known always stands; the
 * guess fills only the slots still hidden, never a player already shown.
 * `count` is how many the team has saved, when known.
 */
export function knownThenGuess(
  known: readonly KeeperSelection[],
  guess: readonly KeeperSelection[] | undefined,
  count: number | undefined,
  max = 2,
): KeeperSelection[] {
  const seen = new Set(known.map((k) => k.playerKey));
  const room = Math.max(known.length, Math.min(count ?? max, max));
  const extra = (guess ?? []).filter((g) => !seen.has(g.playerKey));
  return [...known, ...extra].slice(0, room).map((k) => ({ ...k }));
}

/** True when some of this team's keepers are known and some still hidden. */
export function partlyKnown(known: readonly KeeperSelection[], count: number | undefined): boolean {
  return known.length > 0 && count !== undefined && count > known.length;
}

/**
 * The board with your guesses laid over it. A team you have revealed keepers
 * on keeps them; your guess fills only what is still hidden.
 */
export function stateWithKeeperScenario(
  state: LeagueDynamicState,
  scenario: KeeperScenario,
  counts?: Readonly<Record<string, number>>,
): LeagueDynamicState {
  const keepers: Record<string, KeeperSelection[]> = { ...state.keepers };
  for (const [owner, guess] of Object.entries(scenario)) {
    const known = state.keepers[owner] ?? [];
    keepers[owner] = known.length > 0 ? knownThenGuess(known, guess, counts?.[owner]) : guess;
  }
  return { ...state, keepers };
}

export function projectedPlayerKeys(scenario: KeeperScenario): Set<string> {
  return new Set(
    Object.values(scenario).flatMap((selections) => selections.map((selection) => selection.playerKey)),
  );
}

/** Owners the viewer has projected at least one keeper for. */
export function projectedOwners(scenario: KeeperScenario): Set<string> {
  return new Set(
    Object.entries(scenario)
      .filter(([, selections]) => selections.length > 0)
      .map(([owner]) => owner),
  );
}
