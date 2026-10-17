/**
 * A mock draft with a friend: two people at one table, the room on the
 * server, and the same replay on every phone.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import { replayLive } from '../src/lib/league/liveMock.ts';
import { defaultMockSettings, prepareMock } from '../src/lib/league/mockDraft.ts';
import { applyPlayerPoolToDataset, playerPoolFromDataset } from '../src/lib/league/playerPool.ts';
import {
  SHARED_GRACE_SECONDS,
  SHARED_PICK_SECONDS,
  canJoinOpenRoom,
  clockHasRunOut,
  headToHead,
  joinSharedMock,
  newSharedMock,
  openSharedMock,
  nextPersonSlot,
  onTheClock,
  parseSharedMockRoom,
  pickInSharedMock,
  quitSharedMock,
  sharedMockBoard,
  sharedMockId,
  sharedMockKeepers,
  sharedMockPhase,
  showsFor,
  startOpenSharedMock,
  type SharedMockRoom,
} from '../src/lib/league/sharedMock.ts';

const committed = rawDataset as unknown as LeagueDataset;
const known = new Set(committed.players.map((player) => player.espnId));
const dataset = applyPlayerPoolToDataset(committed, [
  ...playerPoolFromDataset(committed.players),
  ...fixture.players.filter((entry) => !known.has(entry.espnId)).map((entry) => ({
    key: `p${entry.espnId}`, espnId: entry.espnId, fullName: entry.fullName,
    proTeam: entry.proTeam, positions: entry.positions, sourceStatus: 'fetched' as const,
  })),
]);
const values = valueBoard(dataset.players, fixture);
const OWNERS = dataset.teams.map((team) => team.owner);

/** A keeper-eligible player on an owner's roster, best average first; `skip` picks the next one down. */
const keeperOf = (owner: string, skip = 0) => {
  const found = dataset.players
    .filter((player) => player.fantasyTeam === owner && player.keeper.eligible)
    .sort((a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1))[skip];
  assert.ok(found, `${owner} has a keeper to try`);
  return { playerKey: found.key, playerName: found.name };
};

const PEOPLE = ['Brey', 'Joel'];
const breyKeeps = keeperOf('Brey');
const joelKeeps = keeperOf('Joel');
const kyleReallyKeeps = keeperOf('Kyle');
const state: LeagueDynamicState = {
  season: 2027,
  keepers: { Brey: [breyKeeps], Joel: [joelKeeps], Kyle: [kyleReallyKeeps] },
  keepersRevealed: false,
  draft: { picks: {}, startedAt: null },
  locks: { keepersLocked: false },
};
const T0 = '2026-10-16T20:00:00.000Z';
const later = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

// ─── Whose keepers go on the board ──────────────────────────────────────────

test('before the reveal the people at the table see each other\'s real keepers and nobody else\'s', () => {
  const sets = sharedMockKeepers(dataset, state, PEOPLE);
  assert.deepEqual(sets.keepers.Brey, [breyKeeps]);
  assert.deepEqual(sets.keepers.Joel, [joelKeeps]);
  assert.equal(sets.status.Brey, 'known');
  assert.equal(sets.status.Joel, 'known');
  // Kyle's real keeper stays hidden, and nobody's guess stands in for it:
  // each person projects the room differently, so his picks stay live.
  assert.deepEqual(sets.keepers.Kyle, []);
  assert.equal(sets.status.Kyle, 'assumed');
  const everyKey = Object.values(sets.keepers).flat().map((keeper) => keeper.playerKey);
  assert.ok(!everyKey.includes(kyleReallyKeeps.playerKey), 'a hidden keeper never reaches the board');
  assert.deepEqual(sets.keepers.Amy, []);
});

test('after the reveal everyone\'s real keepers are on the board', () => {
  const sets = sharedMockKeepers(dataset, { ...state, keepersRevealed: true }, PEOPLE);
  assert.deepEqual(sets.keepers.Kyle, [kyleReallyKeeps]);
  assert.equal(sets.status.Kyle, 'known');
});

test('the shared board fills both people\'s keeper slots as known', () => {
  const board = sharedMockBoard(dataset, state, PEOPLE);
  const kept = board.slots.filter((slot) => slot.keeper);
  assert.ok(kept.some((slot) => slot.pick.currentOwner === 'Brey' && slot.keeper?.status === 'known'));
  assert.ok(kept.some((slot) => slot.pick.currentOwner === 'Joel' && slot.keeper?.status === 'known'));
  assert.ok(!kept.some((slot) => slot.pick.currentOwner === 'Kyle'), 'a team not at the table has no keeper on the board');
  assert.ok(board.taken.includes(breyKeeps.playerKey));
  assert.ok(!board.taken.includes(kyleReallyKeeps.playerKey));
});

// ─── The room ───────────────────────────────────────────────────────────────

const board = sharedMockBoard(dataset, state, PEOPLE);
const prepared = prepareMock({ board, values, settings: defaultMockSettings('sharp', OWNERS, 7) });
const freshRoom = () => newSharedMock({ id: 'with-test-0001', season: 2027, host: 'Brey', guests: ['Joel'], mode: 'sharp', at: T0 });
const start = () => ({ board, seed: 7 });

test('a new room waits on the guest, and the host is seated from the start', () => {
  const room = freshRoom();
  assert.equal(sharedMockPhase(room), 'waiting');
  assert.deepEqual(room.people, ['Brey', 'Joel']);
  assert.deepEqual(room.joined, ['Brey']);
  assert.equal(room.board, null);
  assert.throws(() => newSharedMock({ ...room, guests: [], at: T0 }), /Pick somebody/);
  assert.throws(() => newSharedMock({ ...room, guests: ['Brey'], at: T0 }), /Pick somebody/);
  assert.throws(() => newSharedMock({ ...room, guests: ['Joel', 'Kyle', 'Amy', 'Ryan'], at: T0 }), /Up to 4/);
});

test('the last person to sit down starts the draft, on a frozen board, with the first person\'s clock running', () => {
  const room = freshRoom();
  assert.throws(() => joinSharedMock(room, 'Kyle', later(5), start), /not asked/);
  const live = joinSharedMock(room, 'Joel', later(5), start);
  assert.equal(sharedMockPhase(live), 'live');
  assert.equal(live.startedAt, later(5));
  assert.equal(live.seed, 7);
  assert.deepEqual(live.joined, ['Brey', 'Joel']);
  const first = nextPersonSlot(board, PEOPLE, {});
  assert.ok(first);
  assert.deepEqual(live.clock, { overall: first.pick.overall, startedAt: later(5) });
  assert.ok(PEOPLE.includes(onTheClock(live) ?? ''));
  // Sitting down twice changes nothing.
  assert.deepEqual(joinSharedMock(live, 'Joel', later(9), start), live);
});

test('the replay stops at whichever person is up, and the server\'s clock agrees with it pick after pick', () => {
  let room = joinSharedMock(freshRoom(), 'Joel', later(5), start);
  let picks = 0;
  while (sharedMockPhase(room) === 'live') {
    const live = replayLive(prepared, room.seed, PEOPLE, room.choices);
    assert.ok(live.waitingOn, 'the replay is waiting on somebody');
    assert.equal(live.waitingOn.pick.overall, room.clock?.overall, 'the pick on the clock is the one the replay waits on');
    const owner = live.waitingOn.pick.currentOwner;
    assert.ok(PEOPLE.includes(owner));
    const wanted = live.run.available()[picks % 3];
    room = pickInSharedMock(room, owner, live.waitingOn.pick.overall, wanted.playerKey, later(10 + picks), 'pick');
    picks += 1;
  }
  assert.equal(sharedMockPhase(room), 'finished');
  assert.equal(room.clock, null);
  const done = replayLive(prepared, room.seed, PEOPLE, room.choices);
  assert.equal(done.over, true);
  assert.equal(done.waitingOn, null);
  // Both people drafted their whole team; the choices cover every live slot of theirs.
  const liveSlots = board.slots.filter((slot) => !slot.keeper && !slot.made && PEOPLE.includes(slot.pick.currentOwner));
  assert.equal(Object.keys(room.choices).length, liveSlots.length);
  assert.ok(done.picks.filter((pick) => pick.owner === 'Joel' && pick.how === 'pick').length > 10);
});

test('a pick is refused off the clock, by the wrong person, or for a player already gone', () => {
  const room = joinSharedMock(freshRoom(), 'Joel', later(5), start);
  const live = replayLive(prepared, room.seed, PEOPLE, room.choices);
  const overall = live.waitingOn!.pick.overall;
  const owner = live.waitingOn!.pick.currentOwner;
  const other = PEOPLE.find((person) => person !== owner)!;
  const wanted = live.run.available()[0];
  assert.throws(() => pickInSharedMock(room, other, overall, wanted.playerKey, later(10), 'pick'), /not yours/);
  assert.throws(() => pickInSharedMock(room, 'Kyle', overall, wanted.playerKey, later(10), 'pick'), /not in this mock/);
  assert.throws(() => pickInSharedMock(room, owner, overall + 1, wanted.playerKey, later(10), 'pick'), /not on the clock/);
  assert.throws(() => pickInSharedMock(room, owner, overall, breyKeeps.playerKey, later(10), 'pick'), /already gone/);
  const after = pickInSharedMock(room, owner, overall, wanted.playerKey, later(10), 'pick');
  assert.equal(after.choices[overall], wanted.playerKey);
  assert.ok(after.clock && after.clock.overall > overall);
  assert.equal(after.clock.startedAt, later(10));
  assert.throws(() => pickInSharedMock(after, onTheClock(after)!, after.clock!.overall, wanted.playerKey, later(12), 'pick'), /already gone/);
  assert.throws(() => pickInSharedMock(freshRoom(), owner, overall, wanted.playerKey, later(10), 'pick'), /not started/);
});

test('the clock runs out for its own person at zero, and for anyone else a few seconds later', () => {
  const room = joinSharedMock(freshRoom(), 'Joel', T0, start);
  const owner = onTheClock(room)!;
  const other = PEOPLE.find((person) => person !== owner)!;
  const deadline = Date.parse(T0) + SHARED_PICK_SECONDS * 1000;
  assert.equal(clockHasRunOut(room, owner, deadline - 1000), false);
  assert.equal(clockHasRunOut(room, owner, deadline), true);
  assert.equal(clockHasRunOut(room, other, deadline), false);
  assert.equal(clockHasRunOut(room, other, deadline + SHARED_GRACE_SECONDS * 1000), true);
  // The room's pick is marked as the clock's.
  const live = replayLive(prepared, room.seed, PEOPLE, room.choices);
  const auto = pickInSharedMock(room, other, room.clock!.overall, live.run.available()[0].playerKey, later(130), 'auto');
  assert.deepEqual(auto.auto, [room.clock!.overall]);
  assert.equal(clockHasRunOut(freshRoom(), owner, deadline), false, 'no clock before the draft starts');
});

test('quitting ends a running draft for everyone; on a finished one it only clears the page', () => {
  const room = joinSharedMock(freshRoom(), 'Joel', T0, start);
  const ended = quitSharedMock(room, 'Joel', later(30));
  assert.equal(sharedMockPhase(ended), 'ended');
  assert.equal(ended.endedBy, 'Joel');
  assert.equal(ended.clock, null);
  assert.deepEqual(ended.dismissed, ['Joel']);
  assert.equal(showsFor(ended, 'Brey'), true, 'the host still sees who left');
  assert.equal(showsFor(ended, 'Joel'), false);
  assert.throws(() => pickInSharedMock(ended, onTheClock(room)!, room.clock!.overall, 'p1', later(40), 'pick'), /over/);
  assert.throws(() => joinSharedMock(ended, 'Joel', later(40), start), /over/);
  assert.throws(() => quitSharedMock(room, 'Kyle', later(30)), /not in this mock/);
  // Declining an invite is the same move, before the draft starts.
  const passed = quitSharedMock(freshRoom(), 'Joel', later(1));
  assert.equal(sharedMockPhase(passed), 'ended');
  assert.equal(passed.startedAt, null);
  // A finished draft just drops off the quitter's page.
  const finished: SharedMockRoom = { ...room, finishedAt: later(900), clock: null };
  const cleared = quitSharedMock(finished, 'Brey', later(1000));
  assert.equal(sharedMockPhase(cleared), 'finished');
  assert.equal(cleared.endedAt, null);
  assert.deepEqual(cleared.dismissed, ['Brey']);
  assert.equal(showsFor(cleared, 'Joel'), true);
});

test('head to head reads in plain words', () => {
  const standings = [
    { owner: 'Amy', points: 9000, rank: 1 },
    { owner: 'Brey', points: 8800, rank: 2 },
    { owner: 'Joel', points: 8000, rank: 5 },
  ];
  assert.equal(headToHead(standings, 'Brey', ['Joel']), 'You beat Joel: 2nd to his 5th.');
  assert.equal(headToHead(standings, 'Joel', ['Brey']), 'Brey beat you: 2nd to your 5th.');
  assert.equal(headToHead(standings, 'Brey', ['Joel', 'Kyle']), 'You beat Joel: 2nd to his 5th. Kyle has no team here.');
  assert.equal(headToHead(standings, 'Kyle', ['Brey']), '');
});

test('a room survives the store as JSON, and the id is safe in a link', () => {
  const room = joinSharedMock(freshRoom(), 'Joel', T0, start);
  const back = parseSharedMockRoom(JSON.parse(JSON.stringify(room)));
  assert.deepEqual(back, room);
  assert.equal(parseSharedMockRoom({ id: 'x' }), null);
  assert.equal(parseSharedMockRoom(null), null);
  assert.match(sharedMockId(T0, 0.42), /^with-[a-z0-9]+-[a-z0-9]{4}$/);
  assert.notEqual(sharedMockId(T0, 0.42), sharedMockId(T0, 0.43));
});

// ─── An open room ───────────────────────────────────────────────────────────

test('an open room takes anyone until it is full, and only the host starts it', () => {
  const opened = openSharedMock({ id: 'with-open-0001', season: 2027, host: 'Brey', mode: 'realistic', at: T0 });
  assert.equal(opened.open, true);
  assert.deepEqual(opened.people, ['Brey']);
  assert.equal(sharedMockPhase(opened), 'waiting');
  assert.throws(() => startOpenSharedMock(opened, 'Brey', later(1), start), /Wait for somebody/);
  assert.equal(canJoinOpenRoom(opened, 'Joel'), true);
  assert.equal(canJoinOpenRoom(opened, 'Brey'), false);

  const two = joinSharedMock(opened, 'Joel', later(2), start);
  assert.equal(sharedMockPhase(two), 'waiting', 'sitting down does not start an open room');
  assert.deepEqual(two.people, ['Brey', 'Joel']);
  assert.deepEqual(two.joined, ['Brey', 'Joel']);
  assert.deepEqual(joinSharedMock(two, 'Joel', later(3), start), two);
  const four = joinSharedMock(joinSharedMock(two, 'Kyle', later(3), start), 'Amy', later(4), start);
  assert.throws(() => joinSharedMock(four, 'Ryan', later(5), start), /full/);
  assert.equal(canJoinOpenRoom(four, 'Ryan'), false);

  assert.throws(() => startOpenSharedMock(two, 'Joel', later(5), start), /Only Brey/);
  const live = startOpenSharedMock(two, 'Brey', later(5), start);
  assert.equal(sharedMockPhase(live), 'live');
  assert.ok(live.clock);
  assert.throws(() => joinSharedMock(live, 'Kyle', later(6), start), /has started/);
  assert.throws(() => startOpenSharedMock(live, 'Brey', later(6), start), /has started/);
  assert.throws(() => startOpenSharedMock(joinSharedMock(freshRoom(), 'Joel', T0, start), 'Brey', later(1), start), /has started/);
});

test('leaving an open room before the start gives up the seat; the host leaving closes it', () => {
  const two = joinSharedMock(openSharedMock({ id: 'with-open-0002', season: 2027, host: 'Brey', mode: 'sharp', at: T0 }), 'Joel', later(1), start);
  const left = quitSharedMock(two, 'Joel', later(2));
  assert.equal(sharedMockPhase(left), 'waiting');
  assert.deepEqual(left.people, ['Brey']);
  assert.deepEqual(left.joined, ['Brey']);
  assert.equal(canJoinOpenRoom(left, 'Joel'), true, 'he may come back');
  const closed = quitSharedMock(two, 'Brey', later(2));
  assert.equal(sharedMockPhase(closed), 'ended');
  assert.equal(closed.endedBy, 'Brey');
  // Once it runs, leaving ends it for everyone, as in any shared mock.
  const live = startOpenSharedMock(two, 'Brey', later(3), start);
  assert.equal(sharedMockPhase(quitSharedMock(live, 'Joel', later(4))), 'ended');
  // The flag survives the store.
  assert.equal(parseSharedMockRoom(JSON.parse(JSON.stringify(live)))?.open, true);
});
