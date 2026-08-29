import type { KeeperSelection, LeagueDynamicState } from '../keeper/types.js';

export type KeeperScenario = Record<string, KeeperSelection[]>;

const KEY_PREFIX = 'fbb-keeper-scenario-v1:';

function isKeeperSelection(value: unknown): value is KeeperSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selection = value as Partial<KeeperSelection>;
  return typeof selection.playerKey === 'string'
    && selection.playerKey.length > 0
    && typeof selection.playerName === 'string'
    && selection.playerName.length > 0;
}

function parseKeeperScenario(value: unknown): KeeperScenario {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scenario: KeeperScenario = {};
  for (const [owner, selections] of Object.entries(value)) {
    if (!owner || !Array.isArray(selections)) continue;
    const valid = selections.filter(isKeeperSelection).slice(0, 2);
    if (valid.length > 0) scenario[owner] = valid.map((selection) => ({ ...selection }));
  }
  return scenario;
}

function storageKey(viewer: string, season: number): string {
  return `${KEY_PREFIX}${season}:${viewer}`;
}

export function readKeeperScenario(viewer: string, season = 2027): KeeperScenario {
  try {
    const raw = localStorage.getItem(storageKey(viewer, season));
    if (!raw) return {};
    return parseKeeperScenario(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function writeKeeperScenario(viewer: string, scenario: KeeperScenario, season = 2027): void {
  try {
    localStorage.setItem(storageKey(viewer, season), JSON.stringify(scenario));
  } catch {
    // A private preview should fail closed without touching league state.
  }
}

export function saveProjectedKeepers(
  viewer: string,
  target: string,
  selections: KeeperSelection[],
  season = 2027,
): KeeperScenario {
  const scenario = readKeeperScenario(viewer, season);
  if (selections.length === 0) delete scenario[target];
  else {
    const saved = selections.filter(isKeeperSelection).slice(0, 2);
    const savedKeys = new Set(saved.map((selection) => selection.playerKey));
    for (const [owner, existing] of Object.entries(scenario)) {
      if (owner === target) continue;
      const unique = existing.filter((selection) => !savedKeys.has(selection.playerKey));
      if (unique.length > 0) scenario[owner] = unique;
      else delete scenario[owner];
    }
    scenario[target] = saved.map((selection) => ({ ...selection }));
  }
  writeKeeperScenario(viewer, scenario, season);
  return scenario;
}

export function clearKeeperScenario(viewer: string, season = 2027): void {
  try {
    localStorage.removeItem(storageKey(viewer, season));
  } catch {
    /* ignore */
  }
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
