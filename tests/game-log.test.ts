import assert from 'node:assert/strict';
import test from 'node:test';
import gamelog from './fixtures/espn-gamelog.json' with { type: 'json' };
import { gameFantasyPoints, gameLogUrl, logAverages, logLine, readGameLog, recentGames, resultText, type LogGame } from '../src/lib/league/gameLog.js';
import { LEAGUE_SCORING } from '../src/lib/league/partyScore.js';

const log = readGameLog(gamelog);

test('reads the regular season, newest first, and leaves out preseason', () => {
  assert.equal(log.seasonId, 2027);
  assert.deepEqual(log.games.map(game => game.eventId), ['401909845', '401909091']);
  const [orl] = log.games;
  assert.equal(orl.opp, 'ORL');
  assert.equal(orl.home, false);
  assert.equal(resultText(orl), 'W 115-93');
  assert.equal(orl.season, '2026-27');
});

test('leaves out playoff games', () => {
  const finals = { ...gamelog, seasonTypes: [{ displayName: '2025-26 Postseason', categories: gamelog.seasonTypes[0].categories }] };
  assert.equal(readGameLog(finals).games.length, 0);
});

test('turns ESPN columns into fantasy stats, misses filled in', () => {
  const [orl] = log.games;
  assert.equal(orl.stats['40'], 23);
  assert.equal(orl.stats['13'], 4);
  assert.equal(orl.stats['14'], 13);
  assert.equal(orl.stats['23'], 9);
  assert.equal(orl.stats['17'], 2);
  assert.equal(orl.stats['0'], 12);
  assert.equal(logLine(orl.stats), '23 min · 12 pts · 5 reb · 5 ast · 2 stl · 2 3pm · 3 to');
  assert.equal(typeof gameFantasyPoints(orl, LEAGUE_SCORING), 'number');
});

test('a short season fills the window from last season', () => {
  const old = (eventId: string, date: string): LogGame => ({ ...log.games[0], eventId, date, season: '2025-26' });
  const previous = [old('a', '2026-04-10'), old('b', '2026-04-08')];
  assert.deepEqual(recentGames(log.games, previous, 3).map(game => game.eventId), ['401909845', '401909091', 'a']);
  assert.equal(recentGames(log.games, previous, 7).length, 4);
});

test('averages fantasy points and minutes, and nothing for no games', () => {
  const average = logAverages(log.games, LEAGUE_SCORING)!;
  assert.equal(average.min, 26);
  const each = log.games.map(game => gameFantasyPoints(game, LEAGUE_SCORING));
  assert.equal(average.fpts, Math.round(((each[0] + each[1]) / 2) * 10) / 10);
  assert.equal(logAverages([], LEAGUE_SCORING), null);
  assert.equal(readGameLog(null).games.length, 0);
  assert.match(gameLogUrl(1, 2026), /athletes\/1\/gamelog\?season=2026$/);
});
