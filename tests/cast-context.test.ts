import { isCastScorePage } from '../src/lib/league/castControls.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { castClockText, castMatchesGame, castPageScope, lastGamePlay } from '../src/lib/league/castContext.js';
import type { CastPlay } from '../src/lib/league/fantasyCast.js';

test('follows the viewed matchup rather than the signed-in owner', () => {
  assert.equal(castPageScope('/scores/42', new URLSearchParams()), 'matchup:42');
  assert.equal(castPageScope('/scores/43', new URLSearchParams()), 'matchup:43');
});
test('scoreboards always show everyone regardless of page filters', () => {
  for (const path of ['/scores', '/scores/nba-scoreboard', '/scores/performers']) {
    assert.equal(castPageScope(path, new URLSearchParams('team=4&fantasyTeam=7&game=123')), 'all');
  }
});

test('one NBA game box score shows only plays from that game', () => {
  assert.equal(castPageScope('/scores/nba/401909834', new URLSearchParams('date=2026-10-24&player=1')), 'game:401909834');
  assert.equal(castPageScope('/scores/nba', new URLSearchParams('date=2026-10-24&team=NY')), 'nba:NYK');
  assert.equal(castPageScope('/scores/nba', new URLSearchParams('date=2026-10-24')), 'all');
});

test('the last play is the latest in that game only', () => {
  const play = (gameId: string, order: number, period = 3, clock = '5:32') => ({ id: `${gameId}:${order}`, gameId, order, period, clock, text: `play ${order}` }) as CastPlay;
  const plays = [play('1', 4), play('1', 9), play('2', 20), play('1', 7)];
  assert.equal(lastGamePlay(plays, '1')?.order, 9);
  assert.equal(lastGamePlay(plays, '3'), null);
  assert.equal(castClockText(play('1', 1)), 'Q3 5:32');
  assert.equal(castClockText(play('1', 1, 5, '0:41')), 'OT1 0:41');
});

test('NBA game filter includes both teams and excludes unrelated games', () => {
  const play = { gameId: '123', game: 'BOS @ NY' } as CastPlay;
  assert.equal(castMatchesGame(play, 'game:123'), true);
  assert.equal(castMatchesGame(play, 'game:456'), false);
  assert.equal(castMatchesGame(play, 'nba:BOS'), true);
  assert.equal(castMatchesGame(play, 'nba:NY'), true);
  assert.equal(castMatchesGame(play, 'nba:LAL'), false);
});

test('Cast opens as a panel on scoreboards and matchup pages only', () => {
  for (const path of ['/scores', '/scores/42', '/scores/nba-scoreboard', '/scores/performers']) assert.ok(isCastScorePage(path));
  for (const path of ['/league', '/scores/cast', '/admin', '/scores-extra']) assert.ok(!isCastScorePage(path));
});
