import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyMissedLedger, missedGamesReport, readMissedWeek, reportDate, type MissedWeek } from '../src/lib/league/missedGames.ts';
import type { ScoresWeek, ScorePlayer, WeekRef } from '../src/lib/league/scores.ts';
const teams = [{ espnTeamId: 7, owner: 'Brey' }, { espnTeamId: 1, owner: 'Ryan' }];
const now = new Date('2026-11-30T20:00:00Z');
const ref = (id: number): WeekRef => ({ matchupPeriodId: id, scoringPeriodIds: [id], startDate: '2026-10-20', endDate: '2026-10-25', label: `Week ${id}`, phase: 'regular' });
const row = (id: number, played = 29): MissedWeek => ({ season: 2027, matchupPeriodId: id, label: `Week ${id}`, endDate: '2026-10-25', espnCap: 30, status: 'final', fetchedAt: '2026-10-26', teams: [{ teamId: 7, name: 'test', played }, { teamId: 1, name: 'other', played: 30 }] });
test('three missed weeks retain eligibility; fourth loses it regardless of game count', () => {
  const ledger = emptyMissedLedger();
  for (let id = 1; id <= 4; id++) { ledger.weeks[`2027:${id}`] = row(id, id === 1 ? 25 : 29); ledger.calendar.push(ref(id)); }
  let report = missedGamesReport(ledger, 2027, teams, [], now);
  assert.equal(report.teams[0].missedWeeks, 4);
  assert.equal(report.teams[0].totalGamesMissed, 8);
  assert.equal(report.teams[0].playInEligible, false);
  assert.equal(report.teams[1].missedWeeks, 0);
  delete ledger.weeks['2027:4']; ledger.calendar.pop();
  report = missedGamesReport(ledger, 2027, teams, [], now);
  assert.equal(report.teams[0].playInEligible, true);
  assert.equal(report.teams[0].countedWeeks, 3);
});
test('provisional, incomplete and missing closed weeks cannot create penalties or imply verified eligibility', () => {
  const ledger = emptyMissedLedger(); ledger.calendar = [ref(1), ref(2), ref(3)];
  ledger.weeks['2027:1'] = { ...row(1, 0), status: 'provisional' };
  ledger.weeks['2027:2'] = { ...row(2, 0), status: 'incomplete' };
  const report = missedGamesReport(ledger, 2027, teams, [], now);
  assert.equal(report.teams[0].totalGamesMissed, 0);
  assert.equal(report.teams[0].playInEligible, null);
  assert.deepEqual(report.pendingWeeks, [1, 2, 3]);
});
test('caps are per-week and per-season; overages never become negative misses; refresh keys do not duplicate', () => {
  const ledger = emptyMissedLedger(); ledger.calendar = [ref(1)]; ledger.weeks['2027:1'] = row(1, 20); ledger.weeks['2027:1'] = row(1, 22);
  const caps = [{ season: 2027, matchupPeriodId: 1, cap: 24, updatedAt: '', updatedBy: 'Brey' }, { season: 2026, matchupPeriodId: 1, cap: 40, updatedAt: '', updatedBy: 'Brey' }];
  assert.equal(missedGamesReport(ledger, 2027, teams, caps, now).teams[0].totalGamesMissed, 2);
  caps[0].cap = 20;
  assert.equal(missedGamesReport(ledger, 2027, teams, caps, now).teams[0].totalGamesMissed, 0);
});
test('only two distinct commissioner approvals exempt a week; actual totals remain', () => {
  const ledger = emptyMissedLedger();
  for (let id = 1; id <= 4; id++) { ledger.weeks[`2027:${id}`] = row(id); ledger.calendar.push(ref(id)); }
  ledger.exemptions = [{ season: 2027, matchupPeriodId: 1, teamId: 7, reason: 'Postponement', approvals: ['Brey', 'Brey'] }];
  assert.equal(missedGamesReport(ledger, 2027, teams, [], now).teams[0].playInEligible, false);
  ledger.exemptions[0].approvals.push('Patrick');
  const result = missedGamesReport(ledger, 2027, teams, [], now).teams[0];
  assert.equal(result.playInEligible, true); assert.equal(result.countedWeeks, 3); assert.equal(result.totalGamesMissed, 4);
});
function weekFixture(): ScoresWeek {
  const player = { id: 1, days: { '1': { lineupSlotId: 0, started: true, played: true, points: 20, stats: null, game: null } } } as unknown as ScorePlayer;
  return { season: 2027, matchupPeriodId: 1, gamesCap: 30, weeks: [ref(1)], days: [{ scoringPeriodId: 1, date: '2026-10-25', games: {} }], matchups: [{ id: 1, home: { teamId: 7, name: 'A', players: [player] }, away: { teamId: 1, name: 'B', players: [structuredClone(player)] } }], fetchedAt: '2026-10-26' } as ScoresWeek;
}
test('week closes only after its end date with all schedule and roster days present', () => {
  const week = weekFixture();
  assert.equal(readMissedWeek(week, [7, 1], new Date('2026-10-26T03:00:00Z')).status, 'provisional');
  assert.equal(readMissedWeek(week, [7, 1], now).status, 'final');
  week.days[0].games = null;
  assert.equal(readMissedWeek(week, [7, 1], now).status, 'incomplete');
  week.days[0].games = {}; week.matchups[0].home.players[0].days = {};
  assert.equal(readMissedWeek(week, [7, 1], now).status, 'incomplete');
});
test('bench and DNP stat rows do not count as played games', () => {
  const week = weekFixture(); const day = week.matchups[0].home.players[0].days['1'];
  day.started = false;
  assert.equal(readMissedWeek(week, [7, 1], now).teams[0].played, 0);
  day.started = true; day.points = 0; day.stats = { gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, to: 0 };
  assert.equal(readMissedWeek(week, [7, 1], now).teams[0].played, 0);
  day.stats.gp = 1;
  assert.equal(readMissedWeek(week, [7, 1], now).teams[0].played, 1);
});
test('report uses ESPN Eastern calendar and excludes playoff matchups', () => {
  assert.equal(reportDate(new Date('2026-10-26T03:00:00Z')), '2026-10-25');
  const week = weekFixture(); week.weeks[0].phase = 'fantasy-play-in';
  assert.throws(() => readMissedWeek(week, [7, 1], now), /regular-season/);
});
