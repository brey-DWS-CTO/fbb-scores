import assert from 'node:assert/strict';
import test from 'node:test';
import { draftCues, TWO_MINUTES_MS, type ClockLook } from '../src/lib/league/draftSounds.js';
import { statsLocked } from '../src/lib/league/draftLock.js';

const look = (overrides: Partial<ClockLook> = {}): ClockLook => ({ mine: false, overall: 1, elapsedMs: 0, calledAt: null, ...overrides });

test('your pick coming up chimes once, not on the first look', () => {
  assert.deepEqual(draftCues(null, look({ mine: true })), []);
  assert.deepEqual(draftCues(look({ overall: 1 }), look({ mine: true, overall: 2 })), ['up']);
  assert.deepEqual(draftCues(look({ mine: true, overall: 2 }), look({ mine: true, overall: 2, elapsedMs: 500 })), []);
});

test('back-to-back picks at the turn each chime', () => {
  assert.deepEqual(draftCues(look({ mine: true, overall: 10 }), look({ mine: true, overall: 11 })), ['up']);
});

test('two minutes sounds once as the pick crosses it', () => {
  const before = look({ mine: true, elapsedMs: TWO_MINUTES_MS - 400 });
  assert.deepEqual(draftCues(before, look({ mine: true, elapsedMs: TWO_MINUTES_MS + 100 })), ['two-minutes']);
  assert.deepEqual(draftCues(look({ mine: true, elapsedMs: TWO_MINUTES_MS + 100 }), look({ mine: true, elapsedMs: TWO_MINUTES_MS + 600 })), []);
});

test('CLOCK called on you sounds once; on someone else it is quiet', () => {
  const at = '2026-10-18T21:03:00.000Z';
  assert.deepEqual(draftCues(look({ mine: true }), look({ mine: true, calledAt: at })), ['clock']);
  assert.deepEqual(draftCues(look({ mine: true, calledAt: at }), look({ mine: true, calledAt: at })), []);
  assert.deepEqual(draftCues(look(), look({ calledAt: at })), []);
});

test('stats lock for members while the real draft runs or in the test, never for the commish', () => {
  const draft = (startedAt: string | null, closedAt: string | null = null) => ({ draft: { picks: {}, startedAt, closedAt } });
  assert.equal(statsLocked({ league: draft(null), isCommissioner: false, inTestDraft: false }), false);
  assert.equal(statsLocked({ league: draft('2026-10-18T21:00:00Z'), isCommissioner: false, inTestDraft: false }), true);
  assert.equal(statsLocked({ league: draft('2026-10-18T21:00:00Z', '2026-10-18T23:00:00Z'), isCommissioner: false, inTestDraft: false }), false);
  assert.equal(statsLocked({ league: draft(null), isCommissioner: false, inTestDraft: true }), true);
  assert.equal(statsLocked({ league: draft('2026-10-18T21:00:00Z'), isCommissioner: true, inTestDraft: true }), false);
});
