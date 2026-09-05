import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRequestLink,
  emailTakenBy,
  isExpired,
  isValidEmail,
  linkExpiresAt,
  normalizeEmail,
  ownerForEmail,
  sessionExpiresAt,
  LINK_TTL_MINUTES,
  LINK_WINDOW_MINUTES,
  MAX_LINKS_PER_WINDOW,
  SESSION_TTL_DAYS,
  type OwnerEmail,
} from '../src/lib/league/auth.js';

const at = (iso: string) => new Date(iso);

// ─── Addresses ─────────────────────────────────────────────────────────────

test('an address is trimmed and lower-cased before anything looks at it', () => {
  assert.equal(normalizeEmail('  Brey@DoWhatSolutions.COM '), 'brey@dowhatsolutions.com');
  assert.equal(normalizeEmail('ryan@example.com'), 'ryan@example.com');
  assert.equal(normalizeEmail('   '), '');
});

test('dots and plus tags survive, because they can be real', () => {
  // Gmail treats these as the same mailbox, but other hosts do not, and two
  // members can hold first.last@ and firstlast@ at the same company.
  assert.equal(normalizeEmail('First.Last@example.com'), 'first.last@example.com');
  assert.equal(normalizeEmail('brey+fbb@gmail.com'), 'brey+fbb@gmail.com');
});

test('an address that could carry mail is accepted', () => {
  assert.equal(isValidEmail('brey@dowhatsolutions.com'), true);
  assert.equal(isValidEmail('  BREY@DoWhat.com  '), true, 'trimmed and lowered first');
  assert.equal(isValidEmail('brey+fbb@gmail.com'), true);
  assert.equal(isValidEmail('first.last@mail.sub.example.org'), true);
});

test('an address that cannot is refused', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('   '), false);
  assert.equal(isValidEmail('brey'), false);
  assert.equal(isValidEmail('brey@'), false);
  assert.equal(isValidEmail('@gmail.com'), false);
  assert.equal(isValidEmail('brey@gmail'), false, 'no dot in the domain');
  assert.equal(isValidEmail('brey@.com'), false);
  assert.equal(isValidEmail('brey@gmail.com.'), false);
  assert.equal(isValidEmail('brey@gmail..com'), false);
  assert.equal(isValidEmail('brey two@gmail.com'), false, 'no spaces');
  assert.equal(isValidEmail('brey@@gmail.com'), false, 'one @ only');
});

// ─── Expiry ────────────────────────────────────────────────────────────────

const issued = at('2026-09-05T10:00:00.000Z');

test('a link lasts fifteen minutes and a session thirty days', () => {
  assert.equal(LINK_TTL_MINUTES, 15);
  assert.equal(SESSION_TTL_DAYS, 30);
  assert.equal(linkExpiresAt(issued), '2026-09-05T10:15:00.000Z');
  assert.equal(sessionExpiresAt(issued), '2026-10-05T10:00:00.000Z');
});

test('the deadline itself counts as expired', () => {
  const ends = linkExpiresAt(issued);
  assert.equal(isExpired(ends, at('2026-09-05T10:14:59.000Z')), false, 'one second short');
  assert.equal(isExpired(ends, at('2026-09-05T10:15:00.000Z')), true, 'exactly at the limit');
  assert.equal(isExpired(ends, at('2026-09-05T10:15:01.000Z')), true, 'one second past');
});

test('a session runs to the same rule, a month out', () => {
  const ends = sessionExpiresAt(issued);
  assert.equal(isExpired(ends, at('2026-10-05T09:59:59.000Z')), false);
  assert.equal(isExpired(ends, at('2026-10-05T10:00:00.000Z')), true);
  assert.equal(isExpired(ends, at('2026-10-05T10:00:01.000Z')), true);
});

test('a time nobody can read is treated as expired', () => {
  // A broken row must never hand out a session.
  assert.equal(isExpired('', issued), true);
  assert.equal(isExpired('whenever', issued), true);
});

// ─── Asking for a link ─────────────────────────────────────────────────────

const now = at('2026-09-05T10:11:00.000Z');

test('three links in the window is the cap', () => {
  assert.equal(MAX_LINKS_PER_WINDOW, 3);
  assert.equal(LINK_WINDOW_MINUTES, 15);
});

test('a member may ask again while fewer than three links stand', () => {
  assert.equal(canRequestLink([], now).ok, true);
  assert.equal(canRequestLink(['2026-09-05T10:10:00.000Z'], now).ok, true);
  const two = canRequestLink(['2026-09-05T10:05:00.000Z', '2026-09-05T10:10:00.000Z'], now);
  assert.equal(two.ok, true);
  assert.equal(two.reason, undefined);
  assert.equal(two.retryAfterSeconds, undefined);
});

test('the fourth ask inside the window is refused', () => {
  const three = [
    '2026-09-05T10:00:00.000Z',
    '2026-09-05T10:05:00.000Z',
    '2026-09-05T10:10:00.000Z',
  ];
  const decision = canRequestLink(three, now);
  assert.equal(decision.ok, false);
  // The 10:00 link ages out at 10:15, which is four minutes off.
  assert.equal(decision.retryAfterSeconds, 240);
  assert.equal(decision.reason, 'Too many sign-in links. Try again in 4 minutes.');
});

test('the order the links arrive in does not matter', () => {
  const shuffled = [
    '2026-09-05T10:10:00.000Z',
    '2026-09-05T10:00:00.000Z',
    '2026-09-05T10:05:00.000Z',
  ];
  assert.equal(canRequestLink(shuffled, now).retryAfterSeconds, 240);
});

test('a link that has aged out frees the slot back up', () => {
  const three = [
    '2026-09-05T10:00:00.000Z',
    '2026-09-05T10:05:00.000Z',
    '2026-09-05T10:10:00.000Z',
  ];
  // At 10:16 the first one is sixteen minutes old, so only two are left.
  assert.equal(canRequestLink(three, at('2026-09-05T10:16:00.000Z')).ok, true);
  // Fifteen minutes to the second is already out, the same as an expiry.
  const together = ['2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z'];
  assert.equal(canRequestLink(together, at('2026-09-05T10:15:00.000Z')).ok, true);
});

test('the wait counts to the second the oldest link falls out', () => {
  const together = ['2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z'];
  const close = canRequestLink(together, at('2026-09-05T10:14:59.000Z'));
  assert.equal(close.retryAfterSeconds, 1);
  assert.equal(close.reason, 'Too many sign-in links. Try again in 1 minute.', 'one minute, not 1 minutes');

  // Part of a second still costs a whole second, and part of a minute still
  // costs a whole minute, so nobody is sent back a moment too early.
  const three = [
    '2026-09-05T10:00:00.000Z',
    '2026-09-05T10:05:00.000Z',
    '2026-09-05T10:10:00.000Z',
  ];
  const rough = canRequestLink(three, at('2026-09-05T10:11:30.500Z'));
  assert.equal(rough.retryAfterSeconds, 210, '209.5 seconds rounds up');
  assert.equal(rough.reason, 'Too many sign-in links. Try again in 4 minutes.', '3.5 minutes rounds up');
});

test('junk timestamps are skipped, not thrown', () => {
  const messy = ['', 'not a date', '2026-09-05T10:10:00.000Z'];
  assert.equal(canRequestLink(messy, now).ok, true, 'one good link is not three');
  const full = [
    'nonsense',
    '2026-09-05T10:00:00.000Z',
    '2026-09-05T10:05:00.000Z',
    '2026-09-05T10:10:00.000Z',
  ];
  assert.equal(canRequestLink(full, now).ok, false, 'the three real ones still count');
});

// ─── Who owns an address ───────────────────────────────────────────────────

const ROLL: OwnerEmail[] = [
  { owner: 'Ryan', email: 'ryan@example.com' },
  { owner: 'Brey', email: 'Brey@DoWhatSolutions.com' },
  { owner: 'Amy', email: '' },
];

test('an address finds its owner however it is typed', () => {
  assert.equal(ownerForEmail(ROLL, 'ryan@example.com'), 'Ryan');
  assert.equal(ownerForEmail(ROLL, 'RYAN@EXAMPLE.COM'), 'Ryan');
  assert.equal(ownerForEmail(ROLL, '  Ryan@Example.com  '), 'Ryan');
  assert.equal(ownerForEmail(ROLL, 'brey@dowhatsolutions.com'), 'Brey', 'the stored one had capitals');
});

test('an address nobody has saved belongs to nobody', () => {
  assert.equal(ownerForEmail(ROLL, 'stranger@example.com'), null);
  assert.equal(ownerForEmail([], 'ryan@example.com'), null);
  assert.equal(ownerForEmail(ROLL, ''), null, 'an empty address must not match Amy');
  assert.equal(ownerForEmail(ROLL, '   '), null);
});

test('an address held by someone else is refused', () => {
  assert.equal(emailTakenBy(ROLL, 'ryan@example.com', 'Amy'), 'Ryan');
  assert.equal(emailTakenBy(ROLL, 'RYAN@EXAMPLE.COM', 'Amy'), 'Ryan', 'capitals do not dodge it');
});

test('saving the address you already had is not a clash', () => {
  assert.equal(emailTakenBy(ROLL, 'ryan@example.com', 'Ryan'), null);
  assert.equal(emailTakenBy(ROLL, 'RYAN@example.com', 'ryan'), null, 'same owner, stray capital');
  assert.equal(emailTakenBy(ROLL, 'stranger@example.com', 'Ryan'), null, 'nobody holds it');
  assert.equal(emailTakenBy([], 'ryan@example.com', 'Ryan'), null);
});
