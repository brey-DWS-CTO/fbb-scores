import assert from 'node:assert/strict';
import test from 'node:test';
import { draftPhase, statsLocked } from '../src/lib/league/draftLock.ts';

test('the draft is before, live, then done once the commish closes it', () => {
  assert.equal(draftPhase({ startedAt: null, closedAt: null }), 'before');
  assert.equal(draftPhase({ startedAt: '2026-10-18T21:00:00Z', closedAt: null }), 'live');
  assert.equal(draftPhase({ startedAt: '2026-10-18T21:00:00Z', closedAt: '2026-10-19T16:58:38Z' }), 'done');
  assert.equal(draftPhase({ startedAt: '2026-10-18T21:00:00Z' }), 'live');
});

test('stats open to members once the draft is done', () => {
  const draft = { startedAt: '2026-10-18T21:00:00Z', closedAt: '2026-10-19T16:58:38Z', picks: {} };
  assert.equal(statsLocked({ league: { draft }, isCommissioner: false, inTestDraft: false }), false);
  assert.equal(statsLocked({ league: { draft: { ...draft, closedAt: null } }, isCommissioner: false, inTestDraft: false }), true);
});
