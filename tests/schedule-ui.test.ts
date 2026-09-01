import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ariaSortValue,
  gameCountHeat,
  nextSortLabel,
  relativeScheduleHeat,
  shortPeriodLabel,
  sortDirectionLabel,
  sortRowsByNumber,
  toggleColumnSort,
} from '../src/components/league/scheduleUi.js';
import { DEFAULT_2027_LEAGUE_MAPPING } from '../src/lib/league/schedule.js';

test('matches the worksheet game-count colors', () => {
  assert.equal(gameCountHeat(2), 'very-low');
  assert.equal(gameCountHeat(3), 'mid');
  assert.equal(gameCountHeat(4), 'good');
  assert.equal(gameCountHeat(5), 'high');
});

test('ranks summary totals from red through green', () => {
  const values = [5, 6, 7, 8];
  assert.equal(relativeScheduleHeat(5, values), 'very-low');
  assert.equal(relativeScheduleHeat(6, values), 'low');
  assert.equal(relativeScheduleHeat(7, values), 'mid');
  assert.equal(relativeScheduleHeat(8, values), 'high');
  assert.equal(relativeScheduleHeat(7, [7, 7, 7]), 'neutral');
});

test('cycles a column through fewest first, most first, then off', () => {
  const first = toggleColumnSort<number>(null, 9);
  assert.deepEqual(first, { key: 9, direction: 'asc' });
  const second = toggleColumnSort(first, 9);
  assert.deepEqual(second, { key: 9, direction: 'desc' });
  assert.equal(toggleColumnSort(second, 9), null);
});

test('starts a new column at fewest first', () => {
  assert.deepEqual(
    toggleColumnSort({ key: 9, direction: 'desc' }, 12),
    { key: 12, direction: 'asc' },
  );
});

test('sorts rows by a number and keeps ties in source order', () => {
  const rows = [
    { id: 'a', games: 4 },
    { id: 'b', games: 2 },
    { id: 'c', games: 4 },
    { id: 'd', games: 3 },
  ];
  const games = (row: { games: number }) => row.games;

  assert.deepEqual(sortRowsByNumber(rows, games, 'asc').map((row) => row.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(sortRowsByNumber(rows, games, 'desc').map((row) => row.id), ['a', 'c', 'd', 'b']);
  assert.deepEqual(sortRowsByNumber(rows, games, null).map((row) => row.id), ['a', 'b', 'c', 'd']);
});

test('leaves the source rows alone', () => {
  const rows = [{ games: 3 }, { games: 1 }];
  sortRowsByNumber(rows, (row) => row.games, 'asc');
  assert.deepEqual(rows.map((row) => row.games), [3, 1]);
});

test('names the sort for screen readers and for the button', () => {
  assert.equal(ariaSortValue('asc'), 'ascending');
  assert.equal(ariaSortValue('desc'), 'descending');
  assert.equal(ariaSortValue(null), 'none');
  assert.equal(sortDirectionLabel('asc'), 'fewest first');
  assert.equal(sortDirectionLabel('desc'), 'most first');
  assert.equal(nextSortLabel(null), 'sort fewest first');
  assert.equal(nextSortLabel('asc'), 'sort most first');
  assert.equal(nextSortLabel('desc'), 'clear the sort');
});

test('shortens period labels for the phone column', () => {
  assert.equal(shortPeriodLabel('Week 1'), 'W1');
  assert.equal(shortPeriodLabel('Week 16'), 'W16');
  assert.equal(shortPeriodLabel('Play-In 2'), 'PI 2');
  assert.equal(shortPeriodLabel('Playoff Round 1 · Week 2'), 'R1 W2');
  assert.equal(shortPeriodLabel('Playoff Round 2 · Week 1'), 'R2 W1');
  assert.equal(shortPeriodLabel('Something else'), 'Something else');
});

test('shortens every label the 2027 mapping ships', () => {
  for (const entry of DEFAULT_2027_LEAGUE_MAPPING) {
    const short = shortPeriodLabel(entry.label);
    assert.notEqual(short, entry.label, `${entry.label} has no short form`);
    assert.ok(short.length <= 5, `${short} is too wide for the phone column`);
  }
});
