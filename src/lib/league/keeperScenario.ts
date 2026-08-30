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

export function stateWithKeeperScenario(
  state: LeagueDynamicState,
  scenario: KeeperScenario,
): LeagueDynamicState {
  return {
    ...state,
    keepers: {
      ...state.keepers,
      ...scenario,
    },
  };
}

export function projectedPlayerKeys(scenario: KeeperScenario): Set<string> {
  return new Set(
    Object.values(scenario).flatMap((selections) => selections.map((selection) => selection.playerKey)),
  );
}
