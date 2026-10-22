import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreboardTimeLeft, sortScoreboardGames } from '../src/lib/league/scoreboardOrder.js';
import type { NbaGame } from '../src/lib/league/houseParty.js';

test('scoreboard puts live nearest the finish first, then upcoming by ascending tipoff, then finals', () => {
  const game = (id: string, state: NbaGame['state'], hour: number, detail = ''): NbaGame => ({ id, state, detail, tipoff: `2026-10-22T${hour}:00:00Z`, home: 'BOS', away: 'NY', tv: null, homeScore: null, awayScore: null });
  const games = [game('late', 'pre', 23), game('final', 'post', 17), game('third', 'in', 18, '2:00 - 3rd'), game('early', 'pre', 21), game('fourth', 'in', 19, '4:00 - 4th'), game('ot', 'in', 19, '0:30 - 2OT')];
  assert.deepEqual(sortScoreboardGames(games).map(g => g.id), ['ot', 'fourth', 'third', 'early', 'late', 'final']);
  assert.equal(games[0].id, 'late');
  assert.equal(scoreboardTimeLeft('Halftime'), 1440);
  assert.equal(scoreboardTimeLeft('End of 3rd'), 720);
  assert.equal(scoreboardTimeLeft('4th 1:15'), 75);
  assert.equal(scoreboardTimeLeft('Delayed'), Infinity);
});
