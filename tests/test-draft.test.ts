import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeagueDynamicState } from '../src/lib/keeper/types.js';
import { stateSide, testDraftState } from '../src/lib/league/testDraft.js';

const NOW = '2026-10-15T20:00:00.000Z';

function live(overrides: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: 2027,
    keepers: { Joel: [{ playerKey: 'jokic', playerName: 'Nikola Jokic' }] },
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: true },
    playerPool: { activeSnapshotId: 'pool-7' },
    pickTransfers: [],
    pickTradeProposals: [{ id: 'offer' } as never],
    ...overrides,
  };
}

test('the copy starts the draft now with the clock running and no picks', () => {
  const copy = testDraftState(live(), NOW, 'fallback');
  assert.equal(copy.draft.startedAt, NOW);
  assert.equal(copy.draft.clock?.pickStartedAt, NOW);
  assert.deepEqual(copy.draft.picks, {});
  assert.equal(copy.draft.playerPoolSnapshotId, 'pool-7');
  assert.equal(copy.keepersRevealed, true);
  assert.deepEqual(copy.pickTradeProposals, []);
});

test('secret keepers stay out of the copy; revealed ones come across', () => {
  assert.deepEqual(testDraftState(live(), NOW, 'fallback').keepers, {});
  assert.equal(testDraftState(live({ keepersRevealed: true }), NOW, 'fallback').keepers.Joel?.length, 1);
});

test('the copy never shares objects with the league', () => {
  const league = live({ keepersRevealed: true });
  const copy = testDraftState(league, NOW, 'fallback');
  copy.keepers.Joel?.pop();
  assert.equal(league.keepers.Joel?.length, 1);
});

test('the pool falls back when the league has none', () => {
  assert.equal(testDraftState(live({ playerPool: undefined }), NOW, 'fallback').draft.playerPoolSnapshotId, 'fallback');
});

test('a reply goes to the test side only when the server served the test', () => {
  assert.equal(stateSide({ testDraft: { running: true, serving: true } }), 'test');
  assert.equal(stateSide({ testDraft: { running: true, serving: false } }), 'league');
  assert.equal(stateSide({}), 'league');
  assert.equal(stateSide(null), 'league');
});
