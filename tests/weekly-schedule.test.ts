import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPlayerGames } from '../src/lib/league/weeklySchedule.ts';
import type { ScorePlayer, ScoresWeek, GameLine } from '../src/lib/league/scores.ts';
const game: GameLine = { status: 'upcoming', opponent: 'GS', home: true, tipoff: '2027-01-02T20:00:00Z', teamScore: null, oppScore: null, clock: null, minutesLeft: null };
const player: ScorePlayer = { id: 7, name: 'Player', proTeam: 'DEN', proTeamId: 1, position: 'PG', injuryStatus: null, seasonAvg: null, last7: null, last15: null, last30: null, projByDay: {}, days: {} };
const fixture = () => ({ days: [{ date: '2027-01-04', scoringPeriodId: 4, games: { DEN: { ...game, opponent: 'BOS', home: false } } }, { date: '2027-01-03', scoringPeriodId: 3, games: {} }, { date: '2027-01-02', scoringPeriodId: 2, games: { DEN: { ...game } } }] }) as ScoresWeek;
test('packs only scheduled games chronologically, preserving each opponent, venue, date and projection', () => {
  const week = fixture(); const result = weeklyPlayerGames(player, week, (_p, period) => period * 10, []);
  assert.deepEqual(result.map(g => [g.period, g.opponent, g.home, g.projected]), [[2, 'GS', true, 20], [4, 'BOS', false, 40]]);
  assert.deepEqual(week.days.map(d => d.scoringPeriodId), [4, 3, 2]);
});
test('recommendations are keyed by both player and scoring day; live and final games are never badged', () => {
  const week = fixture(); week.days[0].games!.DEN.status = 'live';
  const starts = [{ playerId: 99, period: 2, slot: 'PG', points: 20 }, { playerId: 7, period: 4, slot: 'PG', points: 40 }];
  assert.deepEqual(weeklyPlayerGames(player, week, () => 20, starts).map(g => g.recommended), [false, false]);
  starts.push({ playerId: 7, period: 2, slot: 'G', points: 20 });
  const result = weeklyPlayerGames(player, week, () => 20, starts);
  assert.equal(result[0].recommended, true); assert.equal(result[0].slot, 'G');
});
test('missing schedules and off days do not invent games; missing projections stay unknown', () => {
  const week = fixture(); week.days[0].games = null; week.days[2].games!.DEN.status = 'off';
  assert.deepEqual(weeklyPlayerGames(player, week, () => 20, []), []);
  week.days[2].games!.DEN.status = 'upcoming';
  assert.equal(weeklyPlayerGames(player, week, () => NaN, [])[0].projected, null);
  assert.equal(weeklyPlayerGames(player, week, () => 0, [])[0].projected, 0);
});
test('final actuals remain separate from projected points and absent stats are not labeled DNP', () => {
  const week = fixture(); week.days[2].games!.DEN.status = 'final';
  const played = structuredClone(player); played.days['2'] = { started: true, played: true, points: 51, stats: null, game: null, lineupSlotId: 0 };
  const result = weeklyPlayerGames(played, week, () => 35, []);
  assert.equal(result[0].actual, 51); assert.equal(result[0].projected, 35);
  assert.equal(weeklyPlayerGames(player, week, () => 35, [])[0].played, null);
});


test('passed tipoff locks a stale upcoming game and removes its recommendation', () => {
  const starts = [{ playerId: 7, period: 2, slot: 'PG', points: 20 }];
  const before = weeklyPlayerGames(player, fixture(), () => 20, starts, Date.parse('2027-01-02T19:00:00Z'))[0];
  const after = weeklyPlayerGames(player, fixture(), () => 20, starts, Date.parse(game.tipoff!))[0];
  assert.equal(before.locked, false);
  assert.equal(before.recommended, true);
  assert.equal(after.locked, true);
  assert.equal(after.recommended, false);
});
