import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_POLL_MS,
  IDLE_AFTER_MS,
  LIVE_DRAFT_POLL_MS,
  draftIsLive,
  pollInterval,
} from '../src/lib/league/polling.js';

const draft = (startedAt: string | null, closedAt?: string | null) => ({
  draft: { picks: {}, startedAt, closedAt },
});

test('the draft is live from the start until the commissioner closes it', () => {
  assert.equal(draftIsLive(undefined), false, 'no state yet');
  assert.equal(draftIsLive(draft(null)), false, 'not started');
  assert.equal(draftIsLive(draft('2026-10-18T21:00:00Z')), true);
  assert.equal(draftIsLive(draft('2026-10-18T21:00:00Z', null)), true);
  assert.equal(draftIsLive(draft('2026-10-18T21:00:00Z', '2026-10-18T23:30:00Z')), false, 'closed');
});

test('a page in use asks every 30 seconds', () => {
  assert.equal(pollInterval({ fast: false, draftLive: false, idleForMs: 0 }), ACTIVE_POLL_MS);
  assert.equal(pollInterval({ fast: false, draftLive: true, idleForMs: 0 }), ACTIVE_POLL_MS);
  assert.equal(pollInterval({ fast: true, draftLive: false, idleForMs: 0 }), ACTIVE_POLL_MS, 'the draft page before the draft');
});

test('an idle page stops asking, so the database can sleep', () => {
  assert.equal(pollInterval({ fast: false, draftLive: false, idleForMs: IDLE_AFTER_MS - 1 }), ACTIVE_POLL_MS);
  assert.equal(pollInterval({ fast: false, draftLive: false, idleForMs: IDLE_AFTER_MS }), false);
  assert.equal(pollInterval({ fast: true, draftLive: false, idleForMs: IDLE_AFTER_MS }), false);
});

test('the draft board keeps up during the draft, even with nobody touching it', () => {
  assert.equal(pollInterval({ fast: true, draftLive: true, idleForMs: 0 }), LIVE_DRAFT_POLL_MS);
  assert.equal(pollInterval({ fast: true, draftLive: true, idleForMs: 3 * 3600_000 }), LIVE_DRAFT_POLL_MS);
});

test('idle gives the database its five quiet minutes', () => {
  // Neon suspends after five minutes with no query. Anything slower than
  // that never lets it rest.
  assert.ok(IDLE_AFTER_MS <= 5 * 60_000);
  assert.ok(ACTIVE_POLL_MS < IDLE_AFTER_MS);
});
