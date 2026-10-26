import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMove, type LineupSnapshot, type MoveRequest } from '../src/lib/league/lineup.js';

const now = new Date('2026-10-24T20:00:00Z');
const later = '2026-10-24T21:00:00Z';
const move: MoveRequest = { playerId: 1, destinationSlotId: 'pg-1', revision: 'r1' };
function roster(): LineupSnapshot {
  return {
    leagueId: 'league', teamId: 5, scoringPeriodId: 4, revision: 'r1', fetchedAt: now.toISOString(),
    lockMode: 'individual', periodLockAt: null,
    slots: [
      { id: 'pg-1', label: 'PG', eligibilityId: 0, playerId: 2 },
      { id: 'pg-2', label: 'PG', eligibilityId: 0, playerId: null },
      { id: 'bench-1', label: 'Bench', eligibilityId: 12, playerId: 1 },
      { id: 'c-1', label: 'C', eligibilityId: 4, playerId: 3 },
    ],
    players: [
      { id: 1, name: 'One', eligibleSlotIds: [0, 12], lockAt: later, locked: false },
      { id: 2, name: 'Two', eligibleSlotIds: [0, 12], lockAt: later, locked: false },
      { id: 3, name: 'Three', eligibleSlotIds: [4, 12], lockAt: later, locked: false },
    ],
  };
}

test('bench to occupied starter plans both sides and leaves input unchanged', () => {
  const snapshot = roster();
  const before = structuredClone(snapshot);
  assert.deepEqual(validateMove(snapshot, move, now).assignments, [
    { playerId: 1, fromSlotId: 'bench-1', toSlotId: 'pg-1' },
    { playerId: 2, fromSlotId: 'pg-1', toSlotId: 'bench-1' },
  ]);
  assert.deepEqual(snapshot, before);
});
test('empty destination and repeated position slots retain distinct identities', () => {
  assert.deepEqual(validateMove(roster(), { ...move, destinationSlotId: 'pg-2' }, now).assignments,
    [{ playerId: 1, fromSlotId: 'bench-1', toSlotId: 'pg-2' }]);
});
test('starter to bench and starter to starter swaps work when both players qualify', () => {
  assert.equal(validateMove(roster(), { ...move, playerId: 2, destinationSlotId: 'bench-1' }, now).assignments.length, 2);
  const snapshot = roster();
  snapshot.players[1].eligibleSlotIds.push(4);
  snapshot.players[2].eligibleSlotIds.push(0);
  assert.equal(validateMove(snapshot, { ...move, playerId: 2, destinationSlotId: 'c-1' }, now).assignments.length, 2);
});
test('both sides must qualify, including reverse side of an occupied swap', () => {
  assert.throws(() => validateMove(roster(), { ...move, destinationSlotId: 'c-1' }, now), /eligible/);
  const snapshot = roster();
  snapshot.players[1].eligibleSlotIds = [0];
  assert.throws(() => validateMove(snapshot, move, now), /Two is not eligible/);
});
test('daily and weekly modes require authoritative period locks', () => {
  for (const lockMode of ['daily', 'weekly'] as const) {
    const snapshot = roster();
    snapshot.lockMode = lockMode;
    snapshot.players.forEach(player => { player.lockAt = null; });
    assert.throws(() => validateMove(snapshot, move, now), /period lock/);
    snapshot.periodLockAt = later;
    assert.equal(validateMove(snapshot, move, now).assignments.length, 2);
    snapshot.periodLockAt = now.toISOString();
    assert.throws(() => validateMove(snapshot, move, now), /cutoff/);
  }
});
test('all affected players respect the exact ten minute boundary', () => {
  for (const index of [0, 1]) {
    const snapshot = roster();
    snapshot.players[index].lockAt = '2026-10-24T20:10:00Z';
    assert.throws(() => validateMove(snapshot, move, now), /cutoff/);
    snapshot.players[index].lockAt = '2026-10-24T20:10:00.001Z';
    assert.doesNotThrow(() => validateMove(snapshot, move, now));
    snapshot.players[index].lockAt = '2026-10-24T19:59:00Z';
    assert.throws(() => validateMove(snapshot, move, now), /cutoff/);
  }
});
test('custom cutoff applies and invalid cutoffs fail closed', () => {
  const snapshot = roster();
  snapshot.players[0].lockAt = '2026-10-24T20:15:00Z';
  assert.throws(() => validateMove(snapshot, move, now, 20), /cutoff/);
  assert.doesNotThrow(() => validateMove(snapshot, move, now, 5));
  for (const cutoff of [-1, NaN, Infinity]) assert.throws(() => validateMove(snapshot, move, now, cutoff), /cutoff/);
});
test('unknown, malformed and explicit locked player data fail closed', () => {
  for (const index of [0, 1]) {
    const snapshot = roster();
    snapshot.players[index].locked = true;
    assert.throws(() => validateMove(snapshot, move, now), /locked/);
    snapshot.players[index].locked = false;
    snapshot.players[index].lockAt = null;
    assert.throws(() => validateMove(snapshot, move, now), /player lock/);
    snapshot.players[index].lockAt = '2026-10-24T21:00:00';
    assert.throws(() => validateMove(snapshot, move, now), /Reliable/);
  }
});
test('period and player locks both apply when supplied', () => {
  const snapshot = roster();
  snapshot.lockMode = 'weekly';
  snapshot.periodLockAt = later;
  snapshot.players[0].lockAt = '2026-10-24T20:09:00Z';
  assert.throws(() => validateMove(snapshot, move, now), /cutoff/);
});
test('timezone offsets identify the same lock instant', () => {
  const snapshot = roster();
  snapshot.players[0].lockAt = '2026-10-24T13:10:00-07:00';
  assert.throws(() => validateMove(snapshot, move, now), /cutoff/);
  snapshot.players[0].lockAt = '2026-10-24T14:00:00-07:00';
  assert.doesNotThrow(() => validateMove(snapshot, move, now));
});
test('invalid calendar dates and local wall clocks cannot supply locks', () => {
  for (const time of ['2026-02-30T21:00:00Z', '2026-10-24T24:00:00Z', '2026-10-24T21:00:00',
    '2026-13-24T21:00:00Z', '2026-10-24T21:00:00+25:00']) {
    const snapshot = roster();
    snapshot.players[0].lockAt = time;
    assert.throws(() => validateMove(snapshot, move, now), /Reliable/);
  }
});
test('stale revisions, old snapshots and excessive future clock skew are rejected', () => {
  assert.throws(() => validateMove(roster(), { ...move, revision: 'old' }, now), /changed/);
  for (const age of [30_001, -5_001]) {
    const snapshot = roster();
    snapshot.fetchedAt = new Date(now.getTime() - age).toISOString();
    assert.throws(() => validateMove(snapshot, move, now), /stale/);
  }
  for (const age of [30_000, -5_000]) {
    const snapshot = roster();
    snapshot.fetchedAt = new Date(now.getTime() - age).toISOString();
    assert.doesNotThrow(() => validateMove(snapshot, move, now));
  }
});
test('moves cannot add players, target other teams or use an absent slot', () => {
  assert.throws(() => validateMove(roster(), { ...move, playerId: 999 }, now), /not on this team/);
  assert.throws(() => validateMove(roster(), { ...move, destinationSlotId: 'other-team' }, now), /not on this team/);
  assert.throws(() => validateMove(roster(), { ...move, destinationSlotId: 'bench-1' }, now), /different/);
});
test('malformed and duplicate roster identities or assignments are rejected', () => {
  const changes: Array<(snapshot: LineupSnapshot) => void> = [
    s => { s.slots.push({ ...s.slots[0] }); },
    s => { s.players.push({ ...s.players[0] }); },
    s => { s.slots[1].playerId = 1; },
    s => { s.slots[1].playerId = 999; },
    s => { s.slots[2].playerId = null; },
    s => { s.teamId = NaN; },
    s => { s.scoringPeriodId = -1; },
    s => { s.fetchedAt = 'yesterday'; },
    s => { s.players[0].eligibleSlotIds = []; },
    s => { s.slots[0].eligibilityId = NaN; },
    s => { s.lockMode = 'unknown' as LineupSnapshot['lockMode']; },
  ];
  for (const change of changes) {
    const snapshot = roster();
    change(snapshot);
    assert.throws(() => validateMove(snapshot, move, now));
  }
});
