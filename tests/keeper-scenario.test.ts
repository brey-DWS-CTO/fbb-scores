import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeagueDynamicState } from '../src/lib/keeper/types.ts';
import {
  projectedPlayerKeys,
  scenarioWithProjectedKeepers,
  stateWithKeeperScenario,
} from '../src/lib/league/keeperScenario.ts';

test('updates one projected team without mutating the prior scenario', () => {
  const scenario = {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
  };
  const next = scenarioWithProjectedKeepers(
    scenario,
    'Kyle',
    [{ playerKey: 'allen', playerName: 'J. Allen' }],
  );

  assert.deepEqual(next, {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
    Kyle: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  });
  assert.deepEqual(scenario, {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
  });
});

test('removes one projected team while preserving the rest', () => {
  const scenario = {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
    Kyle: [{ playerKey: 'allen', playerName: 'J. Allen' }],
  };

  assert.deepEqual(scenarioWithProjectedKeepers(scenario, 'Kyle', []), {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
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
