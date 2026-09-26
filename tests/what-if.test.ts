/**
 * What-if worlds: pending trades as switches and the viewer's own keeper
 * what-if, laid over the real board. Nothing here may write.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState, PickTradeProposal } from '../src/lib/keeper/types.ts';
import { buildAllPicks } from '../src/lib/keeper/engine.ts';
import { buildWorld, privateTrades, switchableTrades, tradeConflicts } from '../src/lib/league/whatIf.ts';

const dataset = rawDataset as unknown as LeagueDataset;

const select = (fullName: string) => {
  const found = dataset.players.find((player) => player.fullName === fullName);
  assert.ok(found, `dataset needs ${fullName}`);
  return { playerKey: found.key, playerName: found.name };
};

const cade = select('Cade Cunningham');
const sabonis = select('Domantas Sabonis');
const jokic = select('Nikola Jokic');
const flagg = select('Cooper Flagg');

function state(patch: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: 2027,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
    ...patch,
  };
}

function proposal(
  id: string,
  proposer: string,
  recipient: string,
  offer: Array<[number, string]>,
  request: Array<[number, string]>,
  status: PickTradeProposal['status'] = 'pending',
): PickTradeProposal {
  const ref = ([round, originalOwner]: [number, string]) => ({ season: 2027, round, originalOwner });
  return {
    id,
    season: 2027,
    proposer,
    recipient,
    offer: offer.map(ref),
    request: request.map(ref),
    note: '',
    status,
    version: 1,
    createdAt: '2026-09-20T12:00:00.000Z',
    expiresAt: '2026-09-27T12:00:00.000Z',
  };
}

// Kyle's 1.5 for Brey's 1.9: the deal in the text message.
const kyleBrey = proposal('kb', 'Kyle', 'Brey', [[1, 'Kyle']], [[1, 'Brey']]);
// Kyle's 1.5 to Aaron: moves the same pick, so it cannot be on with the first.
const kyleAaron = proposal('ka', 'Kyle', 'Aaron', [[1, 'Kyle']], [[1, 'Aaron']]);
// Two other members' offer as the commissioner sees it: who and when, no picks.
const hidden = proposal('hid', 'Ryan', 'Patrick', [], []);
const done = proposal('old', 'Kyle', 'Brey', [[2, 'Kyle']], [[2, 'Brey']], 'accepted');
const PROPOSALS = [kyleBrey, kyleAaron, hidden, done];

const slot = (world: ReturnType<typeof buildWorld>, overall: number) =>
  world.board.slots.find((entry) => entry.pick.overall === overall)!;

test('the real board has Kyle at 1.5 and Brey at 1.9 before any what-if', () => {
  const picks = buildAllPicks(dataset);
  assert.equal(picks.find((pick) => pick.overall === 5)?.currentOwner, 'Kyle');
  assert.equal(picks.find((pick) => pick.overall === 9)?.currentOwner, 'Brey');
});

test('only pending offers with visible picks can be switched, and same-pick offers conflict', () => {
  assert.deepEqual(switchableTrades(PROPOSALS).map((p) => p.id), ['kb', 'ka']);
  assert.deepEqual(privateTrades(PROPOSALS).map((p) => p.id), ['hid']);
  const conflicts = tradeConflicts(PROPOSALS);
  assert.deepEqual(conflicts.get('kb'), ['ka']);
  assert.deepEqual(conflicts.get('ka'), ['kb']);
  assert.equal(conflicts.has('hid'), false);
});

test('switching a trade on moves the picks and resets the keeper charged to one', () => {
  const before = state({ keepers: { Brey: [cade] } });
  const scenario = { Joel: [jokic] };
  const frozenState = JSON.stringify(before);
  const frozenScenario = JSON.stringify(scenario);

  const off = buildWorld(dataset, { viewer: 'Brey', state: before, scenario, proposals: PROPOSALS, tradesOn: [] });
  assert.equal(slot(off, 9).pick.currentOwner, 'Brey');
  assert.equal(slot(off, 9).keeper?.playerName, cade.playerName);
  assert.equal(slot(off, 9).keeper?.status, 'known');
  assert.ok(off.board.taken.includes(cade.playerKey));

  const on = buildWorld(dataset, { viewer: 'Brey', state: before, scenario, proposals: PROPOSALS, tradesOn: ['kb'] });
  assert.deepEqual(on.applied.map((p) => p.id), ['kb']);
  assert.deepEqual(on.skipped, []);
  assert.equal(slot(on, 5).pick.currentOwner, 'Brey');
  assert.equal(slot(on, 9).pick.currentOwner, 'Kyle');
  // Brey paid for Cade with 1.9. It moved, so his keepers are reset and Cade is on the board.
  assert.deepEqual(on.resets, [{ owner: 'Brey', status: 'known', players: [cade.playerName], proposalId: 'kb' }]);
  assert.equal(slot(on, 5).keeper, null);
  assert.equal(slot(on, 9).keeper, null);
  assert.equal(on.board.taken.includes(cade.playerKey), false);
  // Joel's assumed keeper is untouched.
  assert.equal(slot(on, 1).keeper?.playerName, jokic.playerName);
  assert.equal(slot(on, 1).keeper?.status, 'assumed');

  // Nothing was written.
  assert.equal(JSON.stringify(before), frozenState);
  assert.equal(JSON.stringify(scenario), frozenScenario);
  assert.equal(dataset.pickTrades.some((trade) => trade.proposalId === 'kb'), false);
});

test('a guessed keeper on a moved pick is reset too, and says it was a guess', () => {
  const world = buildWorld(dataset, {
    viewer: 'Brey',
    state: state(),
    scenario: { Kyle: [sabonis] },
    proposals: PROPOSALS,
    tradesOn: ['kb'],
  });
  assert.deepEqual(world.resets, [{ owner: 'Kyle', status: 'assumed', players: [sabonis.playerName], proposalId: 'kb' }]);
  assert.equal(world.board.taken.includes(sabonis.playerKey), false);
  assert.deepEqual(world.scenario.Kyle, []);
});

test('the second offer on the same pick is skipped and names the first', () => {
  const world = buildWorld(dataset, {
    viewer: 'Brey',
    state: state(),
    scenario: {},
    proposals: PROPOSALS,
    tradesOn: ['kb', 'ka', 'hid', 'old', 'nope'],
  });
  assert.deepEqual(world.applied.map((p) => p.id), ['kb']);
  assert.deepEqual(
    world.skipped.map((entry) => [entry.id, entry.reason, entry.conflictsWith ?? null]),
    [['ka', 'conflict', 'kb'], ['hid', 'private', null], ['old', 'not-pending', null], ['nope', 'unknown', null]],
  );
  assert.equal(slot(world, 5).pick.currentOwner, 'Brey');
  assert.equal(slot(world, 7).pick.currentOwner, 'Aaron');
});

test('the viewer can try their own keepers without touching the real submission', () => {
  const real = state({ keepers: { Brey: [cade] } });
  const nobody = buildWorld(dataset, {
    viewer: 'Brey', state: real, scenario: {}, proposals: [], tradesOn: [], ownKeepers: [],
  });
  assert.equal(slot(nobody, 9).keeper, null);
  assert.equal(nobody.board.taken.includes(cade.playerKey), false);
  assert.deepEqual(real.keepers.Brey, [cade]);

  const none = state();
  const keepCade = buildWorld(dataset, {
    viewer: 'Brey', state: none, scenario: {}, proposals: [], tradesOn: [], ownKeepers: [cade],
  });
  assert.equal(slot(keepCade, 9).keeper?.playerName, cade.playerName);
  assert.equal(slot(keepCade, 9).keeper?.status, 'assumed', 'a what-if, not a locked keeper');
  assert.deepEqual(none.keepers, {});
});

test('a what-if pair is picked after the trade, so Cade can be kept with the pick that came in', () => {
  const real = state({ keepers: { Brey: [cade] } });
  const world = buildWorld(dataset, {
    viewer: 'Brey', state: real, scenario: {}, proposals: PROPOSALS, tradesOn: ['kb'], ownKeepers: [cade],
  });
  // The real keepers still reset: the trade moved 1.9, which paid for Cade.
  assert.deepEqual(world.resets.map((reset) => [reset.owner, reset.status]), [['Brey', 'known']]);
  // The re-pick then charges Cade to 1.5, the pick Brey got from Kyle.
  assert.equal(slot(world, 5).pick.currentOwner, 'Brey');
  assert.equal(slot(world, 5).keeper?.playerName, cade.playerName);
  assert.equal(slot(world, 5).keeper?.status, 'assumed');
  assert.equal(slot(world, 9).keeper, null);
  assert.ok(world.board.taken.includes(cade.playerKey));
});

test('the commissioner can use what teams have entered, with the guess as the fallback', () => {
  // Kyle has entered Sabonis; the guess says Flagg. Joel has entered nothing; the guess says Jokic.
  const entered = state({ keepers: { Kyle: [sabonis] } });
  const scenario = { Kyle: [flagg], Joel: [jokic] };

  // Flagg is a round-4 tier, so the guess sits on Kyle's round-4 pick; Sabonis is round 1 and sits on 1.5.
  const kyleKeeper = (world: ReturnType<typeof buildWorld>) =>
    world.board.slots.find((entry) => entry.pick.currentOwner === 'Kyle' && entry.keeper)!;

  const guesses = buildWorld(dataset, { viewer: 'Brey', state: entered, scenario, proposals: [], tradesOn: [] });
  assert.equal(kyleKeeper(guesses).keeper?.playerName, flagg.playerName, 'off: the guess is used even where Kyle has entered');
  assert.equal(kyleKeeper(guesses).keeper?.status, 'assumed');
  assert.equal(kyleKeeper(guesses).pick.round, 4);

  const real = buildWorld(dataset, { viewer: 'Brey', state: entered, scenario, proposals: [], tradesOn: [], useEntered: true });
  assert.equal(slot(real, 5).keeper?.playerName, sabonis.playerName, 'on: what Kyle entered wins');
  assert.equal(slot(real, 5).keeper?.status, 'known');
  assert.equal(real.board.taken.includes(flagg.playerKey), false, 'the guess about Kyle is set aside');
  assert.equal(slot(real, 1).keeper?.playerName, jokic.playerName, 'Joel entered nothing, so the guess stands');
  assert.equal(slot(real, 1).keeper?.status, 'assumed');
  assert.deepEqual(real.board.knownOwners.sort(), ['Brey', 'Kyle']);

  // "I think Kyle will change his mind": his entry is set aside, the guess stands, Joel is unchanged.
  const doubt = buildWorld(dataset, {
    viewer: 'Brey', state: entered, scenario, proposals: [], tradesOn: [], useEntered: true, guessInstead: ['Kyle'],
  });
  assert.equal(kyleKeeper(doubt).keeper?.playerName, flagg.playerName);
  assert.equal(kyleKeeper(doubt).keeper?.status, 'assumed');
  assert.equal(doubt.board.taken.includes(sabonis.playerKey), false);
  assert.equal(slot(doubt, 1).keeper?.playerName, jokic.playerName);
});

test('after the reveal every keeper is known and the scenario plays no part', () => {
  const revealed = state({ keepersRevealed: true, keepers: { Kyle: [sabonis], Brey: [cade] } });
  const world = buildWorld(dataset, {
    viewer: 'Brey', state: revealed, scenario: { Kyle: [jokic] }, proposals: PROPOSALS, tradesOn: ['kb'],
  });
  assert.equal(slot(world, 1).keeper, null, 'the guess about Kyle is ignored after the reveal');
  assert.deepEqual(
    world.resets.map((reset) => [reset.owner, reset.status]).sort(),
    [['Brey', 'known'], ['Kyle', 'known']],
  );
  assert.deepEqual(world.board.assumedOwners, []);
});
