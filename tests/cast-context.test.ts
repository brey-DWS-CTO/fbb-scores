import assert from 'node:assert/strict';
import test from 'node:test';
import { castMatchesGame, castPageScope } from '../src/lib/league/castContext.js';
import type { CastPlay } from '../src/lib/league/fantasyCast.js';

test('follows the viewed matchup rather than the signed-in owner', () => {
  assert.equal(castPageScope('/scores/42', new URLSearchParams()), 'matchup:42');
  assert.equal(castPageScope('/scores/43', new URLSearchParams()), 'matchup:43');
});
test('scoreboards always show everyone regardless of page filters', () => {
  for (const path of ['/scores', '/scores/nba-scoreboard', '/scores/performers', '/scores/nba/401909834', '/scores/nba']) {
    assert.equal(castPageScope(path, new URLSearchParams('team=4&fantasyTeam=7&game=123')), 'all');
  }
});

test('NBA game filter includes both teams and excludes unrelated games', () => {
  const play = { gameId: '123', game: 'BOS @ NY' } as CastPlay;
  assert.equal(castMatchesGame(play, 'game:123'), true);
  assert.equal(castMatchesGame(play, 'game:456'), false);
  assert.equal(castMatchesGame(play, 'nba:BOS'), true);
  assert.equal(castMatchesGame(play, 'nba:NY'), true);
  assert.equal(castMatchesGame(play, 'nba:LAL'), false);
});
