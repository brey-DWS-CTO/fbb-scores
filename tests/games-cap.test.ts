import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveGamesCaps, DEFAULT_GAMES_CAP, capForWeek, gamesText, parseGamesCap, type GamesCapRow } from '../src/lib/league/gamesCap.ts';

const row = (matchupPeriodId: number, cap: number): GamesCapRow => ({
  season: 2027, matchupPeriodId, cap, updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'Brey',
});

test('the cap is a whole number from 1 to 70, as a number or as text', () => {
  assert.equal(parseGamesCap(30), 30);
  assert.equal(parseGamesCap('30'), 30);
  assert.equal(parseGamesCap(' 31 '), 31);
  assert.equal(parseGamesCap(1), 1);
  assert.equal(parseGamesCap(70), 70);
  assert.equal(parseGamesCap(0), null);
  assert.equal(parseGamesCap(71), null);
  assert.equal(parseGamesCap(30.5), null);
  assert.equal(parseGamesCap('thirty'), null);
  assert.equal(parseGamesCap(''), null);
  assert.equal(parseGamesCap(null), null);
  assert.equal(parseGamesCap(undefined), null);
  assert.equal(parseGamesCap(Number.NaN), null);
});

test('a week nobody has set is 30; a set week is what the commish said', () => {
  assert.equal(DEFAULT_GAMES_CAP, 30);
  assert.equal(capForWeek([], 3), 30);
  const rows = [row(3, 31), row(18, 24)];
  assert.equal(capForWeek(rows, 3), 31);
  assert.equal(capForWeek(rows, 18), 24);
  assert.equal(capForWeek(rows, 4), 30);
  // ESPN's limit for the week stands in when the commissioner has not set one.
  assert.equal(capForWeek(rows, 4, 26), 26, 'a six-day week on ESPN');
  assert.equal(capForWeek(rows, 3, 26), 31, 'the commish number still wins');
  assert.equal(capForWeek([], 4, null), 30);
  assert.equal(capForWeek([], 4, 0), 30, 'nothing from ESPN means the default');
});

test('games read as played of cap', () => {
  assert.equal(gamesText(14, 30), '14 of 30');
});


test('ESPN supplies every week cap unless that particular week has an override', () => {
  assert.equal(capForWeek([], 1, 26), 26);
  assert.equal(capForWeek([], 1, 28), 28, 'opening week is not hardcoded');
  assert.equal(capForWeek([], 7, 30), 30);
  assert.equal(capForWeek([row(7, 24)], 7, 30), 24, 'NBA Cup week override');
  assert.equal(capForWeek([row(7, 24)], 8, 30), 30, 'override does not leak to another week');
  assert.equal(capForWeek([], 1), 30, 'missing ESPN data uses the standard fallback');
});

test('a manual edit after a closed poll wins, while older edits do not mask the result', async () => {
  const { normalizePoll } = await import('../src/lib/league/polls.js');
  const poll = normalizePoll({ id: 'poll-2027-week-6-game-limit', season: 2027, kind: 'standalone', title: 'Limit', detail: '', options: ['26', '30'], affects: [], threshold: 0, proposedBy: 'Brey', eligibleVoters: ['Brey'], openedAt: '2026-11-23T12:00:00.000Z', closedAt: '2026-11-23T13:00:00.000Z', closedBy: 'Brey', status: 'closed', votes: [{ owner: 'Brey', choice: '26', castAt: 'now' }] });
  assert.equal(effectiveGamesCaps([row(6, 30)], [poll])[0].cap, 26);
  assert.equal(effectiveGamesCaps([{ ...row(6, 28), updatedAt: '2026-11-23T14:00:00.000Z' }], [poll])[0].cap, 28);
  assert.equal(effectiveGamesCaps([], [{ ...poll, status: 'cancelled' }]).length, 0);
  assert.equal(effectiveGamesCaps([], [{ ...poll, votes: [] }]).length, 0);
});
