import assert from 'node:assert/strict';
import test from 'node:test';
import { guestPageAllowed, guestRequestAllowed } from '../src/lib/league/guestAccess.ts';
import { sessionEndsAt } from '../src/lib/league/auth.ts';
import { visibleSections } from '../src/lib/league/navSections.ts';
test('guest navigation excludes owner actions in both modes', () => {
  for (const mode of ['in-season', 'off-season'] as const) {
    const sections = visibleSections(false, false, mode, true);
    assert.deepEqual(sections.map(s => s.id), ['scores', 'cast', 'league']);
    assert.deepEqual(sections.find(s => s.id === 'league')?.tabs.map(t => t.to), ['/teams', '/league/missed-games', '/history']);
  }
  for (const path of ['/scores', '/scores/42', '/scores/cast', '/teams', '/history', '/league/missed-games']) assert.ok(guestPageAllowed(path));
  for (const path of ['/admin', '/keepers', '/trades', '/dues', '/lm-adds', '/draft']) assert.ok(!guestPageAllowed(path));
});
test('guest requests default to denied, including unknown future endpoints', () => {
  assert.ok(guestRequestAllowed('GET', '/espn/week'));
  assert.ok(guestRequestAllowed('GET', '/espn/matchup/42'));
  assert.ok(guestRequestAllowed('GET', '/league/state'));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.ok(!guestRequestAllowed(method, '/league/keepers/Brey'));
  for (const path of ['/league/emails', '/league/dues', '/espn/debug', '/league/future-feature']) assert.ok(!guestRequestAllowed('GET', path));
});
test('guest expiry never inherits the longer owner season lifetime', () => {
  const expiresAt = '2026-11-01T00:00:00Z';
  assert.equal(sessionEndsAt({ owner: 'guest:123:Visitor', issuedAt: '2026-10-25T00:00:00Z', expiresAt }), expiresAt);
});
