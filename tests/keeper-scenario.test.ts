import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeagueDynamicState } from '../src/lib/keeper/types.ts';
import {
  clearKeeperScenario,
  projectedPlayerKeys,
  readKeeperScenario,
  saveProjectedKeepers,
  stateWithKeeperScenario,
} from '../src/lib/league/keeperScenario.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

test('keeps projections private to the viewer and season', () => {
  saveProjectedKeepers('Brey', 'Kyle', [{ playerKey: 'allen', playerName: 'J. Allen' }], 2027);

  assert.deepEqual(readKeeperScenario('Brey', 2027), {
    Kyle: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  });
  assert.deepEqual(readKeeperScenario('Joel', 2027), {});
  assert.deepEqual(readKeeperScenario('Brey', 2028), {});
});

test('moves a projected player instead of placing him on two teams', () => {
  clearKeeperScenario('Brey', 2027);
  saveProjectedKeepers('Brey', 'Kyle', [{ playerKey: 'allen', playerName: 'J. Allen' }], 2027);
  saveProjectedKeepers('Brey', 'Joel', [{ playerKey: 'allen', playerName: 'J. Allen' }], 2027);

  assert.deepEqual(readKeeperScenario('Brey', 2027), {
    Joel: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  });
});

test('overlays a private scenario without mutating real keeper state', () => {
  const state: LeagueDynamicState = {
    season: 2027,
    keepers: { Brey: [{ playerKey: 'mobley', playerName: 'E. Mobley' }] },
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
  };
  const scenario = {
    Kyle: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  };
  const preview = stateWithKeeperScenario(state, scenario);

  assert.deepEqual(preview.keepers, {
    Brey: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
    Kyle: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  });
  assert.deepEqual(state.keepers, {
    Brey: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
  });
  assert.deepEqual([...projectedPlayerKeys(scenario)], ['allen']);
});

test('clears a viewer scenario without touching another viewer', () => {
  saveProjectedKeepers('Brey', 'Kyle', [{ playerKey: 'allen', playerName: 'J. Allen' }], 2027);
  saveProjectedKeepers('Joel', 'Kyle', [{ playerKey: 'flagg', playerName: 'C. Flagg' }], 2027);

  clearKeeperScenario('Brey', 2027);

  assert.deepEqual(readKeeperScenario('Brey', 2027), {});
  assert.deepEqual(readKeeperScenario('Joel', 2027), {
    Kyle: [{ playerKey: 'flagg', playerName: 'C. Flagg' }],
  });
});
