import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GAMES_CAP, capForWeek, gamesText, parseGamesCap, type GamesCapRow } from '../src/lib/league/gamesCap.ts';

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
