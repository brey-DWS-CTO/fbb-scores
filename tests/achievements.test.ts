import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACHIEVEMENTS,
  NO_FACTS,
  bestGrade,
  canReveal,
  earnedCount,
  earnedFrom,
  ledgerOf,
  mocksFinished,
  nextMockCount,
  pickRevealTarget,
  revealCandidates,
  revealsLeft,
  stampEarned,
  standings,
} from '../src/lib/league/achievements.ts';

const OWNERS = ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy'];

test('there are more achievements than other teams, so nobody needs them all', () => {
  assert.ok(ACHIEVEMENTS.length > OWNERS.length - 1);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('nothing done earns nothing', () => {
  assert.deepEqual(earnedFrom(NO_FACTS), []);
});

test('each fact earns its own achievement', () => {
  assert.deepEqual(earnedFrom({ ...NO_FACTS, signedRulebook: true }), ['signed']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, mocksFinished: 1 }), ['first-mock']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, mocksFinished: 10 }), ['first-mock', 'ten-mocks']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, mocksFinished: 9 }), ['first-mock']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, tradesOffered: 1 }), ['trade-offer']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, tradesDone: 1 }), ['trade-done']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, propBetsSet: 2 }), ['prop-bet']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, votesCast: 1 }), ['voted']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, keeperGuesses: 3 }), ['scout']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, duesPaid: true }), ['dues']);
});

test('any A grade makes the honor roll; a B does not', () => {
  assert.deepEqual(earnedFrom({ ...NO_FACTS, bestMockGrade: 'A-' }), ['honor-roll']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, bestMockGrade: 'A+' }), ['honor-roll']);
  assert.deepEqual(earnedFrom({ ...NO_FACTS, bestMockGrade: 'B+' }), []);
});

test('best grade picks the top one and skips junk', () => {
  assert.equal(bestGrade(['B', 'A-', 'C']), 'A-');
  assert.equal(bestGrade(['A', 'A+']), 'A+');
  assert.equal(bestGrade(['?', 'F']), 'F');
  assert.equal(bestGrade([]), null);
});

test('the mock count never drops below the saved rows', () => {
  // Before this shipped, only the rows tell us anything.
  assert.equal(mocksFinished(undefined, 7), 7);
  // A member who deleted some keeps the running count.
  assert.equal(mocksFinished(12, 3), 12);
  assert.equal(nextMockCount(undefined, 10), 11, 'ten kept rows plus the new one');
  assert.equal(nextMockCount(4, 2), 5);
});

test('earned is for good: stamping keeps the first date and skips repeats', () => {
  const first = stampEarned(undefined, ['signed'], 't1');
  assert.deepEqual(first, { signed: 't1' });
  assert.equal(stampEarned(first!, ['signed'], 't2'), null, 'nothing new means no write');
  const next = stampEarned(first!, ['signed', 'voted'], 't3');
  assert.deepEqual(next, { signed: 't1', voted: 't3' });
  // A fact that stops being true (a deleted mock) does not unstamp it.
  assert.equal(stampEarned(next!, [], 't4'), null);
  assert.equal(earnedCount(next!), 2);
});

test('reveals left: one per achievement, never more than the other teams', () => {
  assert.equal(revealsLeft(3, 1, 9), 2);
  assert.equal(revealsLeft(10, 0, 9), 9);
  assert.equal(revealsLeft(10, 9, 9), 0);
  assert.equal(revealsLeft(1, 3, 9), 0, 'never negative');
});

test('candidates skip yourself, teams already seen, and teams with no keepers', () => {
  const counts = { Joel: 2, Ryan: 1, Patrick: 0, Amy: 2 };
  const got = revealCandidates('Joel', OWNERS, counts, [{ target: 'Amy', at: 'x' }]);
  assert.deepEqual(got, ['Ryan']);
});

test('the random pick spreads over every candidate', () => {
  const c = ['Ryan', 'Amy', 'Kyle'];
  assert.equal(pickRevealTarget(c, () => 0), 'Ryan');
  assert.equal(pickRevealTarget(c, () => 0.5), 'Amy');
  assert.equal(pickRevealTarget(c, () => 0.9999), 'Kyle');
  assert.equal(pickRevealTarget(c, () => 1), 'Kyle', 'a 1 from a bad source stays in range');
  assert.equal(pickRevealTarget([], () => 0.3), null);
});

test('reveal checks say why not', () => {
  const base = { keepersPublic: false, isCommissioner: false, left: 1, candidates: 3 };
  assert.equal(canReveal(base).ok, true);
  assert.equal(canReveal({ ...base, keepersPublic: true }).reason, 'public');
  assert.equal(canReveal({ ...base, isCommissioner: true }).reason, 'commish');
  assert.equal(canReveal({ ...base, left: 0 }).reason, 'none-left');
  assert.equal(canReveal({ ...base, candidates: 0 }).reason, 'nobody-ready');
});

test('standings put the most achievements first and keep league order on ties', () => {
  const ledger = ledgerOf({
    earned: { Ryan: { signed: 'a' }, Amy: { signed: 'a', voted: 'b' }, Joel: { signed: 'a' } },
    reveals: { Amy: [{ target: 'Joel', at: 'c' }] },
  });
  const rows = standings(['Joel', 'Ryan', 'Amy', 'Kyle'], ledger);
  assert.deepEqual(rows, [
    { owner: 'Amy', earned: 2, revealed: 1 },
    { owner: 'Joel', earned: 1, revealed: 0 },
    { owner: 'Ryan', earned: 1, revealed: 0 },
    { owner: 'Kyle', earned: 0, revealed: 0 },
  ]);
});
