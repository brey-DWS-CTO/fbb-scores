import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACHIEVEMENTS,
  NO_FACTS,
  canReveal,
  coversAllProps,
  earnedCount,
  earnedFrom,
  firstGuessToRecord,
  guessHit,
  guessNear,
  hiddenCount,
  hiddenKeepers,
  ledgerOf,
  pickReveal,
  revealsLeft,
  revealsReady,
  stampEarned,
  standings,
  type OwnerFacts,
} from '../src/lib/league/achievements.ts';

const OWNERS = ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy'];

const earns = (facts: Partial<OwnerFacts>) => earnedFrom({ ...NO_FACTS, ...facts });

test('more achievements than the eighteen keepers nine teams can hold', () => {
  assert.ok(ACHIEVEMENTS.length > 18);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('nothing done earns nothing', () => {
  assert.deepEqual(earnedFrom(NO_FACTS), []);
});

test('rule book, trades, votes, dues', () => {
  assert.deepEqual(earns({ signedRulebook: true }), ['signed']);
  assert.deepEqual(earns({ signedRulebook: true, drewSignature: true }), ['signed', 'hancock']);
  assert.deepEqual(earns({ tradesOffered: 1 }), ['trade-offer']);
  assert.deepEqual(earns({ offersRevised: 1 }), ['haggler']);
  assert.deepEqual(earns({ offersClosed: 1 }), ['closer']);
  assert.deepEqual(earns({ offersTaken: 1 }), ['taker']);
  assert.deepEqual(earns({ votesCast: 1 }), ['voted']);
  assert.deepEqual(earns({ pollsOpened: 1 }), ['lawmaker']);
  assert.deepEqual(earns({ duesPaid: true }), ['dues']);
});

test('mock counts climb through three tiers', () => {
  assert.deepEqual(earns({ mocksFinished: 1 }), ['first-mock']);
  assert.deepEqual(earns({ mocksFinished: 9 }), ['first-mock']);
  assert.deepEqual(earns({ mocksFinished: 10 }), ['first-mock', 'ten-mocks']);
  assert.deepEqual(earns({ mocksFinished: 25 }), ['first-mock', 'ten-mocks', 'marathon']);
});

test('grades: any A for the honor roll, A+ for valedictorian', () => {
  assert.deepEqual(earns({ bestMockGrade: 'A-' }), ['honor-roll']);
  assert.deepEqual(earns({ bestMockGrade: 'A+' }), ['honor-roll', 'valedictorian']);
  assert.deepEqual(earns({ bestMockGrade: 'B+' }), []);
});

test('a steal of 15 picks makes a thief; 14 does not', () => {
  assert.deepEqual(earns({ bestSteal: 15 }), ['thief']);
  assert.deepEqual(earns({ bestSteal: 14 }), []);
});

test('a mock with a trade switched on', () => {
  assert.deepEqual(earns({ mockedWithTrade: true }), ['what-if']);
});

test('prop tiers', () => {
  assert.deepEqual(earns({ propBetsSet: 1 }), ['prop-bet']);
  assert.deepEqual(earns({ propBetsSet: 5 }), ['prop-bet', 'bookmaker']);
  assert.deepEqual(earns({ propSidesTaken: 5 }), ['action']);
  assert.deepEqual(earns({ allPropsCovered: true }), ['all-in']);
});

test('ALL IN needs a side on every prop, and enough props to mean it', () => {
  assert.equal(coversAllProps(3, 3), true);
  assert.equal(coversAllProps(4, 3), false);
  assert.equal(coversAllProps(2, 2), false, 'two props is too easy');
});

test('keeper guesses', () => {
  assert.deepEqual(earns({ scoutHits: 1, closeCalls: 1 }), ['scout', 'close-call']);
  assert.deepEqual(earns({ closeCalls: 1 }), ['close-call']);
});

test('earned is for good: stamping keeps the first date and skips repeats', () => {
  const first = stampEarned(undefined, ['signed'], 't1');
  assert.deepEqual(first, { signed: 't1' });
  assert.equal(stampEarned(first!, ['signed'], 't2'), null, 'nothing new means no write');
  const next = stampEarned(first!, ['signed', 'voted'], 't3');
  assert.deepEqual(next, { signed: 't1', voted: 't3' });
  assert.equal(stampEarned(next!, [], 't4'), null);
  assert.equal(earnedCount(next!), 2);
  assert.equal(earnedCount({ 'trade-done': 'old' } as never), 0, 'retired ids do not count');
});

test('whole-team reveals from the first cut are dropped, so the reveal comes back', () => {
  const ledger = ledgerOf({
    reveals: { Joel: [{ target: 'Amy', at: 'x' } as never, { target: 'Kyle', playerKey: 'p1', at: 'y' }] },
  });
  assert.deepEqual(ledger.reveals.Joel, [{ target: 'Kyle', playerKey: 'p1', at: 'y' }]);
});

test('one reveal per achievement, never negative', () => {
  assert.equal(revealsLeft(3, 1), 2);
  assert.equal(revealsLeft(1, 3), 0);
});

test('hidden keepers skip yourself, keepers already seen, and teams with none', () => {
  const keepers = {
    Joel: [{ playerKey: 'j1' }, { playerKey: 'j2' }],
    Ryan: [{ playerKey: 'r1' }],
    Amy: [{ playerKey: 'a1' }],
    Kyle: [],
  };
  const teams = hiddenKeepers('Ryan', OWNERS, keepers, [{ target: 'Joel', playerKey: 'j1', at: 'x' }]);
  assert.deepEqual(teams, [
    { target: 'Joel', playerKeys: ['j2'] },
    { target: 'Amy', playerKeys: ['a1'] },
  ]);
  assert.equal(hiddenCount(teams), 2);
});

test('the pick takes a random team, then a random keeper on it', () => {
  const teams = [
    { target: 'Joel', playerKeys: ['j1', 'j2'] },
    { target: 'Amy', playerKeys: ['a1'] },
  ];
  assert.deepEqual(pickReveal(teams, () => 0), { target: 'Joel', playerKey: 'j1' });
  assert.deepEqual(pickReveal(teams, () => 0.75), { target: 'Amy', playerKey: 'a1' });
  // A team keeping two has the same odds as a team keeping one.
  let calls = 0;
  assert.deepEqual(pickReveal(teams, () => (calls++ === 0 ? 0.2 : 0.9)), { target: 'Joel', playerKey: 'j2' });
  assert.deepEqual(pickReveal(teams, () => 1), { target: 'Amy', playerKey: 'a1' }, 'a 1 stays in range');
  assert.equal(pickReveal([], () => 0.3), null);
});

test('reveal checks say why not', () => {
  const base = { keepersPublic: false, isCommissioner: false, left: 1, hidden: 3 };
  assert.equal(canReveal(base).ok, true);
  assert.equal(canReveal({ ...base, keepersPublic: true }).reason, 'public');
  assert.equal(canReveal({ ...base, isCommissioner: true }).reason, 'commish');
  assert.equal(canReveal({ ...base, left: 0 }).reason, 'none-left');
  assert.equal(canReveal({ ...base, hidden: 0 }).reason, 'nobody-ready');
});

test('the badge counts only reveals you could spend now', () => {
  assert.equal(revealsReady(3, 1), 1);
  assert.equal(revealsReady(2, 5), 2);
});

test('standings put the most achievements first and keep league order on ties', () => {
  const ledger = ledgerOf({
    earned: { Ryan: { signed: 'a' }, Amy: { signed: 'a', voted: 'b' }, Joel: { signed: 'a' } },
    reveals: { Amy: [{ target: 'Joel', playerKey: 'j1', at: 'c' }] },
  });
  const rows = standings(['Joel', 'Ryan', 'Amy', 'Kyle'], ledger);
  assert.deepEqual(rows, [
    { owner: 'Amy', earned: 2, revealed: 1 },
    { owner: 'Joel', earned: 1, revealed: 0 },
    { owner: 'Ryan', earned: 1, revealed: 0 },
    { owner: 'Kyle', earned: 0, revealed: 0 },
  ]);
});

test('the first saved guess sticks; later edits never replace it', () => {
  assert.deepEqual(firstGuessToRecord(undefined, [], ['a'], 't1'), { keys: ['a'], at: 't1' });
  assert.equal(firstGuessToRecord({ keys: ['a'], at: 't1' }, ['a'], ['b'], 't2'), null);
  assert.deepEqual(firstGuessToRecord(undefined, ['old'], ['new'], 't3'), { keys: ['old'], at: 't3' });
  assert.equal(firstGuessToRecord(undefined, [], [], 't4'), null, 'an empty save is not a guess');
});

test('SCOUT needs the exact keepers; CLOSE CALL needs one', () => {
  const guess = { keys: ['jokic', 'hali'], at: '2026-10-10' };
  assert.equal(guessHit(guess, ['hali', 'jokic'], null), true);
  assert.equal(guessHit(guess, ['jokic'], null), false, 'one too many');
  assert.equal(guessNear(guess, ['jokic'], null), true);
  assert.equal(guessHit(guess, ['jokic', 'curry'], null), false);
  assert.equal(guessNear(guess, ['jokic', 'curry'], null), true);
  assert.equal(guessNear(guess, ['curry'], null), false);
  assert.equal(guessHit(guess, [], null), false, 'no keepers in yet');
  assert.equal(guessHit(undefined, ['jokic'], null), false);
  assert.equal(guessHit(guess, ['hali', 'jokic'], '2026-10-11'), true, 'revealed after guessing');
  assert.equal(guessHit(guess, ['hali', 'jokic'], '2026-10-09'), false, 'revealed before guessing');
  assert.equal(guessNear(guess, ['jokic'], '2026-10-09'), false);
});
