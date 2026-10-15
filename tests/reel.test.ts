import assert from 'node:assert/strict';
import test from 'node:test';
import { REEL_STEPS, reelSchedule } from '../src/lib/league/reel.ts';

test('the wheel always stops on the picked team', () => {
  const steps = reelSchedule(['Joel', 'Amy', 'Kyle'], 'Kyle');
  assert.equal(steps.length, REEL_STEPS);
  assert.equal(steps.at(-1)!.name, 'Kyle');
  assert.equal(reelSchedule(['Joel', 'Amy'], 'Amy', 4).at(-1)!.name, 'Amy');
});

test('it starts fast and slows down', () => {
  const steps = reelSchedule(['Joel', 'Amy', 'Kyle'], 'Amy');
  const gaps = steps.map((s, i) => s.at - (i === 0 ? 0 : steps[i - 1].at));
  for (let i = 1; i < gaps.length; i += 1) assert.ok(gaps[i] >= gaps[i - 1], `gap ${i} shrank`);
  assert.ok(gaps[0] < 100);
  assert.ok(gaps.at(-1)! > 300);
  assert.ok(steps.at(-1)!.at < 4000, 'the whole spin stays short');
});

test('an empty list still lands on the target', () => {
  assert.equal(reelSchedule([], 'Joel', 3).every((s) => s.name === 'Joel'), true);
});
