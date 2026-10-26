import assert from 'node:assert/strict';
import test from 'node:test';
import { sideProjection } from '../src/lib/league/dailyProjection.js';
import { gamesCapProjection, gamesPlayed, sideOdds, type GameLine, type ScorePlayer, type ScoreSide, type ScoresWeek } from '../src/lib/league/scores.js';
import { lineupGames } from '../src/lib/league/lineupGames.js';
import { sideMean } from '../src/lib/league/winOdds.js';

const game = (status: GameLine['status']): GameLine => ({ status, opponent: 'NY', home: true, teamScore: null, oppScore: null, clock: null, tipoff: null, minutesLeft: status === 'live' ? 24 : null });
const expected = (player: ScorePlayer) => player.seasonAvg ?? 0;

/** The rulebook example: 29 prior starts plus 50, 40 and 35 on the last day. */
function example() {
  const make = (id: number, period: number, points: number, proTeam = 'DEN'): ScorePlayer => ({
    id, name: `Player ${id}`, proTeam, proTeamId: proTeam === 'DEN' ? 7 : proTeam === 'GSW' ? 9 : 13, position: 'C', injuryStatus: null,
    seasonAvg: period === 2 ? points : 30, last7: null, last15: null, last30: null, projByDay: {},
    days: { [period]: { lineupSlotId: 4, started: true, points: period === 1 ? points : 0, played: period === 1, stats: null, game: game(period === 1 ? 'final' : 'upcoming') } },
  });
  const side: ScoreSide = {
    teamId: 7, name: 'Home', abbrev: 'H', record: { wins: 0, losses: 0, ties: 0 }, total: 865, pointsByDay: { '1': 865, '2': 0 },
    players: [
      ...Array.from({ length: 29 }, (_, i) => make(i + 1, 1, i === 0 ? 100 : 765 / 28)),
      make(30, 2, 50), make(31, 2, 40, 'GSW'), make(32, 2, 35, 'LAL'),
    ],
  };
  const week: Pick<ScoresWeek, 'days' | 'gamesCap' | 'currentScoringPeriodId'> = {
    gamesCap: 30, currentScoringPeriodId: 2,
    days: [
      { scoringPeriodId: 1, date: '2026-11-06', games: { DEN: game('final') } },
      { scoringPeriodId: 2, date: '2026-11-07', games: { DEN: game('upcoming'), GSW: game('upcoming'), LAL: game('upcoming') } },
      { scoringPeriodId: 3, date: '2026-11-08', games: {} },
    ],
  };
  return { side, week };
}

test('32 against 30 removes 50 and 40 from the last day, leaving the 35-point game', () => {
  const { side, week } = example();
  const before = structuredClone(side);
  const projection = sideProjection(side, week, expected);
  assert.equal(projection.week, 900);
  assert.equal(projection.deduction, 90);
  assert.equal(projection.byDay['1'], 865, 'the earlier 100-point game must survive');
  assert.equal(projection.byDay['2'], 35);
  assert.deepEqual(projection.overages.map((entry) => [entry.playerId, entry.scoringPeriodId]), [[30, 2], [31, 2]], 'Saturday is the last day with games, even though Sunday ends the week');
  assert.equal(sideMean(sideOdds(side, week, expected)), projection.week);
  assert.deepEqual(side, before, 'raw ESPN scores remain unchanged');
});

test('finished games use actual scores and produce the rulebook 990 - 90 = 900 result', () => {
  const { side, week } = example();
  week.currentScoringPeriodId = 4;
  side.total = 990;
  side.pointsByDay['2'] = 125;
  for (const player of side.players.slice(29)) {
    Object.assign(player.days['2'], { points: player.seasonAvg, played: true, game: game('final') });
  }
  const projection = sideProjection(side, week, () => 999);
  assert.equal(projection.week, 900);
  assert.equal(projection.byDay['2'], 35);
  assert.deepEqual(projection.overages.map((entry) => entry.deduction), [50, 40]);
  assert.equal(sideOdds(side, week, expected).points, 900);
});

test('a live overage removes scored points and the projected remainder exactly once', () => {
  const { side, week } = example();
  const [a, b] = side.players.slice(29);
  a.seasonAvg = 80;
  Object.assign(a.days['2'], { points: 10, played: true, game: game('live') });
  Object.assign(b.days['2'], { points: 30, played: true, game: game('final') });
  week.days[1].games = { DEN: game('live'), GSW: game('final'), LAL: game('upcoming') };
  side.total = 905;
  side.pointsByDay['2'] = 40;
  const projection = sideProjection(side, week, expected);
  assert.equal(projection.week, 895);
  assert.equal(projection.byDay['2'], 30);
  assert.equal(projection.deduction, 85, '50 projected live points plus 35 upcoming points');
  assert.deepEqual(projection.overages.map((entry) => entry.playerId), [30, 32]);
  assert.equal(sideMean(sideOdds(side, week, expected)), 895);
});

test('selection updates when the final-day forecasts change, with stable ties', () => {
  const { side, week } = example();
  side.players[31].seasonAvg = 60;
  assert.deepEqual(gamesCapProjection(side, week, expected).overages.map((entry) => entry.playerId), [32, 30]);
  for (const player of side.players.slice(29)) player.seasonAvg = 40;
  assert.deepEqual(gamesCapProjection(side, week, expected).overages.map((entry) => entry.playerId), [30, 31]);
});

test('at or under the cap leaves every game intact; the excess count determines the deductions', () => {
  const { side, week } = example();
  for (const cap of [32, 33, null]) {
    const projection = sideProjection(side, { ...week, gamesCap: cap }, expected);
    assert.equal(projection.week, 990);
    assert.deepEqual(projection.overages, []);
  }
  const oneOver = sideProjection(side, { ...week, gamesCap: 31 }, expected);
  assert.equal(oneOver.week, 940);
  assert.deepEqual(oneOver.overages.map((entry) => entry.playerId), [30]);
});

test('bench, IR and OUT players do not become projected overages', () => {
  const { side, week } = example();
  side.players[29].days['2'].started = false;
  side.players[29].days['2'].lineupSlotId = 12;
  side.players[30].days['2'].started = false;
  side.players[30].days['2'].lineupSlotId = 13;
  side.players[31].injuryStatus = 'OUT';
  assert.deepEqual(sideProjection(side, week, expected).overages, []);
});

test('deductions can zero the final day and carry back if the entire day is over the cap', () => {
  const { side, week } = example();
  const allLastDay = sideProjection(side, { ...week, gamesCap: 29 }, expected);
  assert.equal(allLastDay.byDay['2'], 0);
  assert.equal(allLastDay.week, 865);
  assert.equal(allLastDay.overages.length, 3);
  const earlier = sideProjection(side, { ...week, gamesCap: 28 }, expected);
  assert.equal(earlier.week, 765);
  assert.equal(earlier.byDay['1'], 765);
  assert.equal(earlier.byDay['2'], 0);
  assert.equal(earlier.overages[3].playerId, 1);
});

test('a cancelled game reduces the excess count instead of becoming an overage', () => {
  const { side, week } = example();
  week.days[1].games!.LAL.status = 'off';
  const projection = sideProjection(side, week, expected);
  assert.equal(projection.week, 905);
  assert.deepEqual(projection.overages.map((entry) => entry.playerId), [30]);
});

test('today’s final DNPs do not cause false overages at or under the cap', () => {
  const { side, week } = example();
  for (const player of side.players.slice(29)) {
    Object.assign(player.days['2'], { points: 0, played: false, game: game('final') });
  }
  week.days[1].games = { DEN: game('final'), GSW: game('final'), LAL: game('final') };
  for (const cap of [29, 30]) {
    const cappedWeek = { ...week, gamesCap: cap } as ScoresWeek;
    assert.equal(gamesPlayed(side, cappedWeek), 29);
    assert.equal(lineupGames(side, cappedWeek).projected, 29);
    assert.deepEqual(gamesCapProjection(side, cappedWeek, expected).overages, []);
    assert.equal(sideProjection(side, cappedWeek, expected).deduction, 0);
  }
});

test('an OUT player’s live NBA game counts only if he actually played', () => {
  const { side, week } = example();
  const player = side.players[29];
  player.injuryStatus = 'OUT';
  player.days['2'].game = game('live');
  week.days[1].games!.DEN = game('live');
  const cappedWeek = { ...week, gamesCap: 31 } as ScoresWeek;
  assert.equal(gamesPlayed(side, cappedWeek), 29);
  assert.deepEqual(gamesCapProjection(side, cappedWeek, expected).overages, []);
  player.days['2'].played = true;
  assert.equal(gamesPlayed(side, cappedWeek), 30);
  assert.equal(gamesCapProjection(side, cappedWeek, expected).overages.length, 1);
});

test('26 played games plus two final DNPs stay at the 26-game cap without deductions', () => {
  const { side, week } = example();
  side.players = side.players.slice(0, 28);
  for (const player of side.players.slice(26)) {
    player.days = { '2': { lineupSlotId: 4, started: true, points: 0, played: false, stats: null, game: game('final') } };
  }
  week.days[1].games = { DEN: game('final') };
  const cappedWeek = { ...week, gamesCap: 26 } as ScoresWeek;
  const games = lineupGames(side, cappedWeek);
  assert.equal(games.played, 26);
  assert.equal(games.projected, 26);
  assert.equal(games.difference, 0);
  const forecast = sideProjection(side, cappedWeek, expected);
  assert.deepEqual(forecast.overages, []);
  assert.equal(forecast.deduction, 0);
  assert.equal(forecast.week, side.total);
});
