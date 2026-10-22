import assert from 'node:assert/strict';
import test from 'node:test';
import { castMatchesGame, castPageScope } from '../src/lib/league/castContext.js';
import type { CastPlay } from '../src/lib/league/fantasyCast.js';

test('follows the viewed matchup rather than the signed-in owner', () => {
  assert.equal(castPageScope('/scores/42', new URLSearchParams()), 'matchup:42');
  assert.equal(castPageScope('/scores/43', new URLSearchParams()), 'matchup:43');
});
test('follows individual NBA games and team-based game links', () => {
  assert.equal(castPageScope('/scores/nba/401909834', new URLSearchParams('team=BOS')), 'game:401909834');
  assert.equal(castPageScope('/scores/nba', new URLSearchParams('team=BOS')), 'nba:BOS');
  assert.equal(castPageScope('/scores/nba', new URLSearchParams('team=invalid')), 'all');
});
test('general scoreboard resets to all, and fantasy-team boards follow their team', () => {
  assert.equal(castPageScope('/scores/nba-scoreboard', new URLSearchParams('date=2026-10-21')), 'all');
  assert.equal(castPageScope('/scores', new URLSearchParams('team=4')), 'team:4');
  assert.equal(castPageScope('/scores/performers', new URLSearchParams('fantasyTeam=7')), 'team:7');
  assert.equal(castPageScope('/scores/performers', new URLSearchParams('fantasyTeam=all')), 'all');
});
test('NBA game filter includes both teams and excludes unrelated games', () => {
  const play = { gameId: '123', game: 'BOS @ NY' } as CastPlay;
  assert.equal(castMatchesGame(play, 'game:123'), true);
  assert.equal(castMatchesGame(play, 'game:456'), false);
  assert.equal(castMatchesGame(play, 'nba:BOS'), true);
  assert.equal(castMatchesGame(play, 'nba:NY'), true);
  assert.equal(castMatchesGame(play, 'nba:LAL'), false);
});
