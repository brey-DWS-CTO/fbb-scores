import assert from 'node:assert/strict';
import test from 'node:test';
import { leagueDataset } from '../src/lib/league/data.ts';
import { defaultDay, gamesLeft, matchupChance, playerWeek, yetToPlay } from '../src/lib/league/scores.ts';
import { DEMO_MATCHUP_PERIOD, demoWeek } from '../src/lib/league/scoresDemo.ts';

const week = demoWeek();

test('the demo week is five matchups of the league\'s ten teams, read through the real reader', () => {
  assert.equal(week.matchupPeriodId, DEMO_MATCHUP_PERIOD);
  assert.equal(week.matchups.length, 5);
  assert.equal(week.days.length, 7);
  assert.deepEqual(week.days.map((day) => day.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(week.weeks.length, 20);
  assert.equal(week.weeks[2].label, 'Week 3');
  assert.equal(week.weeks[17].label, 'Play-In 2');
  assert.equal(week.weeks[19].label, 'Playoff Round 2');
  assert.equal(week.gamesCap, 30);

  const teamIds = week.matchups.flatMap((m) => [m.home.teamId, m.away.teamId]).sort((a, b) => a - b);
  assert.deepEqual(teamIds, leagueDataset.teams.map((team) => team.espnTeamId).sort((a, b) => a - b));
  for (const matchup of week.matchups) {
    for (const side of [matchup.home, matchup.away]) {
      assert.ok(side.players.length >= 10, `${side.name} has a full roster`);
      assert.ok(side.total > 0, `${side.name} has scored`);
      assert.ok(side.name.length > 0);
      // The total is the day scores up to today.
      const summed = week.days
        .filter((day) => day.scoringPeriodId <= week.currentScoringPeriodId)
        .reduce((sum, day) => sum + (side.pointsByDay[String(day.scoringPeriodId)] ?? 0), 0);
      assert.ok(Math.abs(summed - side.total) < 0.2, `${side.name}: ${summed} vs ${side.total}`);
    }
  }
});

test('the demo has finals, one live game, and games still to come', () => {
  const today = week.days.find((day) => day.scoringPeriodId === week.currentScoringPeriodId)!;
  assert.equal(defaultDay(week), today.scoringPeriodId);
  const statuses = new Set(Object.values(today.games ?? {}).map((game) => game.status));
  assert.ok(statuses.has('final') && statuses.has('live') && statuses.has('upcoming'), [...statuses].join(','));
  const yesterday = week.days[2];
  assert.ok(Object.values(yesterday.games ?? {}).every((game) => game.status === 'final'));
  const tomorrow = week.days[4];
  assert.ok(Object.values(tomorrow.games ?? {}).every((game) => game.status === 'upcoming'));

  const everyone = week.matchups.flatMap((m) => [...m.home.players, ...m.away.players]);
  assert.ok(everyone.some((player) => player.days[String(today.scoringPeriodId)]?.game?.status === 'live'), 'somebody is on the floor right now');
  assert.ok(everyone.some((player) => gamesLeft(player, week).length > 0), 'somebody still has games');
  assert.ok(everyone.every((player) => player.seasonAvg !== null), 'every player has a season average');
  const doncic = everyone.find((player) => player.name === 'Luka Doncic');
  assert.ok(doncic, 'Doncic is on a demo roster');
  assert.equal(doncic?.injuryStatus, 'OUT');
  assert.deepEqual(gamesLeft(doncic!, week), []);
});

test('odds and the week view come out of the demo without a hole', () => {
  for (const matchup of week.matchups) {
    const chance = matchupChance(matchup, week, (player) => player.seasonAvg ?? 0);
    assert.equal(chance.home + chance.away, 100);
    assert.ok(chance.home >= 1 && chance.home <= 99, `${matchup.home.name}: ${chance.home}`);
    assert.ok(yetToPlay(matchup.home, week).length > 0);
    for (const player of matchup.home.players) {
      const summary = playerWeek(player, week);
      assert.ok(summary.played >= 0 && summary.left >= 0);
      assert.ok(Number.isFinite(summary.total));
    }
  }
});

test('the same seed gives the same week; a different seed does not', () => {
  assert.deepEqual(demoWeek(7), demoWeek(7));
  assert.notDeepEqual(demoWeek(7).matchups[0].home.total, demoWeek(8).matchups[0].home.total);
});
