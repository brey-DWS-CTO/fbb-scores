/**
 * Double-double odds from a per-game line, checked against real seasons.
 *
 * The 2024-25 rates below are public box-score facts, rounded. The model is
 * an approximation and the bands say how loose: within 0.10 of the real
 * double-double rate and 0.07 of the triple-double rate. Wembanyama is the
 * known miss: a big's rebounds vary less than the model assumes, so his
 * double-double odds run low. Tighten the band only after the model improves.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bonusOdds, estimatedBonusPerGame, tenPlusOdds } from '../src/lib/league/doubleDoubles.ts';
import { projectedBonusPerGame, projectedFppg, projectedPerGame } from '../src/lib/league/draftRankings.ts';

const line = (pts: number, reb: number, ast: number, stl: number, blk: number) =>
  ({ '0': pts, '6': reb, '3': ast, '2': stl, '1': blk });

// Points, rebounds, assists, steals, blocks per game; then real DD and TD rates.
const REAL_2025: [string, ReturnType<typeof line>, number, number][] = [
  ['Nikola Jokic', line(29.6, 12.7, 10.2, 1.8, 0.6), 0.90, 0.49],
  ['Domantas Sabonis', line(19.1, 13.9, 6.0, 0.7, 0.4), 0.87, 0.04],
  ['Giannis Antetokounmpo', line(30.4, 11.9, 6.5, 0.9, 1.2), 0.81, 0.09],
  ['James Harden', line(22.8, 5.8, 8.7, 1.5, 0.7), 0.38, 0.08],
  ['Josh Giddey', line(14.6, 8.1, 7.2, 1.5, 0.6), 0.43, 0.10],
  ['Shai Gilgeous-Alexander', line(32.7, 5.0, 6.4, 1.7, 1.0), 0.15, 0.00],
];

test('one category: no average means no odds, a big average means near certainty', () => {
  assert.equal(tenPlusOdds(0), 0);
  assert.equal(tenPlusOdds(-3), 0);
  assert.ok(tenPlusOdds(30) > 0.99);
  assert.ok(Math.abs(tenPlusOdds(9.5) - 0.5) < 0.01, 'a 9.5 average is a coin flip');
  assert.ok(tenPlusOdds(5) < tenPlusOdds(8) && tenPlusOdds(8) < tenPlusOdds(12));
});

test('double- and triple-double odds land near real 2024-25 rates', () => {
  for (const [name, perGame, dd, td] of REAL_2025) {
    const odds = bonusOdds(perGame);
    assert.ok(Math.abs(odds.doubleDouble - dd) <= 0.10, `${name} DD ${odds.doubleDouble.toFixed(2)} vs ${dd}`);
    assert.ok(Math.abs(odds.tripleDouble - td) <= 0.07, `${name} TD ${odds.tripleDouble.toFixed(2)} vs ${td}`);
    assert.ok(odds.tripleDouble <= odds.doubleDouble);
    assert.ok(odds.quadrupleDouble <= odds.tripleDouble);
    assert.ok(odds.quadrupleDouble < 0.01, `${name} should almost never post a quadruple-double`);
  }
});

const LEAGUE = [
  { statId: 0, points: 1 },
  { statId: 37, points: 1.8 },
  { statId: 38, points: 6.2 },
  { statId: 39, points: 170 },
];

test('the bonus pays only for items the dictionary lacks', () => {
  const jokic = REAL_2025[0][1];
  const estimated = estimatedBonusPerGame(jokic, LEAGUE);
  assert.ok(estimated > 4 && estimated < 5.5, `Jokic bonus ${estimated}`);
  // ESPN sends the counts itself: nothing is estimated on top.
  const withCounts = { ...jokic, '37': 0.9, '38': 0.49, '39': 0 };
  assert.equal(estimatedBonusPerGame(withCounts, LEAGUE), 0);
  // No bonus items in the scoring: nothing to estimate.
  assert.equal(estimatedBonusPerGame(jokic, [{ statId: 0, points: 1 }]), 0);
});

test('projected FPPG includes the estimated bonus and can report it apart', () => {
  const games = 70;
  const totals = { '0': 29.6 * games, '6': 12.7 * games, '3': 10.2 * games, '2': 1.8 * games, '1': 0.6 * games, '42': games };
  const projection = { id: '102027', stats: totals, averageStats: null };
  const perGame = projectedPerGame(projection)!;
  assert.ok(Math.abs(perGame['0'] - 29.6) < 1e-9);
  const bonus = projectedBonusPerGame(projection, LEAGUE);
  const fppg = projectedFppg(projection, LEAGUE)!;
  assert.ok(bonus > 4 && bonus < 5.5);
  assert.ok(Math.abs(fppg - (29.6 + bonus)) < 0.11, `${fppg} vs ${29.6 + bonus}`);
  // Averages, when ESPN sends them, are used as they are.
  const averaged = { id: '102027', stats: {}, averageStats: { '0': 20, '37': 1 } };
  assert.equal(projectedFppg(averaged, LEAGUE), 21.8);
  assert.equal(projectedBonusPerGame(averaged, LEAGUE), 0);
  // No games, no answer.
  assert.equal(projectedFppg({ id: '102027', stats: { '0': 100 }, averageStats: null }, LEAGUE), null);
});
