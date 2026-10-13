import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysIso,
  beforeSeason,
  dateRangeText,
  daysBetween,
  defaultDay,
  espnToday,
  expandWeekNumbers,
  firstRegularSeasonDate,
  gameText,
  gamesCapFor,
  gamesLeft,
  gamesPlayed,
  injuryBadge,
  latestSlot,
  lineupOrder,
  matchupChance,
  orderForViewer,
  ownerByEspnTeamId,
  planWeek,
  playerWeek,
  readCurrentScoringPeriod,
  readEspnWeek,
  readNbaScoreboard,
  recordText,
  scoringPeriodDates,
  seasonStartDate,
  shortName,
  sideOdds,
  slotLabel,
  slotOn,
  statLineText,
  weekLabel,
  weekOrder,
  yetToPlay,
  type GameLine,
  type ScoreMatchup,
  type ScorePlayer,
  type ScoreSide,
  type ScoresWeek,
} from '../src/lib/league/scores.ts';

// ─── A small ESPN week by hand ──────────────────────────────────────────────

const SCORING = [
  { statId: 0, points: 1 },
  { statId: 6, points: 1 },
  { statId: 3, points: 1.4 },
  { statId: 2, points: 2.5 },
  { statId: 1, points: 2.5 },
  { statId: 17, points: 0.5 },
  { statId: 11, points: -1.8 },
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 7:30 PM in New York on an ISO date, as the epoch ms ESPN sends. */
const tipMs = (iso: string) => Date.parse(`${iso}T19:30:00-05:00`);

/** In season: ESPN's current scoring period is today. */
const TODAY_ANCHOR = { scoringPeriodId: 18, date: '2026-11-05', source: 'scoring-period' } as const;

const SETTINGS = {
  seasonId: 2027,
  scoringPeriodId: 18,
  status: { currentMatchupPeriod: 3, latestScoringPeriod: 18 },
  settings: {
    scheduleSettings: {
      matchupPeriods: { '1': range(1, 7), '2': range(8, 14), '3': range(15, 21), '4': range(22, 28) },
    },
    rosterSettings: { lineupSlotStatLimits: { '15': { statId: 42, limitValue: 30 / 7 } } },
    scoringSettings: { scoringItems: SCORING },
    proTeams: [
      { id: 13, abbrev: 'LAL', proGamesByScoringPeriod: { '15': [{ date: tipMs('2026-11-02') }] } },
    ],
  },
  teams: [
    {
      id: 7,
      name: 'Mamu, There Goes That Amen',
      abbrev: 'MAMU',
      record: { overall: { wins: 2, losses: 0, ties: 0 } },
      roster: {
        entries: [
          {
            playerPoolEntry: {
              id: 1,
              player: {
                id: 1,
                fullName: 'Nikola Jokic',
                stats: [
                  { statSplitTypeId: 0, statSourceId: 0, seasonId: 2027, stats: { '0': 300, '6': 120, '3': 90, '42': 10 } },
                ],
              },
            },
          },
        ],
      },
    },
    { id: 2, name: 'Tu Mamacita', abbrev: 'TU', record: { overall: { wins: 1, losses: 1, ties: 0 } } },
  ],
};

interface EntryInput {
  id: number;
  name: string;
  slot: number;
  position: number;
  proTeamId: number;
  injuryStatus?: string;
  stats?: Record<string, number>;
  points?: number;
}

function entry(scoringPeriodId: number, input: EntryInput) {
  return {
    lineupSlotId: input.slot,
    playerPoolEntry: {
      id: input.id,
      appliedStatTotal: input.points ?? 0,
      player: {
        id: input.id,
        fullName: input.name,
        defaultPositionId: input.position,
        proTeamId: input.proTeamId,
        injuryStatus: input.injuryStatus ?? 'ACTIVE',
        stats: input.stats
          ? [{ statSourceId: 0, statSplitTypeId: 1, scoringPeriodId, stats: input.stats }]
          : [],
      },
    },
  };
}

const JOKIC_DAY = { '0': 32, '6': 11, '3': 6, '2': 2, '1': 1, '17': 3, '11': 2, '42': 1 };
/** 32 + 11 + 6 × 1.4 + 2 × 2.5 + 2.5 + 3 × 0.5 − 2 × 1.8 in league scoring. */
const JOKIC_DAY_POINTS = 56.8;

function dayPayload(scoringPeriodId: number, home: EntryInput[], away: EntryInput[], extra: Record<string, unknown> = {}) {
  return {
    seasonId: 2027,
    scoringPeriodId,
    schedule: [
      {
        id: 301,
        matchupPeriodId: 3,
        winner: 'UNDECIDED',
        home: {
          teamId: 7,
          totalPoints: 400,
          totalPointsLive: 456.8,
          pointsByScoringPeriod: { '17': 56.8 },
          rosterForCurrentScoringPeriod: { entries: home.map((input) => entry(scoringPeriodId, input)) },
          ...extra,
        },
        away: {
          teamId: 2,
          totalPoints: 380,
          rosterForCurrentScoringPeriod: { entries: away.map((input) => entry(scoringPeriodId, input)) },
        },
      },
      { id: 999, matchupPeriodId: 2, home: { teamId: 1 }, away: { teamId: 3 } },
    ],
  };
}

const line = (overrides: Partial<GameLine>): GameLine => ({
  status: 'final', opponent: 'LAL', home: true, teamScore: 112, oppScore: 104, clock: null, tipoff: null, minutesLeft: null, ...overrides,
});

const JOKIC: EntryInput = { id: 1, name: 'Nikola Jokic', slot: 4, position: 5, proTeamId: 7 };
const DONCIC: EntryInput = { id: 2, name: 'Luka Doncic', slot: 0, position: 1, proTeamId: 13, injuryStatus: 'OUT' };
const BENCH: EntryInput = { id: 3, name: 'Bench Guy', slot: 12, position: 2, proTeamId: 7 };
const CURRY: EntryInput = { id: 4, name: 'Stephen Curry', slot: 1, position: 1, proTeamId: 9 };
const GIANNIS: EntryInput = { id: 5, name: 'Giannis Antetokounmpo', slot: 3, position: 4, proTeamId: 15 };

const DAY_17_GAMES: Record<string, GameLine> = {
  DEN: line({}),
  LAL: line({ opponent: 'DEN', home: false, teamScore: 104, oppScore: 112 }),
  GSW: line({ opponent: 'SAC', teamScore: 120, oppScore: 118 }),
};
const DAY_18_GAMES: Record<string, GameLine> = {
  DEN: line({ status: 'upcoming', opponent: 'PHX', home: false, teamScore: null, oppScore: null, tipoff: '2026-11-06T02:30:00Z' }),
  GSW: line({ status: 'live', opponent: 'MIL', teamScore: 78, oppScore: 70, clock: '3rd Q 5:32', minutesLeft: 12 + 5.53 }),
  MIL: line({ status: 'live', opponent: 'GSW', home: false, teamScore: 70, oppScore: 78, clock: '3rd Q 5:32', minutesLeft: 12 + 5.53 }),
};

function buildWeek(): ScoresWeek {
  const plan = planWeek(SETTINGS, 3, TODAY_ANCHOR);
  return readEspnWeek({
    plan,
    settings: SETTINGS,
    fetchedAt: '2026-11-05T20:00:00Z',
    days: [
      {
        scoringPeriodId: 17,
        date: '2026-11-04',
        games: DAY_17_GAMES,
        payload: dayPayload(17,
          [{ ...JOKIC, stats: JOKIC_DAY, points: JOKIC_DAY_POINTS }, DONCIC, { ...BENCH, stats: { '0': 10, '42': 1 }, points: 10 }],
          [{ ...CURRY, stats: { '0': 30, '17': 6, '42': 1 }, points: 33 }, GIANNIS]),
      },
      {
        scoringPeriodId: 18,
        date: '2026-11-05',
        games: DAY_18_GAMES,
        payload: dayPayload(18,
          [JOKIC, DONCIC, BENCH],
          [{ ...CURRY, stats: { '0': 14, '42': 1 }, points: 14 }, { ...GIANNIS, stats: { '0': 20, '6': 8, '42': 1 }, points: 28 }]),
      },
    ],
  });
}

// ─── The plan ───────────────────────────────────────────────────────────────

test('the plan lists the week\'s days, dated from the pro schedule and counted out from today', () => {
  const plan = planWeek(SETTINGS, null, TODAY_ANCHOR);
  assert.equal(plan.matchupPeriodId, 3);
  assert.equal(plan.currentScoringPeriodId, 18);
  assert.equal(plan.anchor.source, 'pro-schedule', 'a date ESPN names beats the anchor passed in');
  assert.deepEqual(plan.days.map((day) => day.scoringPeriodId), range(15, 21));
  // Scoring period 15 comes from LAL's tip-off; the rest count out from today, period 18.
  assert.deepEqual(plan.days.map((day) => day.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(plan.gamesCap, 30);
  assert.deepEqual(plan.weeks.map((week) => week.label), ['Week 1', 'Week 2', 'Week 3', 'Week 4']);
  assert.equal(plan.weeks[2].startDate, '2026-11-02');
  assert.equal(plan.weeks[2].endDate, '2026-11-08');
  assert.equal(plan.season, 2027);
});

/**
 * What ESPN really sent for this league on 12 October 2026: week numbers,
 * not days, in `matchupPeriods`; no pro-team schedule; the season not
 * started (scoringPeriodId 0). The regular season opens Tuesday 20 October.
 */
const LIVE_SETTINGS = {
  seasonId: 2027,
  scoringPeriodId: 0,
  status: { currentMatchupPeriod: 1 },
  settings: {
    scheduleSettings: {
      matchupPeriods: {
        ...Object.fromEntries(range(1, 18).map((week) => [String(week), [week]])),
        '19': [19, 20],
        '20': [21, 22],
      },
    },
  },
  teams: [{ id: 2, name: 'Tu  Mamacita', abbrev: 'TU' }],
};

const OPENING_NIGHT = { scoringPeriodId: 1, date: '2026-10-20', source: 'opening-night' } as const;

test('ESPN\'s week numbers become Monday-to-Sunday days anchored on opening night', () => {
  const plan = planWeek(LIVE_SETTINGS, null, OPENING_NIGHT);
  assert.equal(plan.matchupPeriodId, 1);
  assert.equal(plan.currentScoringPeriodId, 0);
  assert.equal(plan.anchor.source, 'opening-night');
  // Opening night is scoring period 1; Monday 19 October has none, so week 1 is six days.
  assert.deepEqual(plan.days.map((day) => day.scoringPeriodId), range(1, 6));
  assert.deepEqual(plan.days.map((day) => day.date), ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(plan.gamesCap, 26);
  assert.equal(plan.weeks.length, 20);
  assert.deepEqual([plan.weeks[0].label, plan.weeks[0].startDate, plan.weeks[0].endDate], ['Week 1', '2026-10-20', '2026-10-25']);
  assert.deepEqual([plan.weeks[1].startDate, plan.weeks[1].scoringPeriodIds[0], plan.weeks[1].scoringPeriodIds.length], ['2026-10-26', 7, 7]);
  assert.deepEqual([plan.weeks[16].label, plan.weeks[16].startDate], ['Play-In 1', '2027-02-08']);
  assert.deepEqual([plan.weeks[17].label, plan.weeks[17].startDate, plan.weeks[17].endDate], ['Play-In 2', '2027-02-15', '2027-02-21']);
  // ESPN's two-week playoff rounds: fourteen days each, and no league label fits their start.
  assert.deepEqual([plan.weeks[18].label, plan.weeks[18].startDate, plan.weeks[18].scoringPeriodIds.length], ['Week 19', '2027-02-22', 14]);
  assert.deepEqual([plan.weeks[19].startDate, plan.weeks[19].endDate], ['2027-03-08', '2027-03-21']);
  // Before the season the week opens on its first day.
  assert.equal(defaultDay({ days: plan.days.map((day) => ({ ...day, games: null })), currentScoringPeriodId: 0 }), 1);
  assert.equal(planWeek(LIVE_SETTINGS, 19, OPENING_NIGHT).days.length, 14);

  const week = readEspnWeek({
    plan, settings: LIVE_SETTINGS, fetchedAt: 'now',
    days: [{ scoringPeriodId: 1, date: '2026-10-20', games: null, payload: { schedule: [{ id: 2, matchupPeriodId: 1, home: { teamId: 2 }, away: { teamId: 7 } }] } }],
  });
  assert.equal(week.matchups[0].home.name, 'Tu Mamacita', 'one space is enough');
});

test('in season the current scoring period is today, and a pro schedule date wins over any anchor', () => {
  // Week 3 on Thursday 5 November: scoring period 17 is today.
  const plan = planWeek(LIVE_SETTINGS, null, { scoringPeriodId: 17, date: '2026-11-05', source: 'scoring-period' });
  assert.deepEqual([plan.weeks[2].startDate, plan.weeks[2].endDate, plan.weeks[2].scoringPeriodIds[0]], ['2026-11-02', '2026-11-08', 14]);
  assert.equal(plan.anchor.source, 'scoring-period');

  // ESPN lists preseason games too: scoring period 1 on 14 October, so week 1 starts at period 6.
  const withSchedule = {
    ...LIVE_SETTINGS,
    settings: {
      ...LIVE_SETTINGS.settings,
      proTeams: [{ id: 14, proGamesByScoringPeriod: { '1': [{ date: Date.parse('2026-10-14T19:30:00-04:00') }] } }],
    },
  };
  const listed = planWeek(withSchedule, null, OPENING_NIGHT);
  assert.equal(listed.anchor.source, 'pro-schedule');
  assert.deepEqual(listed.days.map((day) => day.scoringPeriodId), range(6, 12));
  assert.deepEqual([listed.days[0].date, listed.days[6].date], ['2026-10-19', '2026-10-25']);
});

test('opening night is the first date with a regular-season game on the public scoreboard', () => {
  const pre = { events: [{ season: { type: 1, slug: 'preseason' } }] };
  const regular = { events: [{ season: { type: 2, slug: 'regular-season' } }] };
  assert.equal(firstRegularSeasonDate([
    { date: '2026-10-21', payload: regular },
    { date: '2026-10-19', payload: { events: [] } },
    { date: '2026-10-20', payload: regular },
    { date: '2026-10-18', payload: pre },
  ]), '2026-10-20');
  assert.equal(firstRegularSeasonDate([{ date: '2026-10-19', payload: null }, { date: '2026-10-20', payload: pre }]), null);
  assert.equal(firstRegularSeasonDate([{ date: '2026-10-20', payload: { events: [{ season: { slug: 'regular-season' } }] } }]), '2026-10-20');
  assert.equal(firstRegularSeasonDate([]), null);
  assert.equal(readCurrentScoringPeriod({ scoringPeriodId: 0 }), 0);
  assert.equal(readCurrentScoringPeriod({ status: { latestScoringPeriod: 9 } }), 9);
  assert.equal(readCurrentScoringPeriod(undefined), 0);
});

test('days listed outright pass through, and the two forms are told apart by size', () => {
  const days = expandWeekNumbers([{ matchupPeriodId: 1, values: range(1, 7) }, { matchupPeriodId: 2, values: range(8, 14) }], 6);
  assert.deepEqual(days.map((entry) => entry.scoringPeriodIds), [range(1, 7), range(8, 14)]);
  const weeks = expandWeekNumbers([{ matchupPeriodId: 1, values: [1] }, { matchupPeriodId: 2, values: [2, 3] }], 6);
  assert.deepEqual(weeks.map((entry) => entry.scoringPeriodIds), [range(6, 12), range(13, 26)]);
  // A Monday before opening night has no scoring period: week 1 loses it and runs short.
  const short = expandWeekNumbers([{ matchupPeriodId: 1, values: [1] }, { matchupPeriodId: 2, values: [2] }], 0);
  assert.deepEqual(short.map((entry) => entry.scoringPeriodIds), [range(1, 6), range(7, 13)]);
  assert.equal(daysBetween('2026-10-14', '2026-10-19'), 5);
  assert.equal(daysBetween('2026-10-19', '2026-10-14'), -5);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('asking for a week by number works, and the missing ones say so', () => {
  assert.equal(planWeek(SETTINGS, 2, TODAY_ANCHOR).days[0].scoringPeriodId, 8);
  assert.throws(() => planWeek(SETTINGS, 9, TODAY_ANCHOR), /unknown-week/);
  assert.throws(() => planWeek({}, null, TODAY_ANCHOR), /no-schedule/);
  assert.throws(() => planWeek(null, null, TODAY_ANCHOR), /no-schedule/);
});

test('a late West Coast tip still lands on its own date in New York', () => {
  // 10:30 PM Pacific on 2 November is 1:30 AM Eastern on the 3rd; ESPN files it under the 3rd.
  const dates = scoringPeriodDates([{ proGamesByScoringPeriod: { '16': [{ date: Date.parse('2026-11-02T22:30:00-08:00') }] } }]);
  assert.equal(dates.get(16), '2026-11-03');
  // The earliest tip wins when a period has several games.
  const two = scoringPeriodDates([{ proGamesByScoringPeriod: { '16': [{ date: tipMs('2026-11-03') }, { date: tipMs('2026-11-02') }] } }]);
  assert.equal(two.get(16), '2026-11-02');
  assert.equal(scoringPeriodDates(undefined).size, 0);
});

test('the games cap reads ESPN\'s per-day limit, a whole-week limit, or falls back to 30 a week', () => {
  assert.equal(gamesCapFor({ lineupSlotStatLimits: { '15': { statId: 42, limitValue: 30 / 7 } } }, 7), 30);
  assert.equal(gamesCapFor({ lineupSlotStatLimits: { '15': { statId: 42, limitValue: 30 / 7 } } }, 14), 60);
  assert.equal(gamesCapFor({ lineupSlotStatLimits: { '15': { statId: 42, limitValue: 31 } } }, 7), 31);
  assert.equal(gamesCapFor({ lineupSlotStatLimits: { '15': { statId: 0, limitValue: 5 } } }, 7), 30);
  assert.equal(gamesCapFor(undefined, 14), 60);
  assert.equal(gamesCapFor(undefined, 10), 43);
});

test('week labels follow the league schedule by start date', () => {
  assert.deepEqual(weekLabel(1, '2026-10-19'), { label: 'Week 1', phase: 'regular' });
  assert.deepEqual(weekLabel(17, '2027-02-08'), { label: 'Play-In 1', phase: 'fantasy-play-in' });
  assert.deepEqual(weekLabel(18, '2027-02-15'), { label: 'Play-In 2', phase: 'fantasy-play-in' });
  assert.deepEqual(weekLabel(19, '2027-03-01'), { label: 'Playoff Round 1', phase: 'fantasy-playoff' });
  assert.deepEqual(weekLabel(21, '2027-03-15'), { label: 'Playoff Round 2', phase: 'fantasy-playoff' });
  // The second week of a round is not the round. ESPN's last period starts here.
  assert.deepEqual(weekLabel(20, '2027-03-08'), { label: 'Week 20', phase: 'fantasy-playoff' });
  assert.deepEqual(weekLabel(22, '2027-03-22'), { label: 'Week 22', phase: 'fantasy-playoff' });
  assert.deepEqual(weekLabel(5, '2030-01-01'), { label: 'Week 5', phase: 'regular' });
});

test('names shorten to an initial and the surname', () => {
  assert.equal(shortName('Giannis Antetokounmpo'), 'G. Antetokounmpo');
  assert.equal(shortName('Shai Gilgeous-Alexander'), 'S. Gilgeous-Alexander');
  assert.equal(shortName('Gary Payton II'), 'G. Payton II');
  assert.equal(shortName('Nene'), 'Nene');
  assert.equal(shortName('  Luka   Doncic '), 'L. Doncic');
});

test('ESPN\'s today is New York\'s, not the server\'s', () => {
  // 1 AM in New York on the 6th is the 6th; 10 PM in New York on the 5th is still the 5th
  // even though the server's UTC clock already says the 6th.
  assert.equal(espnToday(new Date('2026-11-06T06:00:00Z')), '2026-11-06');
  assert.equal(espnToday(new Date('2026-11-06T03:00:00Z')), '2026-11-05');
});

test('the season starts on the first Monday of week 1', () => {
  assert.equal(seasonStartDate(), '2026-10-19');
  assert.ok(beforeSeason('2026-10-18'));
  assert.ok(!beforeSeason('2026-10-19'));
  assert.equal(addDaysIso('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysIso('2026-11-01', -1), '2026-10-31');
  assert.equal(dateRangeText('2026-11-02', '2026-11-08'), 'Nov 2 to Nov 8');
});

// ─── Reading the week ───────────────────────────────────────────────────────

test('the week carries both sides, their records, totals and day scores', () => {
  const week = buildWeek();
  assert.equal(week.matchups.length, 1, 'only this week\'s matchup, not the one from week 2');
  const [matchup] = week.matchups;
  assert.equal(matchup.id, 301);
  assert.equal(matchup.home.name, 'Mamu, There Goes That Amen');
  assert.equal(recordText(matchup.home.record), '2-0');
  assert.equal(matchup.home.total, 456.8, 'the live total beats the settled one');
  assert.equal(matchup.away.total, 380, 'no live total, so the settled one');
  assert.equal(matchup.home.pointsByDay['17'], 56.8, 'ESPN\'s own day score when it sends one');
  assert.equal(matchup.away.pointsByDay['17'], 33, 'the started players\' points when it does not');
  assert.equal(matchup.away.pointsByDay['18'], 42);
  assert.equal(week.days.length, 7);
  assert.equal(week.days[2].games, DAY_17_GAMES);
  assert.equal(week.days[4].games, null, 'a day never fetched has no games');
});

test('a player\'s day is his own stat row, his slot and his game', () => {
  const week = buildWeek();
  const jokic = week.matchups[0].home.players.find((player) => player.name === 'Nikola Jokic') as ScorePlayer;
  assert.equal(jokic.position, 'C');
  assert.equal(jokic.proTeam, 'DEN');
  assert.equal(jokic.seasonAvg, 54.6, 'season totals over games played, in league scoring');
  const day = jokic.days['17'];
  assert.ok(day.started);
  assert.equal(day.points, JOKIC_DAY_POINTS);
  assert.equal(day.stats?.pts, 32);
  assert.ok(day.played);
  assert.equal(statLineText(day.stats), '32 PTS, 11 REB, 6 AST, 2 STL, 1 BLK, 3 3PM, 2 TO');
  assert.equal(gameText(day.game, null), 'Final W 112-104 vs LAL');
  const today = jokic.days['18'];
  assert.equal(today.stats, null, 'no row for a game not played; the season row is never a day');
  assert.ok(!today.played);
  assert.equal(gameText(today.game, '7:30 PM'), '7:30 PM @ PHX');

  const bench = week.matchups[0].home.players.find((player) => player.name === 'Bench Guy') as ScorePlayer;
  assert.ok(!bench.days['17'].started);
  const curry = week.matchups[0].away.players.find((player) => player.name === 'Stephen Curry') as ScorePlayer;
  assert.equal(gameText(curry.days['18'].game, null), '3rd Q 5:32 78-70 vs MIL');
  assert.equal(curry.seasonAvg, null);
});

test('words for the screen cover every game state', () => {
  assert.equal(gameText(null, null), 'No game');
  assert.equal(gameText(line({ status: 'off', home: false }), null), 'Postponed @ LAL');
  assert.equal(gameText(line({ teamScore: 100, oppScore: 110 }), null), 'Final L 100-110 vs LAL');
  assert.equal(gameText(line({ teamScore: 100, oppScore: 100 }), null), 'Final T 100-100 vs LAL');
  assert.equal(gameText(line({ teamScore: null, oppScore: null }), null), 'Final vs LAL');
  assert.equal(gameText(line({ status: 'live', clock: null, teamScore: 10, oppScore: 8 }), null), 'Live 10-8 vs LAL');
  assert.equal(gameText(line({ status: 'upcoming', teamScore: null, oppScore: null }), null), 'Today vs LAL');
  assert.equal(statLineText(null), '');
  assert.equal(statLineText({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, threes: 0, to: 0, min: 0, gp: 1 }), '0 PTS');
  assert.equal(recordText({ wins: 3, losses: 1, ties: 1 }), '3-1-1');
});

test('nothing crashes on a payload with nothing in it', () => {
  const plan = planWeek(SETTINGS, 3, TODAY_ANCHOR);
  const empty = readEspnWeek({ plan, settings: {}, fetchedAt: 'now', days: [{ scoringPeriodId: 15, date: '2026-11-02', payload: {}, games: null }] });
  assert.deepEqual(empty.matchups, []);
  assert.equal(empty.days.length, 7);
  const odd = readEspnWeek({
    plan, settings: null, fetchedAt: 'now',
    days: [{ scoringPeriodId: 15, date: '2026-11-02', games: null, payload: { schedule: [{ id: 5, matchupPeriodId: 3, home: { teamId: 1, rosterForCurrentScoringPeriod: { entries: [{}, { playerPoolEntry: {} }, { playerPoolEntry: { id: 9 } }] } }, away: { teamId: 2 } }] } }],
  });
  assert.equal(odd.matchups.length, 1);
  assert.equal(odd.matchups[0].home.name, 'Team 1');
  assert.equal(odd.matchups[0].home.players.length, 1);
  assert.equal(odd.matchups[0].home.players[0].name, 'Player 9');
  assert.equal(odd.matchups[0].home.total, 0);
});

// ─── The public NBA scoreboard ──────────────────────────────────────────────

test('the public scoreboard gives both teams a line, in ESPN fantasy codes', () => {
  const games = readNbaScoreboard({
    events: [
      {
        date: '2026-11-06T02:30Z',
        competitions: [{
          date: '2026-11-06T02:30Z',
          status: { clock: 332, displayClock: '5:32', period: 3, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
          competitors: [
            { homeAway: 'home', score: '78', team: { abbreviation: 'GS' } },
            { homeAway: 'away', score: '70', team: { abbreviation: 'MIL' } },
          ],
        }],
      },
      {
        competitions: [{
          status: { type: { name: 'STATUS_FINAL', state: 'post' } },
          competitors: [
            { homeAway: 'away', score: '104', team: { abbreviation: 'LAL' } },
            { homeAway: 'home', score: '112', team: { abbreviation: 'DEN' } },
          ],
        }],
      },
      {
        competitions: [{
          date: '2026-11-06T00:00Z',
          status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
          competitors: [
            { homeAway: 'home', team: { abbreviation: 'NY' } },
            { homeAway: 'away', team: { abbreviation: 'UTAH' } },
          ],
        }],
      },
      {
        competitions: [{
          status: { type: { name: 'STATUS_HALFTIME', state: 'in' }, period: 2 },
          competitors: [
            { homeAway: 'home', score: '50', team: { abbreviation: 'SA' } },
            { homeAway: 'away', score: '55', team: { abbreviation: 'WSH' } },
          ],
        }],
      },
      { competitions: [{ competitors: [{ homeAway: 'home' }] }] },
    ],
  });
  assert.equal(games.GSW.status, 'live');
  assert.equal(games.GSW.clock, '3rd Q 5:32');
  assert.equal(games.GSW.opponent, 'MIL');
  assert.ok(games.GSW.home);
  assert.deepEqual([games.GSW.teamScore, games.GSW.oppScore], [78, 70]);
  assert.ok(Math.abs((games.GSW.minutesLeft ?? 0) - (12 + 332 / 60)) < 1e-9);
  assert.equal(games.MIL.opponent, 'GSW');
  assert.ok(!games.MIL.home);
  assert.equal(games.DEN.status, 'final');
  assert.deepEqual([games.LAL.teamScore, games.LAL.oppScore], [104, 112]);
  assert.equal(games.NYK.status, 'upcoming');
  assert.equal(games.NYK.teamScore, null);
  assert.equal(games.NYK.tipoff, '2026-11-06T00:00Z');
  assert.equal(games.UTA.opponent, 'NYK');
  assert.equal(games.SAS.clock, 'Half');
  assert.equal(games.WAS.status, 'live');
  assert.equal(Object.keys(games).length, 8);
  assert.deepEqual(readNbaScoreboard(undefined), {});
});

// ─── Games left and the odds ────────────────────────────────────────────────

test('games left: today if unfinished, known future days, and the grid for days nobody could read', () => {
  const week = buildWeek();
  const home = week.matchups[0].home;
  const jokic = home.players.find((player) => player.name === 'Nikola Jokic') as ScorePlayer;
  const left = gamesLeft(jokic, week);
  // Today's game has not tipped (share 1). Days 19 to 21 were never read: the
  // grid gives Denver 3 games in week 3, two are known, so one game is spread
  // over the three unread days.
  assert.deepEqual(left.map((game) => game.scoringPeriodId), [18, 19, 20, 21]);
  assert.equal(left[0].share, 1);
  assert.ok(!left[0].live);
  for (const game of left.slice(1)) assert.ok(Math.abs(game.share - 1 / 3) < 1e-9);
  assert.deepEqual(playerWeek(jokic, week), { total: JOKIC_DAY_POINTS, played: 1, left: 2 });

  const doncic = home.players.find((player) => player.name === 'Luka Doncic') as ScorePlayer;
  assert.deepEqual(gamesLeft(doncic, week), [], 'OUT means no games to come');

  const bench = home.players.find((player) => player.name === 'Bench Guy') as ScorePlayer;
  assert.deepEqual(gamesLeft(bench, week), [], 'the bench does not score');
  assert.deepEqual(playerWeek(bench, week), { total: 0, played: 0, left: 0 });

  const curry = week.matchups[0].away.players.find((player) => player.name === 'Stephen Curry') as ScorePlayer;
  const curryLeft = gamesLeft(curry, week);
  assert.ok(curryLeft[0].live);
  assert.ok(Math.abs(curryLeft[0].share - (12 + 5.53) / 48) < 1e-9);
  assert.equal(playerWeek(curry, week).played, 2);

  assert.deepEqual(yetToPlay(home, week).map((player) => player.name), ['Nikola Jokic']);
});

test('a day with no game for the team, and a day already final, add nothing', () => {
  const week = buildWeek();
  const giannis = week.matchups[0].away.players.find((player) => player.name === 'Giannis Antetokounmpo') as ScorePlayer;
  // Day 17 had no MIL game; today MIL is live.
  const left = gamesLeft(giannis, week);
  assert.equal(left.length, 4);
  assert.ok(left[0].live);
});

test('the odds use expected points per game and stop at the games cap', () => {
  const week = buildWeek();
  const [matchup] = week.matchups;
  const expected = (player: ScorePlayer) => (player.name === 'Nikola Jokic' ? 60 : 30);
  const home = sideOdds(matchup.home, week, expected);
  assert.equal(home.points, 456.8);
  assert.equal(home.remaining.length, 4);
  assert.equal(home.remaining[0].expected, 60);

  // A cap with no room left keeps only the live games.
  const capped = sideOdds(matchup.away, { ...week, gamesCap: 0 }, expected);
  assert.ok(capped.remaining.every((game) => game.share !== undefined && game.share < 1), 'only the live game shares survive');
  assert.equal(capped.remaining.length, 2);
  // Room for one whole game: the first future game in date order fills it.
  const one = sideOdds(matchup.home, { ...week, gamesCap: 2 }, expected);
  assert.equal(one.remaining.length, 1);
  assert.equal(one.remaining[0].share, 1);

  const chance = matchupChance(matchup, week, expected);
  assert.equal(chance.home + chance.away, 100);
  assert.ok(chance.home > 50, 'ahead by 77 with the better player still to play');
  // A settled matchup is 100/0 whatever is on the sheet.
  assert.deepEqual(matchupChance({ ...matchup, winner: 'AWAY' }, week, expected), { home: 0, away: 100 });
  assert.deepEqual(matchupChance({ ...matchup, winner: 'HOME' }, week, expected), { home: 100, away: 0 });
});

test('more expected points for one side move its chance up', () => {
  const week = buildWeek();
  const [matchup] = week.matchups;
  const even = matchupChance(matchup, week, () => 30);
  const strongHome = matchupChance(matchup, week, (player) => (player.name === 'Nikola Jokic' ? 80 : 30));
  const strongAway = matchupChance(matchup, week, (player) => (player.proTeam === 'GSW' ? 80 : 30));
  assert.ok(strongHome.home > even.home);
  assert.ok(strongAway.home < even.home);
});

// ─── Screen helpers ─────────────────────────────────────────────────────────

function side(teamId: number, players: ScorePlayer[] = []): ScoreSide {
  return { teamId, name: `Team ${teamId}`, abbrev: '', record: { wins: 0, losses: 0, ties: 0 }, total: 0, pointsByDay: {}, players };
}

function matchupOf(id: number, home: number, away: number): ScoreMatchup {
  return { id, home: side(home), away: side(away), winner: 'UNDECIDED' };
}

test('the default day is today, else the edge of the week nearest to now', () => {
  const days = (ids: number[]) => ids.map((scoringPeriodId) => ({ scoringPeriodId, date: '2026-11-02', games: null }));
  assert.equal(defaultDay({ days: days([15, 16, 17]), currentScoringPeriodId: 16 }), 16);
  assert.equal(defaultDay({ days: days([15, 16, 17]), currentScoringPeriodId: 40 }), 17);
  assert.equal(defaultDay({ days: days([15, 16, 17]), currentScoringPeriodId: 3 }), 15);
  assert.equal(defaultDay({ days: [], currentScoringPeriodId: 3 }), null);
});

test('your own matchup sits on top', () => {
  const matchups = [matchupOf(1, 10, 1), matchupOf(2, 8, 6), matchupOf(3, 5, 9), matchupOf(4, 4, 3), matchupOf(5, 7, 2)];
  assert.deepEqual(orderForViewer(matchups, 7).map((m) => m.id), [5, 1, 2, 3, 4]);
  assert.deepEqual(orderForViewer(matchups, 6).map((m) => m.id), [2, 1, 3, 4, 5]);
  assert.deepEqual(orderForViewer(matchups, null).map((m) => m.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(orderForViewer(matchups, 99).map((m) => m.id), [1, 2, 3, 4, 5]);
  const owners = ownerByEspnTeamId([{ owner: 'Brey', espnTeamId: 7 }, { owner: 'Amy', espnTeamId: 2 }]);
  assert.equal(owners.get(7), 'Brey');
  assert.equal(owners.get(3), undefined);
});

const player = (name: string, days: Record<string, { lineupSlotId: number; started: boolean; points: number }>): ScorePlayer => ({
  id: name.length, name, position: '', proTeamId: 0, proTeam: '', injuryStatus: null, seasonAvg: null,
  days: Object.fromEntries(Object.entries(days).map(([key, day]) => [key, { ...day, stats: null, played: day.points > 0, game: null }])),
});

test('a lineup lists starters by slot, then the bench', () => {
  const players = [
    player('Bench', { '15': { lineupSlotId: 12, started: false, points: 20 } }),
    player('Center', { '15': { lineupSlotId: 4, started: true, points: 10 } }),
    player('Guard', { '15': { lineupSlotId: 0, started: true, points: 30 } }),
    player('Missing', {}),
  ];
  assert.deepEqual(lineupOrder(players, 15).map((p) => p.name), ['Guard', 'Center', 'Bench', 'Missing']);
  assert.deepEqual(weekOrder(players).map((p) => p.name), ['Guard', 'Center', 'Bench', 'Missing']);
});

test('the lineup reads PG, SG, SF, PF, C, F, G, FLEX, then the bench, then IR', () => {
  const players = [
    player('Ir', { '15': { lineupSlotId: 13, started: false, points: 0 } }),
    player('Flex', { '15': { lineupSlotId: 11, started: true, points: 0 } }),
    player('G', { '15': { lineupSlotId: 5, started: true, points: 0 } }),
    player('Be', { '15': { lineupSlotId: 12, started: false, points: 0 } }),
    player('F', { '15': { lineupSlotId: 6, started: true, points: 0 } }),
    player('Pg', { '15': { lineupSlotId: 0, started: true, points: 0 } }),
    player('C', { '15': { lineupSlotId: 4, started: true, points: 0 } }),
    player('Odd', { '15': { lineupSlotId: 77, started: true, points: 0 } }),
  ];
  assert.deepEqual(lineupOrder(players, 15).map((p) => p.name), ['Pg', 'C', 'F', 'G', 'Flex', 'Odd', 'Be', 'Ir']);
  assert.deepEqual(weekOrder(players).map((p) => p.name), ['Pg', 'C', 'F', 'G', 'Flex', 'Odd', 'Be', 'Ir']);
  // A day the server never fetched takes the latest slot before it.
  const moved = player('Moved', { '15': { lineupSlotId: 12, started: false, points: 0 }, '16': { lineupSlotId: 0, started: true, points: 0 } });
  assert.equal(slotOn(moved, 15), 12);
  assert.equal(slotOn(moved, 16), 0);
  assert.equal(slotOn(moved, 17), 0);
  assert.equal(slotOn(moved, 14), 12);
  assert.equal(latestSlot(moved), 0);
});

test('slots and injuries have the league\'s words', () => {
  assert.equal(slotLabel(0), 'PG');
  assert.equal(slotLabel(5), 'G');
  assert.equal(slotLabel(6), 'F');
  assert.equal(slotLabel(11), 'FLEX');
  assert.equal(slotLabel(12), 'BE');
  assert.equal(slotLabel(13), 'IR');
  assert.equal(slotLabel(99), '99');
  assert.deepEqual(injuryBadge('OUT'), { text: 'O', tone: 'out' });
  assert.deepEqual(injuryBadge('SUSPENSION'), { text: 'SSPD', tone: 'out' });
  assert.deepEqual(injuryBadge('DAY_TO_DAY'), { text: 'DTD', tone: 'doubt' });
  assert.deepEqual(injuryBadge('QUESTIONABLE'), { text: 'Q', tone: 'doubt' });
  assert.deepEqual(injuryBadge('DOUBTFUL'), { text: 'D', tone: 'doubt' });
  assert.equal(injuryBadge('ACTIVE'), null);
  assert.equal(injuryBadge(null), null);
  assert.equal(injuryBadge(undefined), null);
});

test('games played counts started games finished or under way, never the bench', () => {
  const week = buildWeek();
  const [matchup] = week.matchups;
  // Home: Jokic played Wednesday; today his game has not tipped. Doncic never played.
  assert.equal(gamesPlayed(matchup.home, week), 1);
  // Away: Curry played Wednesday and is on the floor now, Giannis is on the floor now.
  assert.equal(gamesPlayed(matchup.away, week), 3);
});
