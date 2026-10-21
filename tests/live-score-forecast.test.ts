import { historicalScoreBaselines } from '../src/lib/league/scoreBaseline.js';
import { leagueDataset } from '../src/lib/league/data.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { blendExpected, expectedPointsForGame, playerDayProjection, sideProjection } from '../src/lib/league/dailyProjection.js';
import { remainingGamePoints, sideOdds } from '../src/lib/league/scores.js';
import { sideMean, winChance } from '../src/lib/league/winOdds.js';
import { warningWeek } from './helpers/lineup-games-fixture.js';

test('one opening-night outlier cannot dominate the preseason forecast', () => {
  const unknownSample = blendExpected({ last15: 80, season: 80, preseason: 30 })!;
  const oneGame = blendExpected({ last15: 80, season: 80, preseason: 30, seasonGames: 1, last15Games: 1 })!;
  const established = blendExpected({ last15: 80, season: 80, preseason: 30, seasonGames: 50, last15Games: 6 })!;
  assert.ok(oneGame < 45, `first game should stay near the prior, got ${oneGame}`);
  assert.ok(oneGame < established && established < unknownSample);
  assert.ok(Math.abs(blendExpected({ last15: 80, season: 80, preseason: null, seasonGames: 1, last15Games: 1 })! - 80) < 1e-9, 'a missing prior must not turn a real source into zero');
  const player = warningWeek().matchups[0].away.players[0];
  Object.assign(player, { seasonAvg: 80, last15: 80, seasonGames: 1, last15Games: 1 });
  assert.equal(expectedPointsForGame(player, { scoringPeriodId: 18, preseason: 30 }), oneGame);
  player.projByDay['18'] = 36;
  assert.equal(expectedPointsForGame(player, { scoringPeriodId: 18, preseason: 30 }), 36, 'ESPN daily forecasts still take priority');
});

test('minutes used late in a game reduce the remaining projection, with bounded efficiency updates', () => {
  const player = warningWeek().matchups[0].away.players[0];
  player.expectedMinutes = 32;
  player.days['18'].stats = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, to: 0, min: 30, gp: 1 };
  player.days['18'].points = 15;
  const left = { scoringPeriodId: 18, live: true, share: 0.25 };
  const cold = remainingGamePoints(player, left, 40);
  assert.ok(cold > 0 && cold < 10, `remaining points should be below the clock-only 10, got ${cold}`);
  player.days['18'].points = 100;
  const hot = remainingGamePoints(player, left, 40);
  assert.ok(hot > cold && hot <= 13.5, 'a hot game is updated with regression, not extrapolated without limits');
  player.days['18'].stats.min = 4;
  assert.equal(remainingGamePoints(player, { ...left, share: 0.9 }, 40), 36, 'the opening minutes do not rewrite the baseline');
});

test('without reliable minutes the live forecast falls back to the game clock', () => {
  const player = warningWeek().matchups[0].away.players[0];
  assert.equal(remainingGamePoints(player, { scoringPeriodId: 18, share: 0.5, live: true }, 40), 20);
  assert.equal(remainingGamePoints(player, { scoringPeriodId: 18, share: 1, live: false }, 40), 40);
  assert.equal(remainingGamePoints(player, { scoringPeriodId: 18, share: 0, live: true }, 40), 0);
});

test('player, team and odds use exactly the same minutes-based live forecast', () => {
  const week = warningWeek();
  week.gamesCap = 30;
  const side = week.matchups[0].away;
  const player = side.players[0];
  player.expectedMinutes = 32;
  player.days['18'].stats = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, to: 0, min: 30, gp: 1 };
  player.days['18'].points = 15;
  player.days['18'].game!.status = 'live';
  week.days[1].games!.DEN.status = 'live';
  week.days[1].games!.DEN.minutesLeft = 12;
  side.pointsByDay['18'] = 15;
  side.total = 45;
  const playerFinish = playerDayProjection(player, week, () => 40, 18)!;
  assert.equal(sideProjection(side, week, () => 40).byDay['18'], playerFinish);
  assert.equal(sideProjection(side, week, () => 40).week, Math.round(sideMean(sideOdds(side, week, () => 40)) * 10) / 10);
});

test('early-week odds include shared forecast uncertainty and resist small score swings', () => {
  const games = Array.from({ length: 25 }, () => ({ expected: 35 }));
  const team = { points: 0, remaining: games };
  const even = winChance(team, team).a;
  const smallLead = winChance({ ...team, points: 10 }, team).a;
  const projectedEdge = winChance({ ...team, remaining: games.map(() => ({ expected: 40 })) }, team).a;
  assert.equal(even, 50);
  assert.ok(smallLead <= 53, `ten early points should not swing the week much, got ${smallLead}`);
  assert.ok(projectedEdge < 85, `a preseason edge should not look settled with 50 games left, got ${projectedEdge}`);
  assert.equal(winChance({ points: 100, remaining: [] }, { points: 90, remaining: [] }).a, 100);
});


test('a signed-out opening-night forecast includes stars who have not played yet', () => {
  const week = warningWeek();
  const player = week.matchups[0].away.players[0];
  const jokic = leagueDataset.players.find(p => p.fullName === 'Nikola Jokic');
  assert.ok(jokic?.espnId);
  Object.assign(player, { id: jokic.espnId, seasonAvg: null, last15: null, projByDay: {} });
  const prior = historicalScoreBaselines.get(player.id);
  assert.ok(prior && prior > 40, 'the public historical baseline must exist without signing in');
  const baseline = expectedPointsForGame(player, { scoringPeriodId: 18, preseason: prior });
  assert.equal(baseline, prior, 'missing current-season data does not make future games worth zero');
  const forecast = sideProjection(week.matchups[0].away, week, (p, id) => expectedPointsForGame(p, {
    scoringPeriodId: id, preseason: historicalScoreBaselines.get(p.id) ?? null,
  }));
  assert.ok(forecast.week > week.matchups[0].away.total + 2 * prior);
  player.projByDay['18'] = 48;
  assert.equal(expectedPointsForGame(player, { scoringPeriodId: 18, preseason: prior }), 48, 'daily ESPN projection retains priority');
});
