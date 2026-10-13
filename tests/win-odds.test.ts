import assert from 'node:assert/strict';
import test from 'node:test';
import { SPREAD, erf, normalCdf, sideMean, sideVariance, winChance } from '../src/lib/league/winOdds.ts';

test('the error function and Φ match the tables', () => {
  assert.ok(Math.abs(erf(0)) < 1e-9);
  assert.ok(Math.abs(erf(1) - 0.8427007929) < 1e-6);
  assert.ok(Math.abs(erf(-1) + 0.8427007929) < 1e-6);
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 2e-4);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 2e-4);
  assert.ok(normalCdf(8) > 0.999999);
  assert.ok(normalCdf(-8) < 0.000001);
});

test('both sides done: the lead wins outright, a tie is 50/50', () => {
  assert.deepEqual(winChance({ points: 900, remaining: [] }, { points: 850, remaining: [] }), { a: 100, b: 0 });
  assert.deepEqual(winChance({ points: 850, remaining: [] }, { points: 900, remaining: [] }), { a: 0, b: 100 });
  assert.deepEqual(winChance({ points: 900, remaining: [] }, { points: 900, remaining: [] }), { a: 50, b: 50 });
});

test('a lead with nothing left is still only a chance while the other side has games', () => {
  const ahead = { points: 1000, remaining: [] };
  const behind = { points: 950, remaining: [{ expected: 40 }, { expected: 40 }] };
  const chance = winChance(ahead, behind);
  // Behind expects 1030 against 1000, so the team that is ahead now is the underdog.
  assert.ok(chance.a < 50, `expected under 50, got ${chance.a}`);
  assert.ok(chance.a >= 1 && chance.b <= 99);
  assert.equal(chance.a + chance.b, 100);

  // Shrink what is left and the lead holds.
  const small = winChance(ahead, { points: 950, remaining: [{ expected: 20 }] });
  assert.ok(small.a > 90, `expected over 90, got ${small.a}`);
});

test('the same games left on both sides from the same score is 50/50', () => {
  const a = { points: 500, remaining: [{ expected: 30 }, { expected: 45 }, { expected: 25 }] };
  const b = { points: 500, remaining: [{ expected: 45 }, { expected: 25 }, { expected: 30 }] };
  assert.deepEqual(winChance(a, b), { a: 50, b: 50 });
});

test('more expected points move the number the right way, and only that way', () => {
  const base = { points: 500, remaining: [{ expected: 30 }, { expected: 30 }] };
  const stronger = { points: 500, remaining: [{ expected: 45 }, { expected: 30 }] };
  const weaker = { points: 500, remaining: [{ expected: 15 }, { expected: 30 }] };
  assert.ok(winChance(stronger, base).a > 50);
  assert.ok(winChance(weaker, base).a < 50);
  assert.equal(winChance(stronger, base).a, winChance(base, stronger).b);
  // More points so far help the same way.
  assert.ok(winChance({ ...base, points: 530 }, base).a > winChance(base, base).a);
});

test('a game part way through counts only the part that is left', () => {
  const whole = sideMean({ points: 0, remaining: [{ expected: 40 }] });
  const quarter = sideMean({ points: 0, remaining: [{ expected: 40, share: 0.25 }] });
  assert.equal(whole, 40);
  assert.equal(quarter, 10);
  assert.ok(sideVariance({ points: 0, remaining: [{ expected: 40, share: 0.25 }] }) < sideVariance({ points: 0, remaining: [{ expected: 40 }] }));
});

test('the spread is one named number and the variance follows it', () => {
  assert.equal(SPREAD, 0.4);
  const sd = SPREAD * 50;
  assert.ok(Math.abs(sideVariance({ points: 0, remaining: [{ expected: 50 }] }) - sd * sd) < 1e-9);
  // A player with no expected points adds nothing, and a negative one is not a drain.
  assert.equal(sideVariance({ points: 0, remaining: [{ expected: 0 }, { expected: -5 }] }), 0);
  assert.equal(sideMean({ points: 10, remaining: [{ expected: -5 }] }), 10);
});

test('the display caps at 1 and 99 while games remain', () => {
  const runaway = { points: 2000, remaining: [{ expected: 30 }] };
  const hopeless = { points: 100, remaining: [{ expected: 30 }] };
  assert.deepEqual(winChance(runaway, hopeless), { a: 99, b: 1 });
  assert.deepEqual(winChance(hopeless, runaway), { a: 1, b: 99 });
});
