import assert from 'node:assert/strict';
import test from 'node:test';
import { isSeasonMode, resolveSeasonMode, seasonHome } from '../src/lib/league/seasonMode.ts';

test('automatic mode starts on week 1 in Pacific, not the host time zone', () => {
  const state = { draft: {} };
  assert.equal(resolveSeasonMode(state, new Date('2026-10-19T06:59:59Z')), 'off-season');
  assert.equal(resolveSeasonMode(state, new Date('2026-10-19T07:00:00Z')), 'in-season');
});

test('closing the draft starts the season on its Pacific day when that is earlier', () => {
  const state = { draft: { closedAt: '2026-10-19T02:00:00Z' } };
  assert.equal(resolveSeasonMode(state, new Date('2026-10-18T06:59:00Z')), 'off-season');
  assert.equal(resolveSeasonMode(state, new Date('2026-10-18T20:00:00Z')), 'in-season');
  assert.equal(resolveSeasonMode({ draft: { closedAt: 'bad-date' } }, new Date('2026-10-18T20:00:00Z')), 'off-season');
});

test('either explicit mode wins over the calendar and the closed draft', () => {
  assert.equal(resolveSeasonMode({ seasonMode: 'off-season', draft: { closedAt: '2026-10-18T23:00:00Z' } }, new Date('2027-03-01')), 'off-season');
  assert.equal(resolveSeasonMode({ seasonMode: 'in-season', draft: {} }, new Date('2026-09-01')), 'in-season');
  for (const value of [null, undefined, true, 'auto', 'IN SEASON', {}]) assert.equal(isSeasonMode(value), false);
  assert.ok(isSeasonMode('in-season'));
  assert.ok(isSeasonMode('off-season'));
});


test('sign-in opens scores in season and keepers off season, respecting mode overrides', () => {
  const duringSeason = new Date('2026-10-21T23:00:00Z');
  assert.equal(seasonHome(resolveSeasonMode({ draft: {} }, duringSeason)), '/scores');
  assert.equal(seasonHome(resolveSeasonMode({ seasonMode: 'off-season', draft: {} }, duringSeason)), '/keepers');
  assert.equal(seasonHome(resolveSeasonMode({ seasonMode: 'in-season', draft: {} }, new Date('2026-08-01'))), '/scores');
});
