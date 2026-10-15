import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeagueDynamicState } from '../src/lib/keeper/types.ts';
import {
  knownThenGuess,
  partlyKnown,
  projectedOwners,
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

test('lists the owners with a projection saved, skipping empty ones', () => {
  const scenario = {
    Joel: [{ playerKey: 'mobley', playerName: 'E. Mobley' }],
    Kyle: [],
    Amy: [
      { playerKey: 'allen', playerName: 'J. Allen' },
      { playerKey: 'garland', playerName: 'D. Garland' },
    ],
  };

  assert.deepEqual([...projectedOwners(scenario)].sort(), ['Amy', 'Joel']);
  assert.deepEqual([...projectedOwners({})], []);
});

// ─── Revealed keepers beat guesses ─────────────────────────────────────────

const sel = (playerKey: string) => ({ playerKey, playerName: playerKey });

test('a revealed keeper stands; the guess fills only the hidden slot', () => {
  const merged = knownThenGuess([sel('jokic')], [sel('curry'), sel('jokic')], 2);
  assert.deepEqual(merged.map((k) => k.playerKey), ['jokic', 'curry']);
});

test('a team keeping one, already revealed, takes nothing from the guess', () => {
  assert.deepEqual(knownThenGuess([sel('jokic')], [sel('curry')], 1).map((k) => k.playerKey), ['jokic']);
});

test('without a count, the guess tops up to two', () => {
  assert.deepEqual(knownThenGuess([sel('jokic')], [sel('curry'), sel('luka')], undefined).map((k) => k.playerKey), ['jokic', 'curry']);
});

test('the board overlay keeps revealed keepers over the guess', () => {
  const state = { keepers: { Amy: [sel('jokic')] } } as unknown as Parameters<typeof stateWithKeeperScenario>[0];
  const out = stateWithKeeperScenario(state, { Amy: [sel('curry'), sel('luka')], Kyle: [sel('tatum')] }, { Amy: 2, Kyle: 1 });
  assert.deepEqual(out.keepers.Amy.map((k) => k.playerKey), ['jokic', 'curry']);
  assert.deepEqual(out.keepers.Kyle.map((k) => k.playerKey), ['tatum'], 'a team with nothing revealed is all guess');
  assert.equal(partlyKnown([sel('jokic')], 2), true);
  assert.equal(partlyKnown([sel('jokic')], 1), false);
});
