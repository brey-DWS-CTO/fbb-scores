export const BASKETBALL_MONSTER_SCHEDULE_URL = 'https://basketballmonster.com/ScheduleGrid.aspx';

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type SchedulePhase = 'regular' | 'fantasy-play-in' | 'fantasy-playoff';
export type ScheduleSourceStatus = 'provisional' | 'final';

export interface NbaTeam {
  espnId: number;
  code: string;
}

export interface RawScheduleWeek {
  nbaWeek: number;
  startDate: string;
  games: number[];
}

export interface RawScheduleSource {
  season: number;
  source: 'basketball-monster';
  sourceUrl: string;
  capturedAt: string;
  teamOrder: string[];
  weeks: RawScheduleWeek[];
}

export interface NbaCalendarWeek {
  nbaWeek: number;
  startDate: string;
  endDate: string;
  gamesByTeamId: Record<number, number>;
}

export interface ScheduleSnapshot {
  season: number;
  source: 'basketball-monster';
  sourceUrl: string;
  capturedAt: string;
  status: ScheduleSourceStatus;
  nbaWeeks: NbaCalendarWeek[];
}

export interface LeagueScheduleMapping {
  leagueWeek: number;
  label: string;
  phase: SchedulePhase;
  sourceNbaWeeks: number[];
  playoffRound?: 1 | 2;
}

export interface LeagueSchedulePeriod extends LeagueScheduleMapping {
  startDate: string;
  endDate: string;
  combinesAllStarBreak: boolean;
  gamesByTeamId: Record<number, number>;
}

export interface TeamScheduleSummary {
  teamId: number;
  teamCode: string;
  regular: {
    byLeagueWeek: Record<number, number>;
    total: number;
  };
  playIn: {
    byLeagueWeek: Record<number, number>;
    total: number;
  };
  playoffs: {
    byLeagueWeek: Record<number, number>;
    round1: number;
    round2: number;
    total: number;
  };
  postseasonTotal: number;
}

export interface StoredScheduleSnapshot extends ScheduleSnapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  baseSnapshotId: string | null;
  fingerprint: string;
  leaguePeriods: LeagueSchedulePeriod[];
}

export interface SchedulePeriodChange {
  leagueWeek: number;
  teamId: number;
  teamCode: string;
  before: number;
  after: number;
}

export interface ScheduleMappingChange {
  leagueWeek: number;
  beforeSourceNbaWeeks: number[];
  afterSourceNbaWeeks: number[];
}

export interface ScheduleRefreshPreview {
  changedTeamPeriods: SchedulePeriodChange[];
  changedMappings: ScheduleMappingChange[];
}

export const NBA_TEAMS: readonly NbaTeam[] = [
  { espnId: 1, code: 'ATL' },
  { espnId: 2, code: 'BOS' },
  { espnId: 3, code: 'NOP' },
  { espnId: 4, code: 'CHI' },
  { espnId: 5, code: 'CLE' },
  { espnId: 6, code: 'DAL' },
  { espnId: 7, code: 'DEN' },
  { espnId: 8, code: 'DET' },
  { espnId: 9, code: 'GSW' },
  { espnId: 10, code: 'HOU' },
  { espnId: 11, code: 'IND' },
  { espnId: 12, code: 'LAC' },
  { espnId: 13, code: 'LAL' },
  { espnId: 14, code: 'MIA' },
  { espnId: 15, code: 'MIL' },
  { espnId: 16, code: 'MIN' },
  { espnId: 17, code: 'BKN' },
  { espnId: 18, code: 'NYK' },
  { espnId: 19, code: 'ORL' },
  { espnId: 20, code: 'PHI' },
  { espnId: 21, code: 'PHX' },
  { espnId: 22, code: 'POR' },
  { espnId: 23, code: 'SAC' },
  { espnId: 24, code: 'SAS' },
  { espnId: 25, code: 'OKC' },
  { espnId: 26, code: 'UTA' },
  { espnId: 27, code: 'WAS' },
  { espnId: 28, code: 'TOR' },
  { espnId: 29, code: 'MEM' },
  { espnId: 30, code: 'CHA' },
] as const;

const TEAM_ID_BY_CODE = new Map(NBA_TEAMS.map((team) => [team.code, team.espnId]));
const TEAM_CODE_BY_ID = new Map(NBA_TEAMS.map((team) => [team.espnId, team.code]));

const TEAM_CODE_ALIASES: Readonly<Record<string, string>> = {
  NO: 'NOP',
  NOR: 'NOP',
  PHO: 'PHX',
};

const ALL_STAR_BREAK_START = '2027-02-19';
const ALL_STAR_BREAK_END = '2027-02-24';

export const DEFAULT_2027_LEAGUE_MAPPING: readonly LeagueScheduleMapping[] = [
  ...Array.from({ length: 16 }, (_, index) => ({
    leagueWeek: index + 1,
    label: `Week ${index + 1}`,
    phase: 'regular' as const,
    sourceNbaWeeks: [index + 1],
  })),
  {
    leagueWeek: 17,
    label: 'Play-In 1',
    phase: 'fantasy-play-in',
    sourceNbaWeeks: [17],
  },
  {
    leagueWeek: 18,
    label: 'Play-In 2',
    phase: 'fantasy-play-in',
    sourceNbaWeeks: [18, 19],
  },
  {
    leagueWeek: 19,
    label: 'Playoff Round 1 · Week 1',
    phase: 'fantasy-playoff',
    playoffRound: 1,
    sourceNbaWeeks: [20],
  },
  {
    leagueWeek: 20,
    label: 'Playoff Round 1 · Week 2',
    phase: 'fantasy-playoff',
    playoffRound: 1,
    sourceNbaWeeks: [21],
  },
  {
    leagueWeek: 21,
    label: 'Playoff Round 2 · Week 1',
    phase: 'fantasy-playoff',
    playoffRound: 2,
    sourceNbaWeeks: [22],
  },
  {
    leagueWeek: 22,
    label: 'Playoff Round 2 · Week 2',
    phase: 'fantasy-playoff',
    playoffRound: 2,
    sourceNbaWeeks: [23],
  },
];

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function parseDateOnly(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}

function addDays(value: string, days: number): string {
  const date = parseDateOnly(value, 'date');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeNbaTeamCode(value: string): string {
  const upper = value.trim().toUpperCase();
  return TEAM_CODE_ALIASES[upper] ?? upper;
}

export function normalizeScheduleSource(raw: unknown, status: ScheduleSourceStatus = 'provisional'): ScheduleSnapshot {
  assertRecord(raw, 'schedule source');
  if (raw.season !== 2027) throw new Error('Schedule source season must be 2027');
  if (raw.source !== 'basketball-monster') throw new Error('Unknown schedule source');
  if (raw.sourceUrl !== BASKETBALL_MONSTER_SCHEDULE_URL) throw new Error('Unexpected schedule source URL');
  if (
    typeof raw.capturedAt !== 'string'
    || !ISO_DATE_TIME.test(raw.capturedAt)
    || Number.isNaN(Date.parse(raw.capturedAt))
  ) {
    throw new Error('capturedAt must be an ISO date-time');
  }
  if (!Array.isArray(raw.teamOrder) || raw.teamOrder.length !== NBA_TEAMS.length) {
    throw new Error(`Schedule source must contain ${NBA_TEAMS.length} team headers`);
  }
  if (!Array.isArray(raw.weeks) || raw.weeks.length !== 25) {
    throw new Error('Schedule source must contain 25 NBA calendar weeks');
  }
  const rawTeamOrder = raw.teamOrder;
  const rawWeeks = raw.weeks;

  const teamIds = rawTeamOrder.map((value, index) => {
    if (typeof value !== 'string') throw new Error(`teamOrder[${index}] must be a string`);
    const normalized = normalizeNbaTeamCode(value);
    const teamId = TEAM_ID_BY_CODE.get(normalized);
    if (!teamId) throw new Error(`Unknown NBA team code: ${value}`);
    return teamId;
  });
  if (new Set(teamIds).size !== NBA_TEAMS.length) {
    throw new Error('Schedule team headers contain a duplicate or alias collision');
  }

  const teamTotals = new Map(NBA_TEAMS.map((team) => [team.espnId, 0]));
  const nbaWeeks = rawWeeks.map((value, index): NbaCalendarWeek => {
    assertRecord(value, `weeks[${index}]`);
    const expectedWeek = index + 1;
    if (value.nbaWeek !== expectedWeek) throw new Error(`Expected NBA week ${expectedWeek}`);
    if (typeof value.startDate !== 'string') throw new Error(`NBA week ${expectedWeek} needs a start date`);
    const start = parseDateOnly(value.startDate, `NBA week ${expectedWeek} startDate`);
    if (start.getUTCDay() !== 1) throw new Error(`NBA week ${expectedWeek} must start on Monday`);
    if (index > 0) {
      const previous = rawWeeks[index - 1];
      assertRecord(previous, `weeks[${index - 1}]`);
      if (typeof previous.startDate !== 'string' || value.startDate !== addDays(previous.startDate, 7)) {
        throw new Error(`NBA week ${expectedWeek} must follow the prior week by seven days`);
      }
    }
    if (!Array.isArray(value.games) || value.games.length !== NBA_TEAMS.length) {
      throw new Error(`NBA week ${expectedWeek} must contain ${NBA_TEAMS.length} game counts`);
    }

    const gamesByTeamId: Record<number, number> = {};
    let leagueGameSlots = 0;
    value.games.forEach((games, teamIndex) => {
      if (!Number.isInteger(games) || games < 0 || games > 7) {
        throw new Error(`NBA week ${expectedWeek} has an invalid game count`);
      }
      const teamId = teamIds[teamIndex];
      gamesByTeamId[teamId] = games;
      teamTotals.set(teamId, (teamTotals.get(teamId) ?? 0) + games);
      leagueGameSlots += games;
    });
    if (leagueGameSlots % 2 !== 0) throw new Error(`NBA week ${expectedWeek} has an odd league game total`);

    return {
      nbaWeek: expectedWeek,
      startDate: value.startDate,
      endDate: addDays(value.startDate, 6),
      gamesByTeamId,
    };
  });

  for (const team of NBA_TEAMS) {
    const total = teamTotals.get(team.espnId);
    if (total !== 82) throw new Error(`${team.code} schedule totals ${total ?? 0}, expected 82`);
  }

  return {
    season: 2027,
    source: 'basketball-monster',
    sourceUrl: BASKETBALL_MONSTER_SCHEDULE_URL,
    capturedAt: raw.capturedAt,
    status,
    nbaWeeks,
  };
}

export function buildLeagueSchedule(
  snapshot: ScheduleSnapshot,
  mapping: readonly LeagueScheduleMapping[] = DEFAULT_2027_LEAGUE_MAPPING,
): LeagueSchedulePeriod[] {
  if (mapping.length !== 22) throw new Error('League schedule mapping must contain exactly 22 periods');

  const weeksById = new Map(snapshot.nbaWeeks.map((week) => [week.nbaWeek, week]));
  const leagueWeeks = new Set<number>();
  const usedNbaWeeks = new Set<number>();

  const periods = mapping.map((entry): LeagueSchedulePeriod => {
    if (!Number.isInteger(entry.leagueWeek) || entry.leagueWeek < 1 || entry.leagueWeek > 22) {
      throw new Error(`League week ${entry.leagueWeek} is outside 1-22`);
    }
    if (leagueWeeks.has(entry.leagueWeek)) throw new Error(`Duplicate league week ${entry.leagueWeek}`);
    leagueWeeks.add(entry.leagueWeek);
    const expectedPhase: SchedulePhase = entry.leagueWeek <= 16
      ? 'regular'
      : entry.leagueWeek <= 18
        ? 'fantasy-play-in'
        : 'fantasy-playoff';
    if (entry.phase !== expectedPhase) {
      throw new Error(`League week ${entry.leagueWeek} must use phase ${expectedPhase}`);
    }
    if (entry.sourceNbaWeeks.length === 0) throw new Error(`League week ${entry.leagueWeek} has no source weeks`);
    const sourceWeeks = entry.sourceNbaWeeks.map((weekId) => {
      if (usedNbaWeeks.has(weekId)) throw new Error(`NBA week ${weekId} is used more than once`);
      const week = weeksById.get(weekId);
      if (!week) throw new Error(`NBA week ${weekId} does not exist`);
      usedNbaWeeks.add(weekId);
      return week;
    });
    for (let index = 1; index < sourceWeeks.length; index += 1) {
      if (sourceWeeks[index].nbaWeek !== sourceWeeks[index - 1].nbaWeek + 1) {
        throw new Error(`League week ${entry.leagueWeek} source weeks must be consecutive`);
      }
    }
    if (entry.phase === 'fantasy-playoff') {
      const expectedRound = entry.leagueWeek <= 20 ? 1 : 2;
      if (entry.playoffRound !== expectedRound) {
        throw new Error(`League week ${entry.leagueWeek} must use playoff round ${expectedRound}`);
      }
    } else if (entry.playoffRound) {
      throw new Error(`League week ${entry.leagueWeek} cannot have a playoff round`);
    }

    const gamesByTeamId: Record<number, number> = {};
    for (const team of NBA_TEAMS) {
      gamesByTeamId[team.espnId] = sourceWeeks.reduce(
        (total, week) => total + week.gamesByTeamId[team.espnId],
        0,
      );
    }
    const startDate = sourceWeeks[0].startDate;
    const endDate = sourceWeeks[sourceWeeks.length - 1]?.endDate ?? startDate;

    return {
      ...entry,
      sourceNbaWeeks: [...entry.sourceNbaWeeks],
      startDate,
      endDate,
      combinesAllStarBreak:
        entry.sourceNbaWeeks.length > 1
        && startDate <= ALL_STAR_BREAK_START
        && endDate >= ALL_STAR_BREAK_END,
      gamesByTeamId,
    };
  });

  for (let leagueWeek = 1; leagueWeek <= 22; leagueWeek += 1) {
    if (!leagueWeeks.has(leagueWeek)) throw new Error(`League week ${leagueWeek} is missing`);
  }
  for (let nbaWeek = 1; nbaWeek <= 23; nbaWeek += 1) {
    if (!usedNbaWeeks.has(nbaWeek)) throw new Error(`NBA week ${nbaWeek} is not assigned`);
  }
  if (usedNbaWeeks.has(24) || usedNbaWeeks.has(25)) {
    throw new Error('NBA weeks 24 and 25 fall after the fantasy season and must remain unused');
  }
  const combined = periods.filter((period) => period.combinesAllStarBreak);
  if (combined.length !== 1) throw new Error('Exactly one league period must combine the All-Star break');
  if (combined[0].phase !== 'fantasy-play-in') {
    throw new Error('The All-Star-combining period must be a fantasy Play-In period');
  }

  return periods.sort((a, b) => a.leagueWeek - b.leagueWeek);
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function summarizeTeamSchedule(periods: readonly LeagueSchedulePeriod[], teamId: number): TeamScheduleSummary {
  const teamCode = TEAM_CODE_BY_ID.get(teamId);
  if (!teamCode) throw new Error(`Unknown ESPN NBA team ID: ${teamId}`);

  const byPhase = (phase: SchedulePhase): Record<number, number> => Object.fromEntries(
    periods
      .filter((period) => period.phase === phase)
      .map((period) => [period.leagueWeek, period.gamesByTeamId[teamId]]),
  );
  const regular = byPhase('regular');
  const playIn = byPhase('fantasy-play-in');
  const playoffs = byPhase('fantasy-playoff');
  const roundTotal = (round: 1 | 2) => sum(
    periods
      .filter((period) => period.phase === 'fantasy-playoff' && period.playoffRound === round)
      .map((period) => period.gamesByTeamId[teamId]),
  );
  const playInTotal = sum(Object.values(playIn));
  const playoffTotal = sum(Object.values(playoffs));

  return {
    teamId,
    teamCode,
    regular: { byLeagueWeek: regular, total: sum(Object.values(regular)) },
    playIn: { byLeagueWeek: playIn, total: playInTotal },
    playoffs: {
      byLeagueWeek: playoffs,
      round1: roundTotal(1),
      round2: roundTotal(2),
      total: playoffTotal,
    },
    postseasonTotal: playInTotal + playoffTotal,
  };
}

export function summarizeAllTeamSchedules(periods: readonly LeagueSchedulePeriod[]): TeamScheduleSummary[] {
  return NBA_TEAMS.map((team) => summarizeTeamSchedule(periods, team.espnId));
}
