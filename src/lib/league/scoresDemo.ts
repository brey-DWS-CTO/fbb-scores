/**
 * A whole fake week for the SCORES screens, for the days before ESPN has a
 * real one and for the tests.
 *
 * It builds the same shapes ESPN sends (a settings payload, one league
 * payload per day, one public NBA scoreboard per day) and runs them through
 * the same reader production uses, so a screen that looks right on the demo
 * is reading real fields. Teams are the league's ten, rosters are each
 * owner's final 2026 roster, and every number comes from a seeded generator
 * so the page looks the same on every load.
 *
 * Pure. No server, no browser.
 */
import { computeFpts, NBA_TEAM_ABBREV } from '../espn/calculations.js';
import { leagueDataset } from './data.js';
import { nbaTeamIdForProTeam } from './schedule.js';
import { planWeek, readEspnWeek, readNbaScoreboard, type EspnDayInput, type GameLine, type ScoresWeek } from './scores.js';

/** The league's scoring in ESPN stat ids, as the rule book's Appendix A lists it. */
export const DEMO_SCORING = [
  { statId: 0, points: 1 },
  { statId: 6, points: 1 },
  { statId: 3, points: 1.4 },
  { statId: 2, points: 2.5 },
  { statId: 1, points: 2.5 },
  { statId: 13, points: 1 },
  { statId: 17, points: 0.5 },
  { statId: 11, points: -1.8 },
  { statId: 37, points: 1.8 },
  { statId: 38, points: 6.2 },
];

/** The demo is week 3, read on Thursday 5 November 2026 with games under way. */
export const DEMO_MATCHUP_PERIOD = 3;
export const DEMO_TODAY = '2026-11-05';
const SEASON_START = '2026-10-19';
const DEMO_TODAY_PERIOD = 18;

const POSITION_ID: Record<string, number> = { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 };

/** The league's ten scoring slots in ESPN's ids: PG, SG, SF, PF, C, G, F and three FLEX. */
const STARTER_SLOTS = [0, 1, 2, 3, 4, 5, 6, 11, 11, 11];

/** A small seeded random source, so the demo never changes under anyone. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Matchup periods as ESPN lists them: 16 weeks of 7 days, then 7, then three of 14. */
function matchupPeriods(): Record<string, number[]> {
  const periods: Record<string, number[]> = {};
  let next = 1;
  const lengths = [...Array.from({ length: 17 }, () => 7), 14, 14, 14];
  lengths.forEach((length, index) => {
    periods[String(index + 1)] = Array.from({ length }, (_, offset) => next + offset);
    next += length;
  });
  return periods;
}

interface ProGame {
  home: number;
  away: number;
}

/** Every NBA team's games by scoring period, three to four a week each. */
function proSchedule(random: () => number, lastPeriod: number): Map<number, ProGame[]> {
  const games = new Map<number, ProGame[]>();
  const teamIds = Object.keys(NBA_TEAM_ABBREV).map(Number);
  for (let period = 1; period <= lastPeriod; period += 1) {
    const dayOfWeek = (period - 1) % 7;
    // Fewer games on Sunday and Thursday, the way the NBA week runs.
    const count = dayOfWeek === 6 ? 3 : dayOfWeek === 3 ? 5 : 7;
    const pool = [...teamIds];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const todays: ProGame[] = [];
    for (let g = 0; g < count; g += 1) todays.push({ home: pool[g * 2], away: pool[g * 2 + 1] });
    games.set(period, todays);
  }
  return games;
}

interface DemoPlayer {
  id: number;
  fullName: string;
  positionId: number;
  proTeamId: number;
  injuryStatus: string;
  avg: number;
  lineupSlotId: number;
}

/** Each owner's final 2026 roster, best players started, up to 13 deep. */
function demoRosters(): Map<number, DemoPlayer[]> {
  const byTeam = new Map<number, DemoPlayer[]>();
  const spare = leagueDataset.players
    .filter((player) => player.fantasyTeam === null && player.espnId !== null)
    .sort((a, b) => (b.stats2026?.avg ?? 0) - (a.stats2026?.avg ?? 0));
  for (const team of leagueDataset.teams) {
    const own = leagueDataset.players
      .filter((player) => player.fantasyTeam === team.owner && player.espnId !== null)
      .sort((a, b) => (b.stats2026?.avg ?? 0) - (a.stats2026?.avg ?? 0));
    while (own.length < 13 && spare.length > 0) own.push(spare.shift() as (typeof own)[number]);
    const roster = own.slice(0, 13).map((player, index): DemoPlayer => {
      const out = player.injuryStatus === 'OUT';
      return {
        id: player.espnId as number,
        fullName: player.fullName ?? player.name,
        positionId: POSITION_ID[player.positions[0] ?? 'SF'] ?? 3,
        proTeamId: nbaTeamIdForProTeam(player.proTeam) ?? 0,
        injuryStatus: player.injuryStatus ?? 'ACTIVE',
        avg: player.stats2026?.avg ?? player.prior?.avg ?? 12,
        lineupSlotId: out ? 13 : index < 10 ? index : 12,
      };
    });
    // An OUT player sits on IR; the next man up takes his slot.
    let slot = 0;
    for (const player of roster) {
      if (player.lineupSlotId === 13) continue;
      player.lineupSlotId = STARTER_SLOTS[slot] ?? 12;
      slot += 1;
    }
    byTeam.set(team.espnTeamId, roster);
  }
  return byTeam;
}

/** A box score around a player's average, scaled by how much of the game is gone. */
function boxScore(random: () => number, avg: number, share: number): Record<string, number> {
  const wobble = () => Math.max(0.3, 1 + 0.3 * gaussian(random));
  const count = (base: number) => Math.max(0, Math.round(base * share * wobble()));
  const pts = count(avg * 0.5);
  const reb = count(avg * 0.17);
  const ast = count(avg * 0.13);
  const stats: Record<string, number> = {
    '0': pts,
    '6': reb,
    '3': ast,
    '2': count(1.1),
    '1': count(0.7),
    '13': Math.round(pts * 0.37),
    '17': count(avg * 0.04),
    '11': count(avg * 0.05),
    '40': Math.round(34 * share),
    '42': 1,
  };
  const tens = [pts, reb, ast].filter((value) => value >= 10).length;
  if (tens >= 2) stats['37'] = 1;
  if (tens >= 3) stats['38'] = 1;
  return stats;
}

function tipMs(iso: string, hour: number): number {
  return Date.parse(`${iso}T${String(hour).padStart(2, '0')}:30:00-05:00`);
}

/** The public scoreboard for one day: finals before today, a mix today, nothing started after. */
function publicScoreboard(random: () => number, period: number, iso: string, games: ProGame[]) {
  const code = (teamId: number) => NBA_TEAM_ABBREV[teamId];
  return {
    events: games.map((game, index) => {
      const hour = 19 + (index % 3);
      const past = period < DEMO_TODAY_PERIOD;
      const today = period === DEMO_TODAY_PERIOD;
      const final = past || (today && index < 2);
      const live = today && index === 2;
      const homeScore = final ? 95 + Math.floor(random() * 30) : live ? 78 : null;
      const awayScore = final ? 95 + Math.floor(random() * 30) : live ? 70 : null;
      const status = final
        ? { type: { name: 'STATUS_FINAL', state: 'post' } }
        : live
          ? { clock: 332, displayClock: '5:32', period: 3, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } }
          : { type: { name: 'STATUS_SCHEDULED', state: 'pre' } };
      return {
        date: new Date(tipMs(iso, hour)).toISOString(),
        competitions: [{
          date: new Date(tipMs(iso, hour)).toISOString(),
          status,
          competitors: [
            { homeAway: 'home', score: homeScore === null ? undefined : String(homeScore), team: { abbreviation: code(game.home) } },
            { homeAway: 'away', score: awayScore === null ? undefined : String(awayScore), team: { abbreviation: code(game.away) } },
          ],
        }],
      };
    }),
  };
}

/**
 * The demo week, ready for the screens. Deterministic for a given seed.
 */
export function demoWeek(seed = 7): ScoresWeek {
  const random = mulberry32(seed);
  const periods = matchupPeriods();
  const lastPeriod = Math.max(...Object.values(periods).flat());
  const schedule = proSchedule(random, lastPeriod);
  const rosters = demoRosters();
  const dateOf = (period: number) => addDays(SEASON_START, period - 1);

  const proTeams = Object.keys(NBA_TEAM_ABBREV).map(Number).map((id) => {
    const byPeriod: Record<string, Array<{ date: number }>> = {};
    for (const [period, games] of schedule) {
      const index = games.findIndex((game) => game.home === id || game.away === id);
      if (index >= 0) byPeriod[String(period)] = [{ date: tipMs(dateOf(period), 19 + (index % 3)) }];
    }
    return { id, abbrev: NBA_TEAM_ABBREV[id], proGamesByScoringPeriod: byPeriod };
  });

  const teams = [...leagueDataset.teams]
    .sort((a, b) => a.draftPosition - b.draftPosition)
    .map((team, index) => {
      const wins = index % 3 === 0 ? 2 : index % 3 === 1 ? 1 : 0;
      return {
        id: team.espnTeamId,
        name: team.espnTeamName,
        abbrev: team.owner.slice(0, 4).toUpperCase(),
        record: { overall: { wins, losses: 2 - wins, ties: 0 } },
        roster: {
          entries: (rosters.get(team.espnTeamId) ?? []).map((player) => ({
            playerPoolEntry: {
              id: player.id,
              player: {
                id: player.id,
                fullName: player.fullName,
                stats: [{
                  statSplitTypeId: 0,
                  statSourceId: 0,
                  seasonId: 2027,
                  stats: { '0': Math.round(player.avg * 0.5 * 8), '6': Math.round(player.avg * 0.17 * 8), '3': Math.round(player.avg * 0.13 * 8), '13': Math.round(player.avg * 0.19 * 8), '42': 8 },
                }],
              },
            },
          })),
        },
      };
    });

  const settings = {
    seasonId: 2027,
    scoringPeriodId: DEMO_TODAY_PERIOD,
    status: { currentMatchupPeriod: DEMO_MATCHUP_PERIOD, latestScoringPeriod: DEMO_TODAY_PERIOD },
    settings: {
      scheduleSettings: { matchupPeriods: periods },
      rosterSettings: { lineupSlotStatLimits: { '15': { statId: 42, limitValue: 30 / 7 } } },
      scoringSettings: { scoringItems: DEMO_SCORING },
      proTeams,
    },
    teams,
  };

  const plan = planWeek(settings, DEMO_MATCHUP_PERIOD, DEMO_TODAY);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < teams.length; i += 2) pairs.push([teams[i].id, teams[i + 1].id]);

  // What every player did on every day, so day scores and totals agree.
  const dayPoints = new Map<string, { points: number; stats: Record<string, number> | null }>();
  const key = (playerId: number, period: number) => `${playerId}:${period}`;
  const gamesByPeriod = new Map<number, Record<string, GameLine>>();
  for (const day of plan.days) {
    const board = readNbaScoreboard(publicScoreboard(random, day.scoringPeriodId, day.date, schedule.get(day.scoringPeriodId) ?? []));
    gamesByPeriod.set(day.scoringPeriodId, board);
    for (const roster of rosters.values()) {
      for (const player of roster) {
        const game = board[NBA_TEAM_ABBREV[player.proTeamId] ?? ''];
        const sits = player.injuryStatus === 'OUT' || !game || game.status === 'upcoming';
        if (sits) {
          dayPoints.set(key(player.id, day.scoringPeriodId), { points: 0, stats: null });
          continue;
        }
        const share = game.status === 'live' ? 1 - (game.minutesLeft ?? 24) / 48 : 1;
        const stats = boxScore(random, player.avg, share);
        dayPoints.set(key(player.id, day.scoringPeriodId), { points: computeFpts(stats, DEMO_SCORING), stats });
      }
    }
  }

  const sideFor = (teamId: number, period: number) => {
    const roster = rosters.get(teamId) ?? [];
    const byDay: Record<string, number> = {};
    let settled = 0;
    let live = 0;
    for (const day of plan.days) {
      let sum = 0;
      for (const player of roster) {
        if (player.lineupSlotId >= 10) continue;
        sum += dayPoints.get(key(player.id, day.scoringPeriodId))?.points ?? 0;
      }
      byDay[String(day.scoringPeriodId)] = Math.round(sum * 10) / 10;
      if (day.scoringPeriodId < DEMO_TODAY_PERIOD) settled += sum;
      if (day.scoringPeriodId <= DEMO_TODAY_PERIOD) live += sum;
    }
    return {
      teamId,
      totalPoints: Math.round(settled * 10) / 10,
      totalPointsLive: Math.round(live * 10) / 10,
      pointsByScoringPeriod: byDay,
      rosterForCurrentScoringPeriod: {
        entries: roster.map((player) => {
          const done = dayPoints.get(key(player.id, period));
          return {
            lineupSlotId: player.lineupSlotId,
            playerPoolEntry: {
              id: player.id,
              appliedStatTotal: done?.points ?? 0,
              player: {
                id: player.id,
                fullName: player.fullName,
                defaultPositionId: player.positionId,
                proTeamId: player.proTeamId,
                injuryStatus: player.injuryStatus,
                stats: done?.stats
                  ? [{ statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: period, stats: done.stats, appliedTotal: done.points }]
                  : [],
              },
            },
          };
        }),
      },
    };
  };

  const days: EspnDayInput[] = plan.days.map((day) => ({
    scoringPeriodId: day.scoringPeriodId,
    date: day.date,
    games: gamesByPeriod.get(day.scoringPeriodId) ?? null,
    payload: {
      seasonId: 2027,
      scoringPeriodId: day.scoringPeriodId,
      schedule: pairs.map(([home, away], index) => ({
        id: 300 + index + 1,
        matchupPeriodId: DEMO_MATCHUP_PERIOD,
        winner: 'UNDECIDED',
        home: sideFor(home, day.scoringPeriodId),
        away: sideFor(away, day.scoringPeriodId),
      })),
    },
  }));

  return readEspnWeek({ plan, settings, days, fetchedAt: `${DEMO_TODAY}T19:45:00-08:00` });
}
