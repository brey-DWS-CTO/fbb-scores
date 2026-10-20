/**
 * In-season scores: one fantasy week, read out of ESPN's daily payloads.
 *
 * ESPN counts in two units. A `scoringPeriodId` is one day. A
 * `matchupPeriodId` is one fantasy week, which is seven days in the regular
 * season and fourteen in Play-In 2 and the playoff rounds. The server asks
 * ESPN for every day of the week and this module turns the answers into one
 * `ScoresWeek`: five matchups, each side's players, what every player did on
 * every day, and the games still to come.
 *
 * Nothing in here trusts a field to be there. A missing field reads as
 * nothing, never as a crash: the league reads this on a phone during a game.
 *
 * Pure. No server, no browser.
 */
import { computeFpts, isActiveSlot, NBA_TEAM_ABBREV, POSITION_MAP, round1 } from '../espn/calculations.js';
import { normalizeNbaTeamCode, type SchedulePhase } from './schedule.js';
import { leagueSchedule2027 } from './scheduleData.js';
import { winChance, type RemainingGame, type SideOdds, type WinChance } from './winOdds.js';

// ─── The week ───────────────────────────────────────────────────────────────

export type GameStatus = 'upcoming' | 'live' | 'final' | 'off';

/** One NBA game as it concerns one team. */
export interface GameLine {
  status: GameStatus;
  /** The other team, in ESPN's code. */
  opponent: string;
  /** True when this team is at home. */
  home: boolean;
  teamScore: number | null;
  oppScore: number | null;
  /** "3rd Q 5:32", "Half", "OT 1:10". Live games only. */
  clock: string | null;
  /** Tip-off, ISO. */
  tipoff: string | null;
  /** Minutes still to play. Live games only. */
  minutesLeft: number | null;
}

export interface StatLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
  to: number;
  min: number;
  gp: number;
}

export interface PlayerDay {
  lineupSlotId: number;
  /** In a scoring slot, not bench or IR. */
  started: boolean;
  points: number;
  stats: StatLine | null;
  /** He took the floor that day. */
  played: boolean;
  game: GameLine | null;
}

export interface ScorePlayer {
  id: number;
  name: string;
  position: string;
  proTeamId: number;
  proTeam: string;
  injuryStatus: string | null;
  /** ESPN's current-season fantasy points a game. Null until he has played. */
  seasonAvg: number | null;
  /** Fantasy points a game over ESPN's last 7, 15 and 30 days. Null until he has played in the window. */
  last7: number | null;
  last15: number | null;
  last30: number | null;
  /** ESPN's own projection for a day, in league points, by scoring period id. Empty when ESPN sends none. */
  projByDay: Record<string, number>;
  /** By scoring period id. */
  days: Record<string, PlayerDay>;
}

export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface ScoreSide {
  teamId: number;
  name: string;
  abbrev: string;
  record: TeamRecord;
  /** Running total for the week. */
  total: number;
  /** By scoring period id. */
  pointsByDay: Record<string, number>;
  players: ScorePlayer[];
}

export type MatchupWinner = 'HOME' | 'AWAY' | 'UNDECIDED';

export interface ScoreMatchup {
  id: number;
  home: ScoreSide;
  away: ScoreSide;
  winner: MatchupWinner;
}

export interface ScoreDay {
  scoringPeriodId: number;
  /** YYYY-MM-DD. */
  date: string;
  /** That day's NBA games by team code, or null when the day could not be read. */
  games: Record<string, GameLine> | null;
}

export interface WeekRef {
  matchupPeriodId: number;
  scoringPeriodIds: number[];
  startDate: string;
  endDate: string;
  /** "Week 3", "Play-In 1", "Playoff Round 2". */
  label: string;
  phase: SchedulePhase;
}

/**
 * One scoring period pinned to a calendar date, which dates every other
 * period: ESPN's periods are consecutive days. In season the current
 * period is today. Before it, period 1 is opening night.
 */
export interface DateAnchor {
  scoringPeriodId: number;
  date: string;
  /** Where the anchor came from, for anyone checking the plan. */
  source: 'scoring-period' | 'opening-night' | 'season-start' | 'pro-schedule' | 'demo';
}

export interface WeekPlan {
  season: number;
  matchupPeriodId: number;
  currentMatchupPeriodId: number;
  currentScoringPeriodId: number;
  days: Array<Pick<ScoreDay, 'scoringPeriodId' | 'date'>>;
  weeks: WeekRef[];
  /** Games a team may count this week, from ESPN's lineup limit. */
  gamesCap: number | null;
  /** The anchor the dates were counted from. */
  anchor: DateAnchor;
}

export interface ScoresWeek extends WeekPlan {
  days: ScoreDay[];
  matchups: ScoreMatchup[];
  fetchedAt: string;
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** A Date as YYYY-MM-DD in the machine's own time zone. */
export function localDateIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `days` after an ISO date, as an ISO date. Negative moves back. */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

interface ListedPeriod {
  matchupPeriodId: number;
  values: number[];
}

interface ExpandedPeriod {
  matchupPeriodId: number;
  scoringPeriodIds: number[];
}

/**
 * ESPN writes `matchupPeriods` one of two ways. Some leagues list the
 * scoring periods (days) of each fantasy week outright. This league lists
 * NBA week numbers: `{"1":[1], ..., "19":[19,20]}`, a week being seven
 * scoring periods from a Monday, and a playoff round two weeks. Week
 * numbers are told apart by their size: every entry is one or two small
 * numbers, never a run of seven days. `weekOneStart` is the scoring period
 * of the Monday that opens the league's week 1.
 */
export function expandWeekNumbers(listed: readonly ListedPeriod[], weekOneStart: number): ExpandedPeriod[] {
  const largest = Math.max(...listed.flatMap((entry) => entry.values));
  const weekNumbers = listed.every((entry) => entry.values.length <= 2) && largest <= 2 * listed.length + 2;
  if (!weekNumbers) {
    return listed.map((entry) => ({ matchupPeriodId: entry.matchupPeriodId, scoringPeriodIds: entry.values }));
  }
  // Week 1 can open on a Monday before opening night; those days have no
  // scoring period, so they drop out and week 1 is a short week.
  return listed.map((entry) => ({
    matchupPeriodId: entry.matchupPeriodId,
    scoringPeriodIds: [...entry.values]
      .sort((a, b) => a - b)
      .flatMap((week) => Array.from({ length: 7 }, (_, day) => weekOneStart + (week - 1) * 7 + day))
      .filter((scoringPeriodId) => scoringPeriodId >= 1),
  }));
}

/** A Date as YYYY-MM-DD in a named time zone. */
function dateIsoInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/**
 * Today where ESPN keeps its days. A Vercel function runs on UTC, where a
 * West Coast evening is already tomorrow; ESPN's scoring day is not.
 */
export function espnToday(now: Date = new Date()): string {
  return dateIsoInZone(now, 'America/New_York');
}

/** The first day of the league's week 1. Before this there is nothing to score. */
export function seasonStartDate(): string {
  return leagueSchedule2027[0].startDate;
}

/** True before the first day of week 1. */
export function beforeSeason(todayIso: string): boolean {
  return todayIso < seasonStartDate();
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Nov 2". */
export function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Mon". */
export function shortDay(iso: string): string {
  return SHORT_DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

/** "Monday, October 19". */
export function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${LONG_DAYS[date.getUTCDay()]}, ${LONG_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Nov 2 to Nov 8". */
export function dateRangeText(startIso: string, endIso: string): string {
  return `${shortDate(startIso)} to ${shortDate(endIso)}`;
}

// ─── Reading loosely ────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(dict(value))) {
    const n = num(raw);
    if (n !== null) out[key] = n;
  }
  return out;
}

// ─── The plan: which days make the week ─────────────────────────────────────

/**
 * The calendar date of every scoring period ESPN lists a pro game for.
 *
 * ESPN's `proTeamSchedules_wl` view carries each NBA team's games by scoring
 * period with a tip-off time. The earliest tip in the period, taken in New
 * York, is that period's date. Empty when the view was not asked for.
 */
export function scoringPeriodDates(proTeams: unknown): Map<number, string> {
  const dates = new Map<number, string>();
  for (const team of list(proTeams)) {
    for (const [key, games] of Object.entries(dict(dict(team).proGamesByScoringPeriod))) {
      const period = Number(key);
      if (!Number.isInteger(period)) continue;
      for (const game of list(games)) {
        const ms = num(dict(game).date);
        if (ms === null) continue;
        const iso = dateIsoInZone(new Date(ms), 'America/New_York');
        const known = dates.get(period);
        if (!known || iso < known) dates.set(period, iso);
      }
    }
  }
  return dates;
}

/**
 * The league's label for the fantasy week that starts on `startDate`.
 *
 * A playoff round is two league weeks; the round's name goes only on the
 * week that opens it, so an ESPN period that happens to start on a round's
 * second week is not called the round.
 */
export function weekLabel(matchupPeriodId: number, startDate: string): { label: string; phase: SchedulePhase } {
  const period = leagueSchedule2027.find((entry) => entry.startDate === startDate);
  if (!period) return { label: `Week ${matchupPeriodId}`, phase: 'regular' };
  if (period.phase === 'fantasy-playoff') {
    const opensRound = !leagueSchedule2027.some((entry) =>
      entry.phase === 'fantasy-playoff' && entry.playoffRound === period.playoffRound && entry.leagueWeek < period.leagueWeek);
    return opensRound
      ? { label: `Playoff Round ${period.playoffRound ?? ''}`.trim(), phase: period.phase }
      : { label: `Week ${matchupPeriodId}`, phase: period.phase };
  }
  return { label: period.label, phase: period.phase };
}

/**
 * ESPN's games cap for a week of `dayCount` days.
 *
 * ESPN stores the limit per day (30 games a week is 4.2857 a day). A value
 * of ten or more is already the whole week's cap. The rule book says 30 a
 * week (`season.gameLimit`) and gives the All-Star week its own formula
 * (`season.matchups.allstar.formula`); the commissioner sets both in ESPN,
 * so ESPN's number is the one that counts.
 */
export function gamesCapFor(rosterSettings: unknown, dayCount: number): number {
  for (const limit of Object.values(dict(dict(rosterSettings).lineupSlotStatLimits))) {
    const entry = dict(limit);
    const value = num(entry.limitValue);
    if (num(entry.statId) !== 42 || value === null || value <= 0) continue;
    return value >= 10 ? Math.round(value) : Math.round(value * dayCount);
  }
  return Math.round((30 * dayCount) / 7);
}

/** ESPN's current scoring period from a league payload: 0 before the season. */
export function readCurrentScoringPeriod(settings: unknown): number {
  const body = dict(settings);
  return num(body.scoringPeriodId) ?? num(dict(body.status).latestScoringPeriod) ?? 0;
}

/**
 * The first date with a regular-season game, from ESPN's public scoreboard
 * for a run of dates. Preseason games carry season type 1; the regular
 * season is type 2. Null when none of the dates has one.
 */
export function firstRegularSeasonDate(days: ReadonlyArray<{ date: string; payload: unknown }>): string | null {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    const regular = list(dict(day.payload).events).some((event) => {
      const season = dict(dict(event).season);
      return num(season.type) === 2 || str(season.slug) === 'regular-season';
    });
    if (regular) return day.date;
  }
  return null;
}

/**
 * Which days make up the requested week, and every week the picker can show.
 *
 * `settings` is ESPN's league payload with the `mSettings`, `mStatus` and
 * `mTeam` views, and `proTeamSchedules_wl` when ESPN sends it. `anchor`
 * pins one scoring period to a date; the pro schedule's own dates win over
 * it where they exist. Throws `no-schedule` when ESPN lists no weeks and
 * `unknown-week` when the requested one does not exist.
 */
export function planWeek(settings: unknown, requested: number | null, anchor: DateAnchor): WeekPlan {
  const body = dict(settings);
  const status = dict(body.status);
  const leagueSettings = dict(body.settings);
  const schedule = dict(leagueSettings.scheduleSettings);

  const currentScoringPeriodId = readCurrentScoringPeriod(settings);
  const currentMatchupPeriodId = num(status.currentMatchupPeriod) ?? 1;
  const season = num(body.seasonId) ?? 0;

  const listed = Object.entries(dict(schedule.matchupPeriods))
    .map(([key, value]) => ({
      matchupPeriodId: Number(key),
      values: list(value).map(num).filter((id): id is number => id !== null),
    }))
    .filter((entry) => Number.isInteger(entry.matchupPeriodId) && entry.values.length > 0)
    .sort((a, b) => a.matchupPeriodId - b.matchupPeriodId);
  if (listed.length === 0) throw new Error('no-schedule');

  // ESPN's scoring periods are calendar days, numbered from the first day it
  // lists a pro game, preseason included. A date it names pins the line;
  // every other period is counted out along it.
  const known = scoringPeriodDates(leagueSettings.proTeams);
  let line: DateAnchor = anchor;
  for (const [scoringPeriodId, date] of known) {
    if (line.source !== 'pro-schedule' || scoringPeriodId < line.scoringPeriodId) {
      line = { scoringPeriodId, date, source: 'pro-schedule' };
    }
  }
  const dateFor = (scoringPeriodId: number): string =>
    known.get(scoringPeriodId) ?? addDaysIso(line.date, scoringPeriodId - line.scoringPeriodId);
  const periodFor = (iso: string): number => line.scoringPeriodId + daysBetween(line.date, iso);

  const periods = expandWeekNumbers(listed, periodFor(seasonStartDate()));

  const weeks: WeekRef[] = periods.map((entry) => {
    const ids = [...entry.scoringPeriodIds].sort((a, b) => a - b);
    const startDate = dateFor(ids[0]);
    const endDate = dateFor(ids[ids.length - 1]);
    return { matchupPeriodId: entry.matchupPeriodId, scoringPeriodIds: ids, startDate, endDate, ...weekLabel(entry.matchupPeriodId, startDate) };
  });

  const wanted = requested ?? currentMatchupPeriodId;
  const week = weeks.find((entry) => entry.matchupPeriodId === wanted);
  if (!week) throw new Error('unknown-week');

  const days = week.scoringPeriodIds.map((scoringPeriodId) => ({ scoringPeriodId, date: dateFor(scoringPeriodId) }));
  return {
    season,
    matchupPeriodId: week.matchupPeriodId,
    currentMatchupPeriodId,
    currentScoringPeriodId,
    days,
    weeks,
    gamesCap: gamesCapFor(leagueSettings.rosterSettings, days.length),
    anchor: line,
  };
}

// ─── The public NBA scoreboard ──────────────────────────────────────────────

const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];

function periodClock(statusName: string, period: number, displayClock: string | null): string {
  if (statusName === 'STATUS_HALFTIME') return 'Half';
  const quarter = period <= 4 ? `${ORDINALS[period] ?? `${period}th`} Q` : period === 5 ? 'OT' : `${period - 4}OT`;
  if (statusName === 'STATUS_END_PERIOD') return `End ${quarter}`;
  return displayClock ? `${quarter} ${displayClock}` : quarter;
}

/**
 * One day of ESPN's public NBA scoreboard, by team code.
 *
 * Both teams in a game get a line. Codes are ESPN's fantasy codes (GSW, not
 * GS), so a player's `proTeam` finds his game without a second lookup.
 */
export function readNbaScoreboard(payload: unknown): Record<string, GameLine> {
  const games: Record<string, GameLine> = {};
  for (const event of list(dict(payload).events)) {
    const competition = dict(list(dict(event).competitions)[0]);
    const status = dict(competition.status);
    const type = dict(status.type);
    const statusName = str(type.name) ?? '';
    const state = str(type.state) ?? '';
    const period = num(status.period) ?? 0;
    const clockSeconds = num(status.clock) ?? 0;
    const displayClock = str(status.displayClock);
    const tipoff = str(competition.date) ?? str(dict(event).date);

    let gameStatus: GameStatus;
    if (statusName === 'STATUS_FINAL' || state === 'post') gameStatus = 'final';
    else if (statusName === 'STATUS_POSTPONED' || statusName === 'STATUS_CANCELED') gameStatus = 'off';
    else if (state === 'in') gameStatus = 'live';
    else gameStatus = 'upcoming';

    let minutesLeft: number | null = null;
    if (gameStatus === 'live') {
      minutesLeft = period <= 4 ? (4 - Math.max(1, period)) * 12 + clockSeconds / 60 : clockSeconds / 60;
    }
    const clock = gameStatus === 'live' ? periodClock(statusName, period, displayClock) : null;

    const sides = list(competition.competitors).map((raw) => {
      const competitor = dict(raw);
      return {
        code: str(dict(competitor.team).abbreviation),
        home: competitor.homeAway === 'home',
        score: gameStatus === 'upcoming' ? null : (num(competitor.score) ?? num(Number(competitor.score))),
      };
    });
    if (sides.length !== 2 || !sides[0].code || !sides[1].code) continue;

    for (const [index, side] of sides.entries()) {
      const other = sides[1 - index];
      games[normalizeNbaTeamCode(side.code as string)] = {
        status: gameStatus,
        opponent: normalizeNbaTeamCode(other.code as string),
        home: side.home,
        teamScore: side.score,
        oppScore: other.score,
        clock,
        tipoff,
        minutesLeft,
      };
    }
  }
  return games;
}

// ─── Reading ESPN's days into the week ──────────────────────────────────────

export interface EspnDayInput {
  scoringPeriodId: number;
  date: string;
  /** ESPN's league payload for that scoring period, with rosters. */
  payload: unknown;
  /** That day's NBA games by team code, or null when they could not be read. */
  games: Record<string, GameLine> | null;
}

export interface EspnWeekInput {
  plan: WeekPlan;
  /** The settings payload the plan came from: teams and records live here. */
  settings: unknown;
  days: EspnDayInput[];
  fetchedAt: string;
}

interface ScoringItem {
  statId: number;
  points: number;
}

function readScoringItems(payload: unknown): ScoringItem[] {
  return list(dict(dict(dict(payload).settings).scoringSettings).scoringItems)
    .map((raw) => ({ statId: num(dict(raw).statId), points: num(dict(raw).points) }))
    .filter((item): item is ScoringItem => item.statId !== null && item.points !== null);
}

function toStatLine(stats: Record<string, number>): StatLine {
  return {
    pts: stats['0'] ?? 0,
    reb: stats['6'] ?? 0,
    ast: stats['3'] ?? 0,
    stl: stats['2'] ?? 0,
    blk: stats['1'] ?? 0,
    threes: stats['17'] ?? 0,
    to: stats['11'] ?? 0,
    min: stats['40'] ?? 0,
    gp: stats['42'] ?? 0,
  };
}

/** The stat row ESPN filed for one scoring period, from either place it puts them. */
function dayStatRow(poolEntry: Dict, player: Dict, scoringPeriodId: number): Dict | null {
  for (const rows of [list(poolEntry.stats), list(player.stats)]) {
    for (const raw of rows) {
      const row = dict(raw);
      if (num(row.statSourceId) === 0 && num(row.scoringPeriodId) === scoringPeriodId && row.stats) return row;
    }
  }
  return null;
}

/**
 * ESPN's fantasy points a game from a totals row of one split: 0 is the
 * season, 1 the last 7 days, 2 the last 15, 3 the last 30. Null until he
 * has played in the window.
 */
function splitAverage(player: Dict, season: number, items: ScoringItem[], split: number): number | null {
  for (const raw of list(player.stats)) {
    const row = dict(raw);
    if (num(row.statSplitTypeId) !== split || num(row.statSourceId) !== 0) continue;
    const rowSeason = num(row.seasonId);
    if (rowSeason !== null && season > 0 && rowSeason !== season) continue;
    const stats = numbers(row.stats);
    const games = stats['42'] ?? 0;
    if (games <= 0) continue;
    const total = items.length > 0 ? computeFpts(stats, items) : (num(row.appliedTotal) ?? 0);
    return round1(total / games);
  }
  return null;
}

/** ESPN's season-to-date fantasy points a game, from a split-0 totals row. */
function seasonAverage(player: Dict, season: number, items: ScoringItem[]): number | null {
  return splitAverage(player, season, items, 0);
}

/**
 * ESPN's projection rows for single days (`statSourceId` 1 with a scoring
 * period), in league points, for the days asked about. ESPN files them on
 * the player and sometimes on the pool entry; both are read. A row with no
 * stats and no total says nothing.
 */
function dayProjections(poolEntry: Dict, player: Dict, periods: ReadonlySet<number>, items: ScoringItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rows of [list(poolEntry.stats), list(player.stats)]) {
    for (const raw of rows) {
      const row = dict(raw);
      const period = num(row.scoringPeriodId);
      if (num(row.statSourceId) !== 1 || period === null || !periods.has(period)) continue;
      if (String(period) in out) continue;
      const stats = numbers(row.stats);
      const applied = num(row.appliedTotal);
      if (applied === null && Object.keys(stats).length === 0) continue;
      const points = applied ?? (items.length > 0 ? computeFpts(stats, items) : 0);
      out[String(period)] = round1(Math.max(0, points));
    }
  }
  return out;
}

/** The figures a player carries beyond his day lines. */
interface PlayerFigures {
  seasonAvg: number | null;
  last7: number | null;
  last15: number | null;
  last30: number | null;
  projByDay: Record<string, number>;
}

function emptyFigures(): PlayerFigures {
  return { seasonAvg: null, last7: null, last15: null, last30: null, projByDay: {} };
}

/** Fill in what this payload knows that an earlier one did not. */
function mergeFigures(into: PlayerFigures, poolEntry: Dict, season: number, items: ScoringItem[], periods: ReadonlySet<number>): void {
  const player = dict(poolEntry.player);
  into.seasonAvg ??= seasonAverage(player, season, items);
  into.last7 ??= splitAverage(player, season, items, 1);
  into.last15 ??= splitAverage(player, season, items, 2);
  into.last30 ??= splitAverage(player, season, items, 3);
  for (const [key, value] of Object.entries(dayProjections(poolEntry, player, periods, items))) {
    if (!(key in into.projByDay)) into.projByDay[key] = value;
  }
}

function readRecord(team: Dict): TeamRecord {
  const overall = dict(dict(team.record).overall);
  return { wins: num(overall.wins) ?? 0, losses: num(overall.losses) ?? 0, ties: num(overall.ties) ?? 0 };
}

interface TeamMeta {
  name: string;
  abbrev: string;
  record: TeamRecord;
}

function readTeams(payload: unknown, into: Map<number, TeamMeta>): void {
  for (const raw of list(dict(payload).teams)) {
    const team = dict(raw);
    const id = num(team.id);
    if (id === null || into.has(id)) continue;
    const joined = `${str(team.location) ?? ''} ${str(team.nickname) ?? ''}`.trim();
    // ESPN hands back "Tu  Mamacita"; one space is enough.
    const name = (str(team.name) ?? (joined || `Team ${id}`)).replace(/\s+/g, ' ');
    into.set(id, { name, abbrev: str(team.abbrev) ?? '', record: readRecord(team) });
  }
}

/** Every player entry anywhere in a payload, for season averages. */
function* playerEntries(payload: unknown): Generator<Dict> {
  const body = dict(payload);
  for (const team of list(body.teams)) {
    for (const entry of list(dict(dict(team).roster).entries)) yield dict(dict(entry).playerPoolEntry);
  }
  for (const matchup of list(body.schedule)) {
    for (const side of [dict(dict(matchup).home), dict(dict(matchup).away)]) {
      for (const key of ['rosterForCurrentScoringPeriod', 'rosterForMatchupPeriod']) {
        for (const entry of list(dict(side[key]).entries)) yield dict(dict(entry).playerPoolEntry);
      }
    }
  }
}

interface SideDraft {
  teamId: number;
  total: number | null;
  pointsByDay: Record<string, number>;
  players: Map<number, ScorePlayer>;
}

function sideDraft(teamId: number): SideDraft {
  return { teamId, total: null, pointsByDay: {}, players: new Map() };
}

/**
 * Turn ESPN's answers for every day of a week into one `ScoresWeek`.
 *
 * Totals come from the matchup entry itself (`totalPointsLive`, then
 * `totalPoints`), day scores from `pointsByScoringPeriod` when ESPN sends it
 * and from the day's started players when it does not. A player's day line
 * comes only from the stat row filed for that exact scoring period; a season
 * row is never mistaken for a day.
 */
export function readEspnWeek(input: EspnWeekInput): ScoresWeek {
  const { plan, fetchedAt } = input;
  const teams = new Map<number, TeamMeta>();
  readTeams(input.settings, teams);
  for (const day of input.days) readTeams(day.payload, teams);

  let items = readScoringItems(input.settings);
  for (const day of input.days) {
    if (items.length > 0) break;
    items = readScoringItems(day.payload);
  }

  const periods = new Set(plan.days.map((day) => day.scoringPeriodId));
  const figures = new Map<number, PlayerFigures>();
  for (const payload of [input.settings, ...input.days.map((day) => day.payload)]) {
    for (const entry of playerEntries(payload)) {
      const id = num(entry.id) ?? num(dict(entry.player).id);
      if (id === null) continue;
      let known = figures.get(id);
      if (!known) {
        known = emptyFigures();
        figures.set(id, known);
      }
      mergeFigures(known, entry, plan.season, items, periods);
    }
  }

  const matchups = new Map<number, { winner: MatchupWinner; home: SideDraft; away: SideDraft }>();
  const days: ScoreDay[] = plan.days.map((day) => ({ ...day, games: null }));

  for (const day of input.days) {
    const slot = days.find((entry) => entry.scoringPeriodId === day.scoringPeriodId);
    if (slot) slot.games = day.games;

    for (const raw of list(dict(day.payload).schedule)) {
      const matchup = dict(raw);
      const id = num(matchup.id);
      if (id === null || num(matchup.matchupPeriodId) !== plan.matchupPeriodId) continue;
      const homeTeam = num(dict(matchup.home).teamId);
      const awayTeam = num(dict(matchup.away).teamId);
      if (homeTeam === null || awayTeam === null) continue;

      let draft = matchups.get(id);
      if (!draft) {
        draft = { winner: 'UNDECIDED', home: sideDraft(homeTeam), away: sideDraft(awayTeam) };
        matchups.set(id, draft);
      }
      const winner = str(matchup.winner);
      if (winner === 'HOME' || winner === 'AWAY') draft.winner = winner;

      for (const [key, side] of [['home', draft.home], ['away', draft.away]] as const) {
        const sideRaw = dict(matchup[key]);
        const total = num(sideRaw.totalPointsLive) ?? num(sideRaw.totalPoints);
        if (total !== null) side.total = total;
        const byDay = numbers(sideRaw.pointsByScoringPeriod);
        for (const [periodKey, points] of Object.entries(byDay)) side.pointsByDay[periodKey] = points;

        let dayPoints = 0;
        for (const rawEntry of list(dict(sideRaw.rosterForCurrentScoringPeriod).entries)) {
          const entry = dict(rawEntry);
          const pool = dict(entry.playerPoolEntry);
          const player = dict(pool.player);
          const playerId = num(pool.id) ?? num(player.id);
          if (playerId === null) continue;

          const proTeamId = num(player.proTeamId) ?? 0;
          const proTeam = NBA_TEAM_ABBREV[proTeamId] ?? '';
          let known = side.players.get(playerId);
          if (!known) {
            known = {
              id: playerId,
              name: str(player.fullName) ?? `Player ${playerId}`,
              position: POSITION_MAP[num(player.defaultPositionId) ?? -1] ?? '',
              proTeamId,
              proTeam,
              injuryStatus: str(player.injuryStatus),
              ...(figures.get(playerId) ?? emptyFigures()),
              days: {},
            };
            side.players.set(playerId, known);
          }

          const lineupSlotId = num(entry.lineupSlotId) ?? 12;
          const started = isActiveSlot(lineupSlotId);
          const row = dayStatRow(pool, player, day.scoringPeriodId);
          const stats = row ? toStatLine(numbers(row.stats)) : null;
          const points = num(pool.appliedStatTotal)
            ?? (row ? (num(row.appliedTotal) ?? (items.length > 0 ? computeFpts(numbers(row.stats), items) : 0)) : 0);
          const game = day.games && proTeam ? (day.games[proTeam] ?? null) : null;
          const played = (stats?.gp ?? 0) >= 1 || points !== 0 || (stats !== null && game?.status === 'final');
          known.days[String(day.scoringPeriodId)] = { lineupSlotId, started, points, stats, played, game };
          if (started) dayPoints += points;
        }
        if (!(String(day.scoringPeriodId) in side.pointsByDay)) {
          side.pointsByDay[String(day.scoringPeriodId)] = round1(dayPoints);
        }
      }
    }
  }

  const finishSide = (draft: SideDraft): ScoreSide => {
    const meta = teams.get(draft.teamId);
    const summed = round1(Object.values(draft.pointsByDay).reduce((sum, value) => sum + value, 0));
    return {
      teamId: draft.teamId,
      name: meta?.name ?? `Team ${draft.teamId}`,
      abbrev: meta?.abbrev ?? '',
      record: meta?.record ?? { wins: 0, losses: 0, ties: 0 },
      total: draft.total ?? summed,
      pointsByDay: draft.pointsByDay,
      players: [...draft.players.values()],
    };
  };

  return {
    ...plan,
    days,
    matchups: [...matchups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, draft]) => ({ id, winner: draft.winner, home: finishSide(draft.home), away: finishSide(draft.away) })),
    fetchedAt,
  };
}

// ─── What is left to play ───────────────────────────────────────────────────

/** Out or suspended: no games to come, whatever the schedule says. */
export function isOut(player: Pick<ScorePlayer, 'injuryStatus'>): boolean {
  return player.injuryStatus === 'OUT' || player.injuryStatus === 'SUSPENSION';
}

/** Games the Basketball Monster grid gives an NBA team in the league week that starts on `startDate`. */
export function gridGames(startDate: string, proTeamId: number): number | null {
  const period = leagueSchedule2027.find((entry) => entry.startDate === startDate);
  const games = period?.gamesByTeamId[proTeamId];
  return typeof games === 'number' ? games : null;
}

export interface GameLeft {
  scoringPeriodId: number;
  /** 1 for a game not started, the part left for a live one, a fraction for a day nobody can read. */
  share: number;
  live: boolean;
}

/** Minutes left as a share of a 48-minute game. A live game with no clock is half done. */
function liveShare(game: GameLine): number {
  if (game.minutesLeft === null) return 0.5;
  return Math.min(1, Math.max(0, game.minutesLeft / 48));
}

/**
 * Whether a player is in a scoring slot on a day. A day ESPN was not asked
 * about takes the latest lineup before it, which is what ESPN does with a
 * lineup nobody has touched.
 */
function startedOn(player: ScorePlayer, scoringPeriodId: number): boolean {
  const own = player.days[String(scoringPeriodId)];
  if (own) return own.started;
  let latest: PlayerDay | null = null;
  let latestId = -1;
  for (const [key, day] of Object.entries(player.days)) {
    const id = Number(key);
    if (id < scoringPeriodId && id > latestId) {
      latest = day;
      latestId = id;
    }
  }
  return latest?.started === true;
}

/**
 * The games one player can still score in this week: today's game if it
 * has not finished, then every later day he is in the lineup and his team
 * plays. A day whose games could not be read gets the grid's leftover
 * count spread evenly as a share. An out player has none. `anySlot` counts
 * his games whether or not he is in the lineup, which is what a bench
 * player's line shows: what he would give if started.
 */
export function gamesLeft(
  player: ScorePlayer,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>,
  anySlot = false,
): GameLeft[] {
  if (isOut(player) || !player.proTeam) return [];
  const today = week.currentScoringPeriodId;
  const left: GameLeft[] = [];

  let knownGames = 0;
  let unknownFutureDays = 0;
  for (const day of week.days) {
    if (day.games === null) {
      if (day.scoringPeriodId > today) unknownFutureDays += 1;
      continue;
    }
    const game = day.games[player.proTeam];
    if (game && game.status !== 'off') knownGames += 1;
  }
  const grid = week.days.length > 0 ? gridGames(week.days[0].date, player.proTeamId) : null;
  const unknownShare = grid === null || unknownFutureDays === 0
    ? 0
    : Math.min(1, Math.max(0, grid - knownGames) / unknownFutureDays);

  for (const day of week.days) {
    if (day.scoringPeriodId < today) continue;
    if (!anySlot && !startedOn(player, day.scoringPeriodId)) continue;
    if (day.games === null) {
      if (day.scoringPeriodId > today && unknownShare > 0) {
        left.push({ scoringPeriodId: day.scoringPeriodId, share: unknownShare, live: false });
      }
      continue;
    }
    const game = day.games[player.proTeam];
    if (!game || game.status === 'off' || game.status === 'final') continue;
    if (game.status === 'live') {
      left.push({ scoringPeriodId: day.scoringPeriodId, share: liveShare(game), live: true });
    } else {
      left.push({ scoringPeriodId: day.scoringPeriodId, share: 1, live: false });
    }
  }
  return left;
}

export interface PlayerWeek {
  total: number;
  played: number;
  left: number;
}

/**
 * A player's week in three numbers: points, games played, games still to
 * come. Points and games played count only started days. `anySlot` counts
 * the games to come whatever his slot, for a bench player's line.
 */
export function playerWeek(player: ScorePlayer, week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>, anySlot = false): PlayerWeek {
  let total = 0;
  let played = 0;
  for (const day of Object.values(player.days)) {
    if (!day.started) continue;
    total += day.points;
    if (day.played) played += 1;
  }
  const left = gamesLeft(player, week, anySlot).reduce((sum, game) => sum + (game.live ? 1 : game.share), 0);
  return { total: round1(total), played, left: Math.round(left) };
}

/** The players on a side with a game still to come this week, best first. */
export function yetToPlay(side: ScoreSide, week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>): ScorePlayer[] {
  return side.players
    .filter((player) => gamesLeft(player, week).length > 0)
    .sort((a, b) => (b.seasonAvg ?? 0) - (a.seasonAvg ?? 0));
}

/**
 * Started player-games that count so far this week: finished, or on the
 * floor now. The bench never counts. This is the number against the cap.
 */
export function gamesPlayed(side: ScoreSide, week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>): number {
  let used = 0;
  for (const player of side.players) {
    for (const day of week.days) {
      const playerDay = player.days[String(day.scoringPeriodId)];
      if (!playerDay?.started) continue;
      if (day.scoringPeriodId < week.currentScoringPeriodId) {
        if (playerDay.played) used += 1;
      } else if (day.scoringPeriodId === week.currentScoringPeriodId) {
        if (playerDay.game?.status === 'final' || playerDay.game?.status === 'live' || playerDay.played) used += 1;
      }
    }
  }
  return used;
}

/** Expected points for one player in his game on one day. */
export type ExpectedPoints = (player: ScorePlayer, scoringPeriodId: number) => number;

/** Future starts from known daily rosters; a dropped player cannot carry his old slot forward. */
export function lineupGamesLeft(side: ScoreSide, week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>): Array<{ player: ScorePlayer; game: GameLeft }> {
  const rosterDays = new Set(side.players.flatMap((player) => Object.keys(player.days)));
  return side.players.flatMap((player) => {
    const days = { ...player.days };
    for (const day of week.days) {
      const key = String(day.scoringPeriodId);
      if (!days[key] && rosterDays.has(key)) {
        days[key] = { lineupSlotId: 12, started: false, points: 0, stats: null, played: false, game: null };
      }
    }
    return gamesLeft({ ...player, days }, week).map((game) => ({ player, game }));
  });
}

export interface RemainingPlayerGame {
  /** Expected points for the whole game. */
  expected: number;
  /** The share still to play after overage deductions. */
  share: number;
  scoringPeriodId: number;
  live: boolean;
}

export interface OverageGame {
  playerId: number;
  scoringPeriodId: number;
  /** Projected final points removed, including any points already scored. */
  deduction: number;
  /** Already-scored points removed from the projection's fixed total. */
  scoredDeduction: number;
  /** One whole game, or a fraction when the schedule is only an estimate. */
  games: number;
}

export interface GamesCapProjection {
  remaining: RemainingPlayerGame[];
  overages: OverageGame[];
  scoredDeduction: number;
}

/**
 * Rule 6.5.1: deduct the highest-scoring games on the team's last day with
 * games until its count reaches the cap. Rank completed games by actual
 * points and unfinished games by their projected finish. If the excess
 * exhausts that day, continue back through earlier days in the same order.
 */
export function gamesCapProjection(
  side: ScoreSide,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'>,
  expected: ExpectedPoints,
): GamesCapProjection {
  const candidates: Array<RemainingPlayerGame & { playerId: number; scored: number; count: number; removed: number }> = [];
  const left = new Map(lineupGamesLeft(side, week).map(({ player, game }) => [`${player.id}:${game.scoringPeriodId}`, game]));
  for (const player of side.players) {
    for (const day of week.days) {
      const actual = player.days[String(day.scoringPeriodId)];
      const played = actual?.started === true && (day.scoringPeriodId < week.currentScoringPeriodId
        ? actual.played
        : day.scoringPeriodId === week.currentScoringPeriodId
          && (actual.played || actual.game?.status === 'live' || actual.game?.status === 'final'));
      const game = left.get(`${player.id}:${day.scoringPeriodId}`);
      if (!played && !game) continue;
      const points = game ? expected(player, day.scoringPeriodId) : 0;
      candidates.push({
        playerId: player.id, scoringPeriodId: day.scoringPeriodId,
        expected: Number.isFinite(points) ? Math.max(0, points) : 0,
        share: game?.share ?? 0, live: game?.live ?? false,
        scored: played ? actual?.points ?? 0 : 0,
        count: played || game?.live ? 1 : game?.share ?? 0, removed: 0,
      });
    }
  }
  const finish = (game: typeof candidates[number]) => game.scored + game.expected * game.share;
  let excess = week.gamesCap === null ? 0 : Math.max(0, candidates.reduce((sum, game) => sum + game.count, 0) - week.gamesCap);
  const ranked = [...candidates].sort((a, b) => b.scoringPeriodId - a.scoringPeriodId
    || finish(b) - finish(a) || a.playerId - b.playerId);
  const overages: OverageGame[] = [];
  for (const game of ranked) {
    if (excess < 1e-8) break;
    const removed = Math.min(game.count, excess);
    game.removed = removed / game.count;
    excess -= removed;
    overages.push({
      playerId: game.playerId, scoringPeriodId: game.scoringPeriodId, games: removed,
      deduction: finish(game) * game.removed, scoredDeduction: game.scored * game.removed,
    });
  }
  return {
    remaining: candidates.filter((game) => game.share > 0 && game.removed < 1)
      .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId)
      .map((game) => ({ expected: game.expected, share: game.share * (1 - game.removed), scoringPeriodId: game.scoringPeriodId, live: game.live })),
    overages,
    scoredDeduction: overages.reduce((sum, game) => sum + game.scoredDeduction, 0),
  };
}

/** Remaining games after the league's last-day overage deductions. */
export function remainingGames(
  side: ScoreSide,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'>,
  expected: ExpectedPoints,
): RemainingPlayerGame[] {
  return gamesCapProjection(side, week, expected).remaining;
}

/**
 * One side as the odds model sees it: points so far, plus each remaining
 * player-game at that player's expected points for that day.
 */
export function sideOdds(
  side: ScoreSide,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'>,
  expected: ExpectedPoints,
): SideOdds {
  const plan = gamesCapProjection(side, week, expected);
  const kept: RemainingGame[] = plan.remaining.map((game) => ({ expected: game.expected, share: game.share }));
  return { points: side.total - plan.scoredDeduction, remaining: kept };
}

/** Each side's chance of winning the matchup, in whole percents. */
export function matchupChance(
  matchup: ScoreMatchup,
  week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'>,
  expected: ExpectedPoints,
): { home: number; away: number } {
  if (matchup.winner === 'HOME') return { home: 100, away: 0 };
  if (matchup.winner === 'AWAY') return { home: 0, away: 100 };
  const chance: WinChance = winChance(sideOdds(matchup.home, week, expected), sideOdds(matchup.away, week, expected));
  return { home: chance.a, away: chance.b };
}

// ─── Words for the screen ───────────────────────────────────────────────────

/** "32 PTS, 11 REB, 6 AST, 2 STL, 1 BLK, 3 3PM, 2 TO". Zeros stay out, except points. */
export function statLineText(stats: StatLine | null): string {
  if (!stats) return '';
  const parts = [`${stats.pts} PTS`];
  const extras: Array<[number, string]> = [
    [stats.reb, 'REB'], [stats.ast, 'AST'], [stats.stl, 'STL'], [stats.blk, 'BLK'], [stats.threes, '3PM'], [stats.to, 'TO'],
  ];
  for (const [value, label] of extras) if (value > 0) parts.push(`${value} ${label}`);
  return parts.join(', ');
}

/**
 * "Final W 112-104 vs LAL", "7:30 PM @ DEN", "3rd Q 5:32 78-70 vs LAL".
 * `tipoffText` is the tip-off in the viewer's own clock, which only the
 * screen knows.
 */
export function gameText(game: GameLine | null, tipoffText: string | null): string {
  if (!game) return 'No game';
  const where = `${game.home ? 'vs' : '@'} ${game.opponent}`;
  if (game.status === 'off') return `Postponed ${where}`;
  if (game.status === 'upcoming') return `${tipoffText ?? 'Today'} ${where}`;
  const score = game.teamScore !== null && game.oppScore !== null ? `${game.teamScore}-${game.oppScore}` : '';
  if (game.status === 'live') return [game.clock ?? 'Live', score, where].filter(Boolean).join(' ');
  const result = game.teamScore === null || game.oppScore === null
    ? ''
    : game.teamScore > game.oppScore ? 'W' : game.teamScore < game.oppScore ? 'L' : 'T';
  return ['Final', result, score, where].filter(Boolean).join(' ');
}

/** "Giannis Antetokounmpo" as "G. Antetokounmpo", which fits a phone column. */
export { shortName } from './format.js';

/** "12-3" or "12-3-1". */
export function recordText(record: TeamRecord): string {
  return record.ties > 0 ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`;
}

/**
 * The day to open on: today when the week is the current one, the first
 * day of a week still to come, the last day of a week gone by.
 */
export function defaultDay(week: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId'>): number | null {
  if (week.days.length === 0) return null;
  const today = week.days.find((day) => day.scoringPeriodId === week.currentScoringPeriodId);
  if (today) return today.scoringPeriodId;
  if (week.days[0].scoringPeriodId > week.currentScoringPeriodId) return week.days[0].scoringPeriodId;
  return week.days[week.days.length - 1].scoringPeriodId;
}

/** The viewer's own matchup first, the rest in ESPN's order. */
export function orderForViewer(matchups: readonly ScoreMatchup[], espnTeamId: number | null): ScoreMatchup[] {
  if (espnTeamId === null) return [...matchups];
  const mine = matchups.filter((m) => m.home.teamId === espnTeamId || m.away.teamId === espnTeamId);
  const rest = matchups.filter((m) => !mine.includes(m));
  return [...mine, ...rest];
}

/** ESPN's lineup slots as the league reads them. UTIL is FLEX here. */
export const SLOT_LABELS: Readonly<Record<number, string>> = {
  0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F',
  7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'FLEX',
  12: 'BE', 13: 'IR', 20: 'BE', 21: 'IR', 23: 'IR+',
};

/**
 * Top to bottom as the league's lineup reads: PG, SG, SF, PF, C, F, G, the
 * three FLEX spots, then the bench, then IR. Anything ESPN adds later lands
 * between the starters and the bench.
 */
const SLOT_ORDER: readonly number[] = [0, 1, 2, 3, 4, 6, 5, 11, 7, 8, 9, 10, 12, 20, 13, 21, 23];

/** "PG", "FLEX", "BE". A slot nobody has named shows its number. */
export function slotLabel(lineupSlotId: number): string {
  return SLOT_LABELS[lineupSlotId] ?? String(lineupSlotId);
}

/** Where a slot sits in the lineup. Unknown slots sit after the known starters. */
export function slotRank(lineupSlotId: number): number {
  const index = SLOT_ORDER.indexOf(lineupSlotId);
  return index >= 0 ? index : SLOT_ORDER.indexOf(12) - 0.5;
}

/** The slot a player holds on a day, else his latest slot before it, else the bench. */
export function slotOn(player: ScorePlayer, scoringPeriodId: number): number {
  const own = player.days[String(scoringPeriodId)];
  if (own) return own.lineupSlotId;
  let latest = 12;
  let latestId = -1;
  for (const [key, day] of Object.entries(player.days)) {
    const id = Number(key);
    if (id < scoringPeriodId && id > latestId) {
      latest = day.lineupSlotId;
      latestId = id;
    }
  }
  return latest;
}

/** The slot a player held most recently this week, for the week view. */
export function latestSlot(player: ScorePlayer): number {
  let latest = 12;
  let latestId = -1;
  for (const [key, day] of Object.entries(player.days)) {
    const id = Number(key);
    if (id > latestId) {
      latest = day.lineupSlotId;
      latestId = id;
    }
  }
  return latest;
}

/** The lineup on one day: PG to FLEX, then the bench, then IR. */
export function lineupOrder(players: readonly ScorePlayer[], scoringPeriodId: number): ScorePlayer[] {
  return [...players].sort((a, b) =>
    slotRank(slotOn(a, scoringPeriodId)) - slotRank(slotOn(b, scoringPeriodId)) || a.name.localeCompare(b.name));
}

/** The week view in the same order, by each player's latest slot. */
export function weekOrder(players: readonly ScorePlayer[]): ScorePlayer[] {
  return [...players].sort((a, b) => slotRank(latestSlot(a)) - slotRank(latestSlot(b)) || a.name.localeCompare(b.name));
}

export interface InjuryBadge {
  text: string;
  tone: 'out' | 'doubt';
}

/** ESPN's red O and yellow DTD, as a badge beside the name. Null when he is fine. */
export function injuryBadge(status: string | null | undefined): InjuryBadge | null {
  switch (status) {
    case 'OUT': return { text: 'O', tone: 'out' };
    case 'SUSPENSION': return { text: 'SSPD', tone: 'out' };
    case 'DAY_TO_DAY': return { text: 'DTD', tone: 'doubt' };
    case 'QUESTIONABLE': return { text: 'Q', tone: 'doubt' };
    case 'DOUBTFUL': return { text: 'D', tone: 'doubt' };
    default: return null;
  }
}

/** Owner name by ESPN team id, from the league config. Owners are the key to everything. */
export function ownerByEspnTeamId(teams: ReadonlyArray<{ owner: string; espnTeamId: number }>): Map<number, string> {
  return new Map(teams.map((team) => [team.espnTeamId, team.owner]));
}
