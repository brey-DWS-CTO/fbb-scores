import assert from 'node:assert/strict';
import test from 'node:test';
import { performerGameDates } from '../server/lib/performerDatesService.js';

test('performer date picker includes today and past season game days only, ordered and unique', () => {
  const raw = { leagues: [{ calendar: ['2026-10-03T07:00Z', '2026-10-20T07:00Z', '2026-10-22T07:00Z', '2026-10-20T07:00Z', '2026-10-25T07:00Z', 'bad', '2026-10-99', null] }] };
  assert.deepEqual(performerGameDates(raw, '2026-10-23', '2026-10-19'), ['2026-10-20', '2026-10-22', '2026-10-23']);
  assert.throws(() => performerGameDates({}, '2026-10-23', '2026-10-19'), /unavailable/);
});
