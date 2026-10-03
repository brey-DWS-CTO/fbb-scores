import assert from 'node:assert/strict';
import test from 'node:test';
import { isPending } from '../src/lib/league/pickTrades.ts';
import { switchableTrades } from '../src/lib/league/whatIf.ts';
import { mockTradeProblem, mockTradeProposal, parseMockTrades, tradablePicks } from '../src/lib/league/mockTrades.ts';
import type { MockSlot } from '../src/lib/league/mockDraft.ts';

const slot = (round: number, slotNo: number, owner: string, extra: Partial<MockSlot> = {}): MockSlot => ({
  pick: { season: 2027, round, slot: slotNo, overall: (round - 1) * 10 + slotNo, originalOwner: owner, currentOwner: owner },
  keeper: null,
  made: null,
  ...extra,
});

test('a team can trade only its live picks', () => {
  const slots = [
    slot(1, 9, 'Brey'),
    slot(2, 2, 'Brey', { keeper: { playerKey: 'x', playerName: 'X', status: 'known', early: null } }),
    slot(3, 9, 'Brey'),
    slot(1, 1, 'Joel'),
  ];
  assert.deepEqual(tradablePicks(slots, 'Brey').map((pick) => pick.label), ['1.9', '3.9']);
});

test('a mock trade needs two teams and a pick', () => {
  assert.equal(mockTradeProblem({ teamA: 'Brey', teamB: 'Brey', aGives: [], bGives: [] }), 'Pick two different teams.');
  assert.equal(mockTradeProblem({ teamA: 'Brey', teamB: 'Joel', aGives: [], bGives: [] }), 'Tick at least one pick.');
  assert.equal(mockTradeProblem({ teamA: 'Brey', teamB: 'Joel', aGives: [{ season: 2027, round: 3, originalOwner: 'Brey' }], bGives: [] }), null);
});

test('a mock trade switches on like a pending offer', () => {
  const proposal = mockTradeProposal({
    id: 'mock:1',
    teamA: 'Brey',
    teamB: 'Joel',
    aGives: [{ season: 2027, round: 3, originalOwner: 'Brey' }],
    bGives: [{ season: 2027, round: 2, originalOwner: 'Joel' }],
  }, 2027);
  assert.ok(isPending(proposal));
  assert.deepEqual(switchableTrades([proposal]).map((entry) => entry.id), ['mock:1']);
});

test('saved mock trades read back; junk is dropped', () => {
  const good = { id: 'mock:1', teamA: 'Brey', teamB: 'Joel', aGives: [{ season: 2027, round: 3, originalOwner: 'Brey' }], bGives: [] };
  assert.deepEqual(parseMockTrades([good, { id: 'real-offer', teamA: 'A', teamB: 'B', aGives: [], bGives: [] }, null, 'x']), [good]);
  assert.deepEqual(parseMockTrades(undefined), []);
});

test('a mock trade switched on moves the picks on the mock board', async () => {
  const { default: raw } = await import('../src/data/league-2027.json', { with: { type: 'json' } });
  const { buildWorld } = await import('../src/lib/league/whatIf.ts');
  const dataset = raw as unknown as import('../src/lib/keeper/types.ts').LeagueDataset;
  const state: import('../src/lib/keeper/types.ts').LeagueDynamicState = {
    season: 2027,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
  };
  const [a, b] = dataset.teams.map((team) => team.owner);
  const before = buildWorld(dataset, { viewer: a, state, scenario: {}, proposals: [], tradesOn: [] });
  const aPick = tradablePicks(before.board.slots, a).find((pick) => pick.ref.round === 5)!;
  const bPick = tradablePicks(before.board.slots, b).find((pick) => pick.ref.round === 4)!;
  const proposal = mockTradeProposal({ id: 'mock:t', teamA: a, teamB: b, aGives: [aPick.ref], bGives: [bPick.ref] }, dataset.season);
  const after = buildWorld(dataset, { viewer: a, state, scenario: {}, proposals: [proposal], tradesOn: ['mock:t'] });
  assert.deepEqual(after.applied.map((entry) => entry.id), ['mock:t']);
  const owner = (ref: typeof aPick.ref) => after.board.slots.find((slot) => slot.pick.round === ref.round && slot.pick.originalOwner === ref.originalOwner)!.pick.currentOwner;
  assert.equal(owner(aPick.ref), b);
  assert.equal(owner(bPick.ref), a);
});
