import assert from 'node:assert/strict';
import test from 'node:test';
import { gamesCapStatus, gamesWarningDate, gamesWarningKey, lineupGames } from '../src/lib/league/lineupGames.js';
import { warningWeek } from './helpers/lineup-games-fixture.js';

test('projects uncapped lineup games, excluding bench and OUT future games', () => {
  const week = warningWeek();
  // The OUT player still has a game he played before becoming injured.
  const games = lineupGames(week.matchups[0].home, week);
  assert.deepEqual(games, { played: 3, remaining: 6, projected: 9, cap: 6, difference: 3, estimated: false });
  assert.equal(gamesCapStatus(games), '3 over cap');
  assert.equal(gamesCapStatus(lineupGames(week.matchups[0].away, week)), '2 under cap');
});

test('counts a live game once even when OUT, and honors later lineup changes', () => {
  const week = warningWeek();
  const player = week.matchups[0].away.players[0];
  week.days[1].games!.DEN.status = 'live';
  assert.equal(lineupGames(week.matchups[0].away, week).projected, 4);
  player.days['19'].started = false;
  assert.equal(lineupGames(week.matchups[0].away, week).projected, 3);
  player.injuryStatus = 'OUT';
  assert.equal(lineupGames(week.matchups[0].away, week).projected, 2);
});

test('a dropped player keeps his past game but does not inherit future starts', () => {
  const week = warningWeek();
  const side = week.matchups[0].home;
  for (const period of ['18', '19', '20']) delete side.players[0].days[period];
  const before = structuredClone(side);
  assert.equal(lineupGames(side, week).projected, 6);
  assert.deepEqual(side, before, 'the forecast must not change the score data');
});

test('labels at-cap and unknown cap and marks incomplete schedule as estimated', () => {
  const week = warningWeek();
  week.gamesCap = 4;
  assert.equal(gamesCapStatus(lineupGames(week.matchups[0].away, week)), 'At cap');
  week.gamesCap = null;
  assert.equal(gamesCapStatus(lineupGames(week.matchups[0].away, week)), 'Cap unavailable');
  week.days[3].games = null;
  assert.equal(lineupGames(week.matchups[0].away, week).estimated, true);
});

test('Friday and Sunday warnings run at 7 AM Pacific in both DST and standard time', () => {
  for (const date of ['2026-10-23T14:00:00Z', '2026-10-25T14:59:00Z', '2026-11-06T15:00:00Z', '2026-11-08T15:00:00Z']) {
    assert.ok(gamesWarningDate(new Date(date)), date);
  }
  for (const date of ['2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z', '2026-11-07T15:00:00Z', '2026-10-25T15:00:00Z']) {
    assert.equal(gamesWarningDate(new Date(date)), null, date);
  }
  assert.notEqual(gamesWarningKey(2027, 3, '2026-11-06', 7), gamesWarningKey(2027, 3, '2026-11-08', 7));
});
