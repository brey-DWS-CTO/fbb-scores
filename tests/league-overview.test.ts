import test from 'node:test';
import assert from 'node:assert/strict';
import { readLeagueOverview } from '../src/lib/league/leagueOverview.js';
test('reads standings, remaining budget and draft position without losing zero values', () => {
  const result = readLeagueOverview({ settings: { acquisitionSettings: { acquisitionBudget: 100 } }, teams: [
    { id: 2, name: 'Second', playoffSeed: 2, waiverRank: 1, record: { overall: { wins: 0, losses: 2, ties: 0, pointsFor: 120.5, pointsAgainst: 250 } }, transactionCounter: { acquisitionBudgetSpent: 100 } },
    { id: 1, name: 'First', playoffSeed: 1 },
  ], draftDetail: { picks: [{ playerId: 42, roundId: 2, roundPickNumber: 4, overallPickNumber: 14 }] } });
  assert.equal(result.teams[0].name, 'First');
  assert.equal(result.teams[1].faab, 0);
  assert.equal(result.teams[1].wins, 0);
  assert.equal(result.teams[1].pointsAgainst, 250);
  assert.equal(result.teams[1].waiver, 1);
  assert.deepEqual(result.picks, [{ playerId: 42, round: 2, pick: 4, overall: 14 }]);
});
test('missing ESPN fields stay unknown rather than fabricated zeroes', () => {
  assert.deepEqual(readLeagueOverview(null), { teams: [], picks: [] });
  const result = readLeagueOverview({ teams: [{ id: 1 }], draftDetail: { picks: [{ playerId: 42 }] } });
  assert.equal(result.teams[0].faab, null);
  assert.equal(result.teams[0].pointsFor, null);
  assert.equal(result.teams[0].wins, null);
  assert.equal(result.picks.length, 0);
});
