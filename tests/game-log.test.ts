import assert from 'node:assert/strict';
import test from 'node:test';
import gamelog from './fixtures/espn-gamelog.json' with { type: 'json' };
import { gameFantasyPoints, gameLogUrl, logAverages, logLine, readGameLog, resultText, todayGame } from '../src/lib/league/gameLog.js';
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
  const utah = { ...gamelog, events: { ...gamelog.events, '401909845': { ...gamelog.events['401909845'], opponent: { id: '26', abbreviation: 'UTAH' } } } };
  assert.equal(readGameLog(utah).games[0].opp, 'UTA');
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

test('averages fantasy points and minutes, and nothing for no games', () => {
  const average = logAverages(log.games, LEAGUE_SCORING)!;
  assert.equal(average.min, 26);
  const each = log.games.map(game => gameFantasyPoints(game, LEAGUE_SCORING));
  assert.equal(average.fpts, Math.round(((each[0] + each[1]) / 2) * 10) / 10);
  assert.equal(logAverages([], LEAGUE_SCORING), null);
  assert.equal(readGameLog(null).games.length, 0);
  assert.match(gameLogUrl(1, 2026), /athletes\/1\/gamelog\?season=2026$/);
});

test('today\'s game sits on top: live with the clock, or final until the log has it', () => {
  const game = { id: '9', tipoff: '2026-10-25T01:00:00Z', home: 'DEN', away: 'NOP', tv: null, state: 'in' as const, detail: '10:15 - 2nd', homeScore: 40, awayScore: 38 };
  const line = { athleteId: '3936299', name: 'Jamal Murray', shortName: 'J. Murray', team: 'DEN', played: true, stats: { '0': 12, '40': 15 } };
  const day = { date: '2026-10-24', fetchedAt: '', error: null, games: [game], boxScores: [{ gameId: '9', state: 'in' as const, detail: '10:15 - 2nd', home: 'DEN', away: 'NOP', homeScore: 40, awayScore: 38, lines: [line] }] };
  const live = todayGame(day, 'DEN', 3936299, log.games)!;
  assert.equal(live.status, 'LIVE · Q2 10:15');
  assert.equal(live.opp, 'NOP');
  assert.equal(live.home, true);
  assert.equal(live.stats?.['0'], 12);
  const final = todayGame({ ...day, games: [{ ...game, state: 'post', detail: 'Final' }], boxScores: [{ ...day.boxScores[0], state: 'post', detail: 'Final', homeScore: 120, awayScore: 110 }] }, 'DEN', 3936299, log.games)!;
  assert.equal(final.status, 'F 120-110');
  assert.equal(todayGame(day, 'DEN', 3936299, [{ ...log.games[0], eventId: '9' }]), null);
  assert.equal(todayGame(day, 'BOS', 1, log.games), null);
  assert.equal(todayGame({ ...day, games: [{ ...game, state: 'pre' }], boxScores: [] }, 'DEN', 3936299, log.games)?.stats, null);
});
