import test from 'node:test';
import assert from 'node:assert/strict';
import { finalScoreNotBefore, finalScoreUpdates, type EspnFinalMatchup } from '../server/lib/finalScoresService.ts';
import { demoWeek } from '../src/lib/league/scoresDemo.ts';

function fixture() {
  const week = structuredClone(demoWeek());
  week.matchups = week.matchups.slice(0, 1);
  week.scoringItems = [{ statId: 0, points: 1 }];
  for (const day of week.days) day.games = {};
  for (const side of [week.matchups[0].home, week.matchups[0].away]) {
    const player = side.players[0];
    player.days = Object.fromEntries(week.days.map(day => [String(day.scoringPeriodId), { lineupSlotId: 0, started: true, points: 0, stats: null, rawStats: {}, played: false, game: null }]));
    side.players = [player];
    side.total = side === week.matchups[0].home ? 100 : 90;
  }
  week.gamesCap = 30;
  const matchup = week.matchups[0];
  const raw: EspnFinalMatchup[] = [{ id: matchup.id, matchupPeriodId: week.matchupPeriodId,
    home: { teamId: matchup.home.teamId, totalPoints: 80 }, away: { teamId: matchup.away.teamId, totalPoints: 90 } }];
  return { week, raw };
}
test('final correction replaces the adjustment and retry produces no additional credit', () => {
  const { week, raw } = fixture();
  const update = finalScoreUpdates(week, raw)[0];
  assert.deepEqual(update.home, { teamId: raw[0].home.teamId, adjustment: 20, adjustmentReason: 'FBB Scores: uncapped NBA box scores and league game limit' });
  assert.equal(finalScoreUpdates(week, [{ ...raw[0], home: { ...raw[0].home, totalPoints: 100, ...update.home } }]).length, 0);
  raw[0].home.totalPoints = 85;
  raw[0].home.adjustment = 20;
  raw[0].home.adjustmentReason = 'FBB Scores: uncapped NBA box scores and league game limit';
  assert.equal((finalScoreUpdates(week, raw)[0].home as { adjustment: number }).adjustment, 35);
});
test('final correction refuses missing NBA days and unfinished games', () => {
  const { week, raw } = fixture();
  week.days[0].games = null;
  assert.throws(() => finalScoreUpdates(week, raw), /incomplete/);
  week.days[0].games = { DEN: { status: 'live', opponent: 'LAL', home: true, teamScore: 80, oppScore: 70, clock: '', minutesLeft: 5, tipoff: null } };
  assert.throws(() => finalScoreUpdates(week, raw), /unfinished/);
});
test('manual ESPN adjustments are preserved for commissioner review', () => {
  const { week, raw } = fixture();
  raw[0].home.adjustment = 5;
  raw[0].home.adjustmentReason = 'Commissioner ruling';
  assert.throws(() => finalScoreUpdates(week, raw), /manual ESPN adjustment/);
});

test('league cap removes the highest last-day game, independently of ESPN cap', () => {
  const { week, raw } = fixture();
  const side = week.matchups[0].home;
  const template = side.players[0];
  const last = String(week.days.at(-1)!.scoringPeriodId);
  side.players = Array.from({ length: 31 }, (_, index) => {
    const player = structuredClone(template);
    player.id = index + 1;
    player.days[last] = { ...player.days[last], played: true, points: index + 1 };
    return player;
  });
  side.total = 496;
  raw[0].home.totalPoints = 400;
  const update = finalScoreUpdates(week, raw)[0];
  assert.equal((update.home as { adjustment: number }).adjustment, 65, '496 - 31 = 465; correction above ESPN 400 is 65');
});
test('missing historical lineups block final writes', () => {
  const { week, raw } = fixture();
  delete week.matchups[0].home.players[0].days[String(week.days[0].scoringPeriodId)];
  assert.throws(() => finalScoreUpdates(week, raw), /historical lineup/);
});

test('the schedule gates finalization on the latest tipoff, across midnight UTC', () => {
  assert.equal(finalScoreNotBefore([{ tipoff: '2026-11-08T20:30:00Z' }, { tipoff: '2026-11-09T02:00:00Z' }]), Date.parse('2026-11-09T04:30:00Z'));
  assert.equal(finalScoreNotBefore([]), null);
});
