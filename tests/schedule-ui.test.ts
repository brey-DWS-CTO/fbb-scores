import assert from 'node:assert/strict';
import test from 'node:test';
import { gameCountHeat, relativeScheduleHeat } from '../src/components/league/scheduleUi.js';

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
