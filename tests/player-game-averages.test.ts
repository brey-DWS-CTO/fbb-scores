import test from 'node:test';
import assert from 'node:assert/strict';
import { playerGameAverages } from '../src/lib/league/playerGameAverages.ts';
import type { GameLog, LogGame } from '../src/lib/league/gameLog.ts';
const now = Date.parse('2027-01-01T00:00:00Z');
const scoring = [{ statId: 0, points: 1 }];
const game = (i: number): LogGame => ({ eventId: String(i), date: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 3 * 86400000).toISOString(),
  season: '2026-27', home: true, opp: 'BOS', result: 'W', teamScore: 100, oppScore: 90, stats: { '0': i, '40': 20 } });
test('season and last 3/7/15 are completed-game windows, not calendar-day windows', () => {
  const log: GameLog = { seasonId: 2027, games: Array.from({ length: 20 }, (_, i) => game(i + 1)) };
  const before = structuredClone(log), result = playerGameAverages(log, 2027, scoring, now);
  assert.deepEqual([result.season?.average, result.last3?.average, result.last7?.average, result.last15?.average], [10.5, 19, 17, 13]);
  assert.deepEqual(log, before);
});
test('short windows show the available-game average and its sample count', () => {
  const result = playerGameAverages({ seasonId: 2027, games: [game(1), game(2)] }, 2027, scoring, now);
  assert.deepEqual(result.last7, { average: 1.5, count: 2, target: 7 });
  assert.equal(playerGameAverages({ seasonId: 2027, games: [] }, 2027, scoring, now).season, null);
  assert.equal(playerGameAverages({ seasonId: 2026, games: [game(1)] }, 2027, scoring, now).season, null);
});
test('duplicates, future/live games, prior seasons and incomplete/DNP lines do not dilute the average', () => {
  const games = [game(1), game(1), { ...game(2), result: null }, { ...game(3), season: '2025-26' },
    { ...game(4), stats: {} }, { ...game(5), date: '2027-02-01T00:00:00Z' }];
  const result = playerGameAverages({ seasonId: 2027, games }, 2027, scoring, now);
  assert.equal(result.season?.average, 1); assert.equal(result.season?.count, 1);
});
test('per-game scoring preserves bonuses and legitimate zero-point appearances', () => {
  const result = playerGameAverages({ seasonId: 2027, games: [{ ...game(1), stats: { '0': 10, '37': 1, '40': 20 } },
    { ...game(2), stats: { '0': 0, '37': 0, '40': 0 } }] }, 2027, [{ statId: 0, points: 1 }, { statId: 37, points: 1.8 }], now);
  assert.equal(result.season?.average, 5.9); assert.equal(result.season?.count, 2);
});
