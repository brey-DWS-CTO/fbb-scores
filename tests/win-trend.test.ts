import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysIso,
  matchupChance,
  planWeek,
  readEspnWeek,
  type GameLine,
} from '../src/lib/league/scores.ts';
import {
  cachedDayUsable,
  expectedFromPreseason,
  nearestDot,
  rowsToSave,
  slateDates,
  snapshotRows,
  trendChart,
  trendRunReason,
  trimDayPayload,
  type CachedDay,
  type TrendPoint,
  type TrendRow,
} from '../src/lib/league/winTrend.ts';

// ─── A two-day week by hand ─────────────────────────────────────────────────

const SCORING = [{ statId: 0, points: 1 }, { statId: 6, points: 1 }];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ANCHOR = { scoringPeriodId: 18, date: '2026-11-05', source: 'scoring-period' } as const;
const SETTINGS = {
  seasonId: 2027,
  scoringPeriodId: 18,
  status: { currentMatchupPeriod: 3, latestScoringPeriod: 18 },
  settings: {
    scheduleSettings: { matchupPeriods: { '3': range(15, 21) } },
    scoringSettings: { scoringItems: SCORING },
  },
  teams: [
    { id: 7, name: 'Home Team', abbrev: 'HOME', record: { overall: { wins: 1, losses: 0, ties: 0 } } },
    { id: 2, name: 'Away Team', abbrev: 'AWAY', record: { overall: { wins: 0, losses: 1, ties: 0 } } },
  ],
};

interface Who { id: number; name: string; slot: number; proTeamId: number; points?: number; stats?: Record<string, number>; injuryStatus?: string }

function entry(period: number, who: Who) {
  return {
    lineupSlotId: who.slot,
    playerPoolEntry: {
      id: who.id,
      appliedStatTotal: who.points ?? 0,
      player: {
        id: who.id,
        fullName: who.name,
        defaultPositionId: 1,
        proTeamId: who.proTeamId,
        injuryStatus: who.injuryStatus ?? 'ACTIVE',
        stats: [
          ...(who.stats ? [{ statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: period, stats: who.stats }] : []),
          { statSourceId: 0, statSplitTypeId: 0, seasonId: 2027, stats: { '0': 200, '42': 10 } },
          { statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: period, seasonId: 2027, stats: { '0': 25 }, appliedTotal: 25 },
        ],
      },
    },
  };
}

function day(period: number, home: Who[], away: Who[]) {
  return {
    scoringPeriodId: period,
    teams: [{ id: 7, name: 'Home Team' }],
    schedule: [
      {
        id: 301,
        matchupPeriodId: 3,
        winner: 'UNDECIDED',
        home: { teamId: 7, totalPoints: 40, totalPointsLive: 40, pointsByScoringPeriod: { '17': 30, '18': 10 }, rosterForCurrentScoringPeriod: { entries: home.map((who) => entry(period, who)) } },
        away: { teamId: 2, totalPoints: 22, totalPointsLive: 22, pointsByScoringPeriod: { '17': 22 }, rosterForCurrentScoringPeriod: { entries: away.map((who) => entry(period, who)) } },
      },
      { id: 999, matchupPeriodId: 2, home: { teamId: 1 }, away: { teamId: 3 } },
    ],
  };
}

const line = (overrides: Partial<GameLine>): GameLine => ({
  status: 'final', opponent: 'LAL', home: true, teamScore: 100, oppScore: 90, clock: null, tipoff: null, minutesLeft: null, ...overrides,
});

const JOKIC: Who = { id: 1, name: 'Nikola Jokic', slot: 4, proTeamId: 7 };
const CURRY: Who = { id: 4, name: 'Stephen Curry', slot: 1, proTeamId: 9 };
const DROPPED: Who = { id: 9, name: 'Dropped Guy', slot: 2, proTeamId: 9 };

const DAY_17 = day(17,
  [{ ...JOKIC, points: 20, stats: { '0': 20, '42': 1 } }, { ...DROPPED, points: 10, stats: { '0': 10, '42': 1 } }],
  [{ ...CURRY, points: 22, stats: { '0': 22, '42': 1 } }]);
const DAY_18 = day(18,
  [{ ...JOKIC, points: 10, stats: { '0': 10, '42': 1 }, injuryStatus: 'DAY_TO_DAY' }],
  [CURRY]);
const GAMES_17 = { DEN: line({}), GSW: line({ opponent: 'SAC' }) };
const GAMES_18 = {
  DEN: line({ status: 'live', minutesLeft: 20, clock: '3rd Q 8:00' }),
  GSW: line({ status: 'upcoming', teamScore: null, oppScore: null, tipoff: '2026-11-06T03:00:00Z' }),
};

function fullWeek() {
  const plan = planWeek(SETTINGS, 3, ANCHOR);
  return readEspnWeek({
    plan, settings: SETTINGS, fetchedAt: '2026-11-06T01:00:00Z',
    days: [
      { scoringPeriodId: 17, date: '2026-11-04', payload: DAY_17, games: GAMES_17 },
      { scoringPeriodId: 18, date: '2026-11-05', payload: DAY_18, games: GAMES_18 },
    ],
  });
}

/** What the clock builds: today in full and first, the past day trimmed. */
function leanWeek() {
  const plan = planWeek(SETTINGS, 3, ANCHOR);
  return readEspnWeek({
    plan, settings: SETTINGS, fetchedAt: '2026-11-06T01:00:00Z',
    days: [
      { scoringPeriodId: 18, date: '2026-11-05', payload: DAY_18, games: GAMES_18 },
      { scoringPeriodId: 17, date: '2026-11-04', payload: trimDayPayload(DAY_17, 17, 3), games: GAMES_17 },
    ],
  });
}

// ─── Trimmed days ───────────────────────────────────────────────────────────

test('a trimmed past day rebuilds the same week as the full read', () => {
  const full = fullWeek();
  const lean = leanWeek();
  const byId = (week: ReturnType<typeof fullWeek>) => new Map(week.matchups[0].home.players.concat(week.matchups[0].away.players).map((player) => [player.id, player]));
  const fullPlayers = byId(full);
  const leanPlayers = byId(lean);
  assert.deepEqual([...leanPlayers.keys()].sort(), [...fullPlayers.keys()].sort());
  for (const [id, player] of fullPlayers) {
    assert.deepEqual(leanPlayers.get(id)?.days, player.days, `days for player ${id}`);
  }
  assert.equal(lean.matchups[0].home.total, full.matchups[0].home.total);
  assert.deepEqual(lean.matchups[0].home.pointsByDay, full.matchups[0].home.pointsByDay);
  // A dropped player keeps his past day, and today's read sets the injury.
  assert.equal(leanPlayers.get(9)?.days['17'].points, 10);
  assert.equal(leanPlayers.get(1)?.injuryStatus, 'DAY_TO_DAY');
  const expected = expectedFromPreseason(new Map());
  assert.deepEqual(matchupChance(lean.matchups[0], lean, expected), matchupChance(full.matchups[0], full, expected));
});

test('trimming drops totals, other weeks and season rows', () => {
  const trimmed = trimDayPayload(DAY_17, 17, 3) as { schedule: Array<Record<string, unknown>>; teams?: unknown };
  assert.equal(trimmed.teams, undefined);
  assert.equal(trimmed.schedule.length, 1);
  const home = trimmed.schedule[0].home as Record<string, unknown>;
  assert.equal(home.totalPoints, undefined);
  assert.equal(home.pointsByScoringPeriod, undefined);
  const raw = JSON.stringify(trimmed);
  assert.ok(!raw.includes('"statSplitTypeId":0'), 'no season split rows');
  assert.ok(raw.length < JSON.stringify(DAY_17).length);
});

test('a kept day is used again only when it cannot have changed', () => {
  const kept = (scoringPeriodId: number, date: string, readOn: string): CachedDay => ({ scoringPeriodId, date, readOn, payload: {}, games: null });
  assert.equal(cachedDayUsable(null, 18, '2026-11-05'), false);
  // Read after its day: final.
  assert.equal(cachedDayUsable(kept(17, '2026-11-04', '2026-11-05'), 18, '2026-11-05'), true);
  // Read on its own day, before it ended: read again.
  assert.equal(cachedDayUsable(kept(17, '2026-11-04', '2026-11-04'), 18, '2026-11-05'), false);
  // A day to come is good for the day it was read on.
  assert.equal(cachedDayUsable(kept(19, '2026-11-06', '2026-11-05'), 18, '2026-11-05'), true);
  assert.equal(cachedDayUsable(kept(19, '2026-11-06', '2026-11-04'), 18, '2026-11-05'), false);
  // Today is always read live.
  assert.equal(cachedDayUsable(kept(18, '2026-11-05', '2026-11-06'), 18, '2026-11-05'), false);
});

// ─── When the clock runs ────────────────────────────────────────────────────

test('the clock runs while a game is on, just after one ends, and at 7 AM Pacific', () => {
  const afternoon = new Date('2026-11-05T23:00:00Z'); // 3 PM Pacific
  assert.equal(trendRunReason(afternoon, [line({ status: 'live' })]), 'live');
  assert.equal(trendRunReason(afternoon, [line({ status: 'final', tipoff: '2026-11-05T21:00:00Z' })]), 'final');
  assert.equal(trendRunReason(afternoon, [line({ status: 'final', tipoff: '2026-11-05T18:00:00Z' })]), null);
  assert.equal(trendRunReason(afternoon, [line({ status: 'upcoming', tipoff: '2026-11-06T00:00:00Z' })]), null);
  assert.equal(trendRunReason(afternoon, []), null);
  assert.equal(trendRunReason(new Date('2026-11-05T15:05:00Z'), []), 'morning'); // 7:05 AM Pacific
  assert.equal(trendRunReason(new Date('2026-11-05T15:20:00Z'), []), null);
});

test('last night still counts until 6 AM in New York', () => {
  assert.deepEqual(slateDates(new Date('2026-11-06T06:30:00Z'), '2026-11-06', addDaysIso), ['2026-11-05', '2026-11-06']);
  assert.deepEqual(slateDates(new Date('2026-11-06T16:00:00Z'), '2026-11-06', addDaysIso), ['2026-11-06']);
});

// ─── What gets saved ────────────────────────────────────────────────────────

test('each matchup gets a point with its chance, score and projected finals', () => {
  const week = fullWeek();
  const expected = expectedFromPreseason(new Map());
  const [row] = snapshotRows(week, expected, '2026-11-06T01:00:00Z');
  assert.equal(row.matchupId, 301);
  assert.equal(row.homeTeamId, 7);
  assert.equal(row.awayTeamId, 2);
  assert.equal(row.homePct, matchupChance(week.matchups[0], week, expected).home);
  assert.equal(row.homePoints, 40);
  assert.equal(row.awayPoints, 22);
  assert.ok(row.homeProj > row.homePoints, 'Jokic is mid-game');
  assert.ok(row.awayProj > row.awayPoints, 'Curry has not tipped');
});

test('a point is saved only when something moved, except in the morning', () => {
  const row = (homePct: number, homePoints = 40): TrendRow => ({
    season: 2027, matchupPeriodId: 3, matchupId: 301, homeTeamId: 7, awayTeamId: 2,
    takenAt: '2026-11-06T01:00:00Z', homePct, homePoints, awayPoints: 22, homeProj: 80, awayProj: 70,
  });
  const last = new Map<number, TrendPoint>([[301, row(60)]]);
  assert.equal(rowsToSave([row(60)], last, 'live').length, 0);
  assert.equal(rowsToSave([row(61)], last, 'live').length, 1);
  assert.equal(rowsToSave([row(60, 42)], last, 'final').length, 1);
  assert.equal(rowsToSave([row(60)], last, 'morning').length, 1);
  assert.equal(rowsToSave([row(60)], new Map(), 'live').length, 1);
});

// ─── The chart ──────────────────────────────────────────────────────────────

test('the chart spaces points evenly, oldest first, home on top', () => {
  const point = (takenAt: string, homePct: number): TrendPoint => ({ matchupId: 301, takenAt, homePct, homePoints: 0, awayPoints: 0, homeProj: 0, awayProj: 0 });
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];
  const chart = trendChart([
    point('2026-11-03T23:30:00Z', 25),
    point('2026-11-02T14:00:00Z', 100),
    point('2026-11-03T23:45:00Z', 50),
  ], dates, 100, 50);
  assert.deepEqual(chart.dots.map((dot) => [dot.x, dot.y]), [[0, 0], [50, 37.5], [100, 25]]);
  assert.equal(chart.midY, 25);
  // A day with no points gets no mark.
  assert.deepEqual(chart.days, [{ x: 0, date: '2026-11-02' }, { x: 50, date: '2026-11-03' }]);
  assert.equal(chart.path, 'M0 0 L50 37.5 L100 25');
  assert.equal(nearestDot(chart.dots, 80)?.point.homePct, 50);
  assert.equal(nearestDot(chart.dots, 60)?.point.homePct, 25);
  assert.equal(nearestDot([], 70), null);
  assert.equal(trendChart([], [], 100, 50).path, '');
});
