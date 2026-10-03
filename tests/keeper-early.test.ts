import assert from 'node:assert/strict';
import test from 'node:test';
import { earlyKeeperNote } from '../src/lib/league/keeperEarly.ts';

test('a keeper in his own round gets no note', () => {
  assert.equal(earlyKeeperNote({ bumped: false, bumpReason: null, round: 3 }, '3.1'), null);
});

test('a traded-away round says so', () => {
  assert.equal(
    earlyKeeperNote({ bumped: true, bumpReason: 'traded', round: 3 }, '2.10'),
    'Kept early: his round is 3, but the team has no round 3 pick, so he uses 2.10.',
  );
});

test('a shared round says so', () => {
  assert.match(earlyKeeperNote({ bumped: true, bumpReason: 'duplicate', round: 5 }, '4.6') ?? '', /another keeper already uses that round, so he uses 4\.6/);
});
