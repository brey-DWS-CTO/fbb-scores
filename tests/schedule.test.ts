import assert from 'node:assert/strict';
import test from 'node:test';
import rawSchedule from '../src/data/source/basketball-monster-schedule-2027.json' with { type: 'json' };
import {
  DEFAULT_2027_LEAGUE_MAPPING,
  NBA_TEAMS,
  buildLeagueSchedule,
  normalizeNbaTeamCode,
  normalizeScheduleSource,
  summarizeAllTeamSchedules,
  summarizeTeamSchedule,
  type RawScheduleSource,
} from '../src/lib/league/schedule.ts';

const source = rawSchedule as RawScheduleSource;

function clonedSource(): RawScheduleSource {
  return structuredClone(source);
}

test('normalizes the complete 2026-27 NBA calendar by ESPN team ID', () => {
  const snapshot = normalizeScheduleSource(source);

  assert.equal(snapshot.nbaWeeks.length, 25);
  assert.deepEqual(snapshot.nbaWeeks[0], {
    nbaWeek: 1,
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    gamesByTeamId: {
      1: 3, 2: 2, 3: 3, 4: 3, 5: 2, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3,
      11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 4,
      21: 2, 22: 2, 23: 3, 24: 3, 25: 3, 26: 3, 27: 3, 28: 3, 29: 3, 30: 3,
    },
  });
  assert.equal(snapshot.nbaWeeks[16].startDate, '2027-02-08');
  assert.equal(snapshot.nbaWeeks[17].startDate, '2027-02-15');
  assert.equal(snapshot.nbaWeeks[18].startDate, '2027-02-22');
  assert.equal(snapshot.nbaWeeks[24].endDate, '2027-04-11');

  for (const team of NBA_TEAMS) {
    const total = snapshot.nbaWeeks.reduce((sum, week) => sum + week.gamesByTeamId[team.espnId], 0);
    assert.equal(total, 82, team.code);
  }
});

test('moves the 2027 All-Star merge to Play-In 2 and ends with ESPN on March 28', () => {
  const periods = buildLeagueSchedule(normalizeScheduleSource(source));
  const playIn1 = periods.find((period) => period.leagueWeek === 17);
  const playIn2 = periods.find((period) => period.leagueWeek === 18);
  const final = periods.at(-1);

  assert.deepEqual(playIn1?.sourceNbaWeeks, [17]);
  assert.equal(playIn1?.startDate, '2027-02-08');
  assert.equal(playIn1?.endDate, '2027-02-14');
  assert.equal(playIn1?.combinesAllStarBreak, false);
  assert.deepEqual(playIn2?.sourceNbaWeeks, [18, 19]);
  assert.equal(playIn2?.startDate, '2027-02-15');
  assert.equal(playIn2?.endDate, '2027-02-28');
  assert.equal(playIn2?.combinesAllStarBreak, true);
  assert.equal(final?.endDate, '2027-03-28');
  assert.deepEqual(periods.flatMap((period) => period.sourceNbaWeeks), Array.from({ length: 23 }, (_, i) => i + 1));
});

test('builds projection-ready Play-In and playoff totals without omitting Play-In 1', () => {
  const periods = buildLeagueSchedule(normalizeScheduleSource(source));
  const atlanta = summarizeTeamSchedule(periods, 1);
  const phoenix = summarizeTeamSchedule(periods, 21);
  const sanAntonio = summarizeTeamSchedule(periods, 24);

  assert.deepEqual(atlanta.playIn.byLeagueWeek, { 17: 4, 18: 5 });
  assert.equal(atlanta.playIn.total, 9);
  assert.deepEqual(atlanta.playoffs.byLeagueWeek, { 19: 3, 20: 4, 21: 4, 22: 3 });
  assert.equal(atlanta.playoffs.round1, 7);
  assert.equal(atlanta.playoffs.round2, 7);
  assert.equal(atlanta.postseasonTotal, 23);

  assert.deepEqual({
    playIn: phoenix.playIn.total,
    round1: phoenix.playoffs.round1,
    round2: phoenix.playoffs.round2,
    postseason: phoenix.postseasonTotal,
  }, { playIn: 8, round1: 7, round2: 8, postseason: 23 });
  assert.deepEqual({
    playIn: sanAntonio.playIn.total,
    round1: sanAntonio.playoffs.round1,
    round2: sanAntonio.playoffs.round2,
    postseason: sanAntonio.postseasonTotal,
  }, { playIn: 8, round1: 6, round2: 7, postseason: 21 });
});

test('normalizes source aliases and rejects unknown or colliding team headers', () => {
  assert.equal(normalizeNbaTeamCode('NOR'), 'NOP');
  assert.equal(normalizeNbaTeamCode('NO'), 'NOP');
  assert.equal(normalizeNbaTeamCode('PHO'), 'PHX');

  const unknown = clonedSource();
  unknown.teamOrder[0] = 'SEA';
  assert.throws(() => normalizeScheduleSource(unknown), /Unknown NBA team code: SEA/);

  const collision = clonedSource();
  collision.teamOrder[0] = 'NO';
  assert.throws(() => normalizeScheduleSource(collision), /duplicate or alias collision/);
});

test('rejects malformed source rows before they can become app data', () => {
  const oddTotal = clonedSource();
  oddTotal.weeks[0].games[0] += 1;
  assert.throws(() => normalizeScheduleSource(oddTotal), /odd league game total/);

  const wrongDate = clonedSource();
  wrongDate.weeks[16].startDate = '2027-02-09';
  assert.throws(() => normalizeScheduleSource(wrongDate), /must start on Monday/);

  const duplicateWeek = clonedSource();
  duplicateWeek.weeks[4].nbaWeek = 4;
  assert.throws(() => normalizeScheduleSource(duplicateWeek), /Expected NBA week 5/);

  const looseDateTime = clonedSource();
  looseDateTime.capturedAt = 'August 28, 2026';
  assert.throws(() => normalizeScheduleSource(looseDateTime), /capturedAt must be an ISO date-time/);
});

test('rejects mappings that overlap source weeks or use post-fantasy weeks', () => {
  const snapshot = normalizeScheduleSource(source);
  const overlap = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  overlap[17].sourceNbaWeeks = [17, 18];
  assert.throws(() => buildLeagueSchedule(snapshot, overlap), /NBA week 17 is used more than once/);

  const afterSeason = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  afterSeason[21].sourceNbaWeeks = [24];
  assert.throws(() => buildLeagueSchedule(snapshot, afterSeason), /NBA week 23 is not assigned/);

  assert.throws(() => summarizeTeamSchedule(buildLeagueSchedule(snapshot), 99), /Unknown ESPN NBA team ID/);
});

test('rejects extra periods and mappings that violate league phases or playoff rounds', () => {
  const snapshot = normalizeScheduleSource(source);

  const extra = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  extra.push({
    leagueWeek: 23,
    label: 'Extra',
    phase: 'fantasy-playoff',
    playoffRound: 2,
    sourceNbaWeeks: [24],
  });
  assert.throws(() => buildLeagueSchedule(snapshot, extra), /exactly 22 periods/);

  const wrongRegularPhase = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  wrongRegularPhase[0].phase = 'fantasy-play-in';
  assert.throws(() => buildLeagueSchedule(snapshot, wrongRegularPhase), /League week 1 must use phase regular/);

  const wrongPlayInPhase = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  wrongPlayInPhase[16].phase = 'regular';
  assert.throws(() => buildLeagueSchedule(snapshot, wrongPlayInPhase), /League week 17 must use phase fantasy-play-in/);

  const wrongPlayoffPhase = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  wrongPlayoffPhase[18].phase = 'fantasy-play-in';
  assert.throws(() => buildLeagueSchedule(snapshot, wrongPlayoffPhase), /League week 19 must use phase fantasy-playoff/);

  const wrongRound1 = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  wrongRound1[18].playoffRound = 2;
  assert.throws(() => buildLeagueSchedule(snapshot, wrongRound1), /League week 19 must use playoff round 1/);

  const wrongRound2 = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  wrongRound2[20].playoffRound = 1;
  assert.throws(() => buildLeagueSchedule(snapshot, wrongRound2), /League week 21 must use playoff round 2/);
});

test('requires the sole All-Star-combining period to be Play-In', () => {
  const snapshot = normalizeScheduleSource(source);
  const mapping = structuredClone(DEFAULT_2027_LEAGUE_MAPPING);
  mapping[17].sourceNbaWeeks = [20];
  mapping[18].sourceNbaWeeks = [18, 19];
  mapping[19].sourceNbaWeeks = [21];
  mapping[20].sourceNbaWeeks = [22];
  mapping[21].sourceNbaWeeks = [23];

  assert.throws(
    () => buildLeagueSchedule(snapshot, mapping),
    /All-Star-combining period must be a fantasy Play-In period/,
  );
});

test('reconciles every team from league periods through the two unused NBA weeks', () => {
  const snapshot = normalizeScheduleSource(source);
  const periods = buildLeagueSchedule(snapshot);
  const summaries = summarizeAllTeamSchedules(periods);
  const unused = snapshot.nbaWeeks.filter((week) => week.nbaWeek >= 24);

  assert.equal(summaries.length, NBA_TEAMS.length);
  for (const summary of summaries) {
    const unusedGames = unused.reduce(
      (total, week) => total + week.gamesByTeamId[summary.teamId],
      0,
    );
    assert.equal(summary.regular.total + summary.postseasonTotal + unusedGames, 82, summary.teamCode);
    assert.equal(summary.playoffs.round1 + summary.playoffs.round2, summary.playoffs.total, summary.teamCode);
    assert.equal(summary.playIn.total + summary.playoffs.total, summary.postseasonTotal, summary.teamCode);
  }
});
