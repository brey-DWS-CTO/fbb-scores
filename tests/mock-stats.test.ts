import assert from 'node:assert/strict';
import test from 'node:test';
import { mockStats } from '../src/lib/league/mockStats.ts';

test('each draft counts once, the best rank sets the grade, and nobody is left out', () => {
  const rows = mockStats(['Amy', 'Brey', 'Joel'], [
    { owner: 'Brey', id: 'a', rank: 4, teams: 10 },
    { owner: 'Brey', id: 'a', rank: 4, teams: 10 },
    { owner: 'Brey', id: 'b', rank: 1, teams: 10 },
    { owner: 'Amy', id: 'c', rank: 10, teams: 10 },
    { owner: 'Mallory', id: 'd', rank: 1, teams: 10 },
  ]);
  assert.deepEqual(rows, [
    { owner: 'Brey', mocks: 2, bestGrade: 'A+' },
    { owner: 'Amy', mocks: 1, bestGrade: 'F' },
    { owner: 'Joel', mocks: 0, bestGrade: null },
  ]);
});
