import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeeklyLineup } from '../src/lib/league/weeklyLineup.ts';
import type { LineupSnapshot } from '../src/lib/league/lineup.ts';
import type { ScorePlayer, ScoresWeek, ScoreSide, GameLine } from '../src/lib/league/scores.ts';
const game: GameLine = { status: 'upcoming', tipoff: '2027-01-02T20:00:00Z', opponent: 'BOS', home: true, teamScore: null, oppScore: null, clock: null, minutesLeft: null };
function fixture() {
  const players: ScorePlayer[] = [1, 2, 3].map(id => ({ id, name: String(id), position: 'G', proTeamId: id, proTeam: String(id), injuryStatus: null, seasonAvg: 10, last7: null, last15: null, last30: null, projByDay: {}, days: {} }));
  const snapshot: LineupSnapshot = { leagueId: '1', teamId: 7, scoringPeriodId: 1, revision: 'a', fetchedAt: '', lockMode: 'individual', periodLockAt: null,
    players: players.map(p => ({ id: p.id, name: p.name, eligibleSlotIds: p.id === 1 ? [0, 1] : [0], locked: false, lockAt: null })),
    slots: [{ id: 'pg', label: 'PG', eligibilityId: 0, playerId: 1, kind: 'starter' }, { id: 'sg', label: 'SG', eligibilityId: 1, playerId: 2, kind: 'starter' }] };
  const side: ScoreSide = { teamId: 7, name: 'test', abbrev: 'T', record: { wins: 0, losses: 0, ties: 0 }, total: 0, pointsByDay: {}, players };
  const week = { days: [1, 2].map(scoringPeriodId => ({ scoringPeriodId, date: '2027-01-02', games: { '1': { ...game }, '2': { ...game }, '3': { ...game } } })) } as ScoresWeek;
  return { snapshot, side, week };
}
const expected = (p: ScorePlayer) => ({ 1: 50, 2: 40, 3: 30 })[p.id]!;
const now = Date.parse('2027-01-01');
test('finds legal daily assignments and optimizes across the weekly cap', () => {
  const { snapshot, side, week } = fixture();
  const plan = planWeeklyLineup(snapshot, side, week, 3, expected, now);
  assert.equal(plan.starts.length, 3);
  assert.equal(plan.projectedTotal, 140);
  assert.equal(plan.starts.filter(s => s.playerId === 1).length, 2);
  assert.ok(plan.starts.filter(s => s.playerId === 1).some(s => s.slot === 'SG'));
  assert.equal(new Set(plan.starts.map(s => `${s.period}:${s.slot}`)).size, 3);
  assert.equal(planWeeklyLineup(snapshot, side, week, 1, expected, now).projectedTotal, 50);
});
test('does not recommend out, reserve, or already-started games', () => {
  const { snapshot, side, week } = fixture();
  side.players[0].injuryStatus = 'OUT';
  snapshot.slots.push({ id: 'ir', label: 'IR', eligibilityId: 13, playerId: 2, kind: 'reserve' });
  const plan = planWeeklyLineup(snapshot, side, week, 30, expected, now);
  assert.deepEqual(plan.starts.map(s => s.playerId), [3, 3]);
});
test('past counted games use budget even when the player has left current roster', () => {
  const { snapshot, side, week } = fixture();
  snapshot.players = snapshot.players.filter(p => p.id !== 1);
  week.days[0].games!['1'].status = 'final';
  side.players[0].days['1'] = { lineupSlotId: 0, started: true, points: 75, stats: null, played: true, game: null };
  const plan = planWeeklyLineup(snapshot, side, week, 2, expected, now);
  assert.equal(plan.used, 1);
  assert.equal(plan.starts.length, 1);
  assert.equal(plan.projectedTotal, 115);
});
test('missing schedule and tipoff are reported and do not invent starts', () => {
  const { snapshot, side, week } = fixture();
  week.days[0].games = null;
  for (const game of Object.values(week.days[1].games!)) game.tipoff = null;
  const plan = planWeeklyLineup(snapshot, side, week, 30, expected, now);
  assert.equal(plan.starts.length, 0);
  assert.equal(plan.warnings.length, 2);
});
