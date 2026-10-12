import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardCell, DraftPickState } from '../src/lib/keeper/types.js';
import {
  CALLED_CLOCK_SECONDS,
  CLOCK_COOLDOWN_PICKS,
  callClock,
  canCallClock,
  draftTimingStats,
  elapsedMs,
  formatClock,
  lastClockCallBy,
  pauseClock,
  pickTiming,
  remainingMs,
  resumeClock,
  startPickClock,
} from '../src/lib/league/draftClock.js';

const T0 = '2026-10-18T21:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const onClock = (overall: number, owner: string, round = 2) => ({ pick: { overall, currentOwner: owner, round } }) as unknown as Pick<BoardCell, 'pick'>;

test('the pick timer counts from the start and leaves paused time out', () => {
  const clock = startPickClock(T0);
  assert.equal(elapsedMs(clock, at(10)), 10_000);
  const paused = pauseClock(clock, at(10));
  assert.equal(elapsedMs(paused, at(40)), 10_000, 'frozen while paused');
  const resumed = resumeClock(paused, at(40));
  assert.equal(resumed.pausedMs, 30_000);
  assert.equal(elapsedMs(resumed, at(55)), 25_000);
  assert.equal(pauseClock(paused, at(41)), paused, 'pausing twice changes nothing');
  assert.equal(resumeClock(resumed, at(60)), resumed, 'resuming twice changes nothing');
  assert.equal(elapsedMs(null, at(5)), 0);
});

test('a pause carries over to the next pick', () => {
  const next = startPickClock(at(100), true);
  assert.equal(next.pausedAt, at(100));
  assert.equal(elapsedMs(next, at(130)), 0);
});

test('CLOCK gives 30 seconds from the call, and a pause stops that too', () => {
  const clock = callClock(startPickClock(T0), 'Kyle', at(45));
  assert.equal(remainingMs(startPickClock(T0), at(45)), null);
  assert.equal(remainingMs(clock, at(45)), CALLED_CLOCK_SECONDS * 1000);
  assert.equal(remainingMs(clock, at(65)), 10_000);
  assert.equal(remainingMs(clock, at(90)), 0, 'never below zero');
  const paused = pauseClock(clock, at(50));
  assert.equal(remainingMs(paused, at(70)), 25_000);
  assert.equal(remainingMs(resumeClock(paused, at(70)), at(80)), 15_000);
});

test('nobody may call CLOCK before the team has had its time: two minutes early, ninety seconds late', () => {
  const clock = startPickClock(T0);
  const base = { clock, picks: {}, caller: 'Kyle', isCommissioner: true };
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(3, 'Joel', 1), now: at(1) }), { ok: false, reason: 'too-early', secondsToWait: 119 });
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(3, 'Joel', 1), now: at(119.5) }), { ok: false, reason: 'too-early', secondsToWait: 1 });
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(3, 'Joel', 1), now: at(120) }), { ok: true });
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(43, 'Joel', 5), now: at(100) }), { ok: false, reason: 'too-early', secondsToWait: 20 });
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(53, 'Joel', 6), now: at(90) }), { ok: true });
  assert.deepEqual(canCallClock({ ...base, onClock: onClock(53, 'Joel', 6), now: at(89) }), { ok: false, reason: 'too-early', secondsToWait: 1 });
  // A pause stops the wait too.
  const resumed = resumeClock(pauseClock(clock, at(30)), at(90));
  assert.deepEqual(canCallClock({ ...base, clock: resumed, onClock: onClock(53, 'Joel', 6), now: at(149) }), { ok: false, reason: 'too-early', secondsToWait: 1 });
  assert.deepEqual(canCallClock({ ...base, clock: resumed, onClock: onClock(53, 'Joel', 6), now: at(150) }), { ok: true });
});

test('who may call CLOCK: not yourself, not twice, not while paused, and members wait five picks', () => {
  const clock = startPickClock(T0);
  const picks: Record<string, DraftPickState> = {};
  const base = { clock, picks, onClock: onClock(12, 'Joel'), isCommissioner: false, now: at(200) };
  assert.deepEqual(canCallClock({ ...base, caller: 'Kyle' }), { ok: true });
  assert.deepEqual(canCallClock({ ...base, caller: 'Joel' }), { ok: false, reason: 'own-pick' });
  assert.deepEqual(canCallClock({ ...base, caller: 'Brey', isCommissioner: true, onClock: onClock(12, 'Brey') }), { ok: false, reason: 'own-pick' });
  assert.deepEqual(canCallClock({ ...base, caller: 'Kyle', clock: callClock(clock, 'Ryan', at(5)) }), { ok: false, reason: 'already-called' });
  assert.deepEqual(canCallClock({ ...base, caller: 'Kyle', clock: pauseClock(clock, at(5)) }), { ok: false, reason: 'paused' });
  assert.deepEqual(canCallClock({ ...base, caller: 'Kyle', onClock: null }), { ok: false, reason: 'complete' });
  assert.deepEqual(canCallClock({ ...base, caller: 'Kyle', clock: null }), { ok: false, reason: 'not-started' });

  // Kyle called it on pick 10; at pick 12 he has three picks to wait, at 15 he is free.
  const called: Record<string, DraftPickState> = { '10': { playerKey: 'x', clockCalledBy: 'Kyle' }, '11': { playerKey: 'y' } };
  assert.equal(lastClockCallBy(called, 'Kyle'), 10);
  assert.equal(lastClockCallBy(called, 'Ryan'), null);
  assert.deepEqual(canCallClock({ ...base, picks: called, caller: 'Kyle' }), { ok: false, reason: 'cooldown', picksToWait: 3 });
  assert.deepEqual(canCallClock({ ...base, picks: called, caller: 'Kyle', onClock: onClock(10 + CLOCK_COOLDOWN_PICKS, 'Joel') }), { ok: true });
  assert.deepEqual(canCallClock({ ...base, picks: called, caller: 'Kyle', isCommissioner: true }), { ok: true }, 'the commish has no cooldown');
});

test('a pick keeps how long it took and who called CLOCK', () => {
  const clock = callClock(pauseClock(startPickClock(T0), at(10)), 'Amy', at(10));
  const resumed = resumeClock(clock, at(30));
  assert.deepEqual(pickTiming(resumed, at(50)), { seconds: 30, clockCalledBy: 'Amy' });
  assert.deepEqual(pickTiming(startPickClock(T0), at(7.4)), { seconds: 7, clockCalledBy: null });
  assert.deepEqual(pickTiming(null, at(7)), {});
});

test('formatClock prints m:ss', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9_900), '0:09');
  assert.equal(formatClock(125_000), '2:05');
  assert.equal(formatClock(-5), '0:00');
});

function cell(overall: number, owner: string, selection: DraftPickState | null, keeper = false): BoardCell {
  return {
    pick: { overall, currentOwner: owner, originalOwner: owner, round: 1, slot: overall },
    selection,
    keeper: keeper ? ({} as BoardCell['keeper']) : null,
    onClock: false,
  } as unknown as BoardCell;
}

test('timing stats: fastest, slowest, longest pick, most clocked, most calls', () => {
  const board = [
    cell(1, 'Joel', { playerKey: 'a', playerName: 'A', seconds: 20 }),
    cell(2, 'Ryan', { playerKey: 'b', playerName: 'B', seconds: 95, clockCalledBy: 'Kyle' }),
    cell(3, 'Kyle', { playerKey: 'c', playerName: 'C', seconds: 5 }),
    cell(4, 'Brey', { playerKey: 'k', playerName: 'Keeper', isKeeper: true, seconds: 999 }),
    cell(5, 'Ryan', { playerKey: 'd', playerName: 'D', seconds: 125, clockCalledBy: 'Kyle' }),
    cell(6, 'Joel', { playerKey: 'e', playerName: 'E', seconds: 40, clockCalledBy: 'Ryan' }),
    cell(7, 'Amy', null),
    cell(8, 'Amy', { playerKey: 'f', playerName: 'F' }),
  ];
  const stats = draftTimingStats(board, ['Joel', 'Ryan', 'Kyle', 'Brey', 'Amy']);
  assert.equal(stats.timedPicks, 5);
  assert.equal(stats.fastest?.owner, 'Kyle');
  assert.equal(stats.slowest?.owner, 'Ryan');
  assert.equal(stats.slowest?.averageSeconds, 110);
  assert.deepEqual(stats.longestPick, { owner: 'Ryan', overall: 5, seconds: 125, playerName: 'D' });
  assert.equal(stats.mostClocked?.owner, 'Ryan');
  assert.equal(stats.mostClocked?.clocked, 2);
  assert.equal(stats.mostCalls?.owner, 'Kyle');
  assert.equal(stats.mostCalls?.calls, 2);
  const brey = stats.owners.find((row) => row.owner === 'Brey');
  assert.equal(brey?.picks, 0, 'a keeper is not a timed pick');
  assert.equal(brey?.averageSeconds, null);
  const amy = stats.owners.find((row) => row.owner === 'Amy');
  assert.equal(amy?.picks, 0, 'an untimed pick is skipped');
});

test('timing stats with no picks shows nothing', () => {
  const stats = draftTimingStats([cell(1, 'Joel', null)], ['Joel']);
  assert.equal(stats.timedPicks, 0);
  assert.equal(stats.fastest, null);
  assert.equal(stats.mostClocked, null);
  assert.equal(stats.longestPick, null);
});
