/**
 * A player's recent games from ESPN's game log, scored in league points.
 * ESPN's feed allows calls from the browser, so the player card reads it
 * directly.
 *
 * Pure. No server, no browser.
 */
import { round1 } from '../espn/calculations.js';
import { completeLine, scoreLine, type ScoringItem } from './partyScore.js';
import { liveClock, performerGameText, type DailyNbaScores } from './dailyScorers.js';
import { normalizeTeam } from './houseParty.js';

export interface LogGame {
  eventId: string;
  /** Tip-off, ISO. */
  date: string;
  /** "2026-27". */
  season: string;
  home: boolean;
  /** The other team's code, "MIL". */
  opp: string;
  result: 'W' | 'L' | null;
  teamScore: number | null;
  oppScore: number | null;
  /** ESPN fantasy stat ids, misses and double-doubles filled in. */
  stats: Record<string, number>;
}

export interface GameLog {
  /** ESPN's season id: 2027 is 2026-27. */
  seasonId: number | null;
  games: LogGame[];
}

export function gameLogUrl(playerId: number, seasonId?: number): string {
  const base = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`;
  return seasonId === undefined ? base : `${base}?season=${seasonId}`;
}

// ESPN's column names to fantasy stat ids. A "made-attempted" column fills two.
const COLUMNS: Record<string, string | [string, string]> = {
  minutes: '40',
  'fieldGoalsMade-fieldGoalsAttempted': ['13', '14'],
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': ['17', '18'],
  'freeThrowsMade-freeThrowsAttempted': ['15', '16'],
  totalRebounds: '6',
  assists: '3',
  blocks: '1',
  steals: '2',
  fouls: '9',
  turnovers: '11',
  points: '0',
};

const num = (value: unknown): number | null => {
  const n = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(n) ? null : n;
};

/** Regular season and play-in games, newest first. Preseason and playoffs are left out. */
export function readGameLog(body: unknown): GameLog {
  const root = (body ?? {}) as Record<string, unknown>;
  const names = Array.isArray(root.names) ? root.names.map(String) : [];
  const events = (root.events ?? {}) as Record<string, Record<string, unknown>>;
  const filters = Array.isArray(root.filters) ? root.filters as Array<Record<string, unknown>> : [];
  const seasonId = num(filters.find((filter) => filter.name === 'season')?.value);
  const games: LogGame[] = [];
  const seen = new Set<string>();
  for (const type of Array.isArray(root.seasonTypes) ? root.seasonTypes as Array<Record<string, unknown>> : []) {
    const label = String(type.displayName ?? '');
    if (/preseason|postseason/i.test(label)) continue;
    const season = /^\d{4}-\d{2}/.exec(label)?.[0] ?? '';
    for (const category of Array.isArray(type.categories) ? type.categories as Array<Record<string, unknown>> : []) {
      for (const row of Array.isArray(category.events) ? category.events as Array<Record<string, unknown>> : []) {
        const eventId = String(row.eventId ?? '');
        const event = events[eventId];
        if (!eventId || !event || seen.has(eventId)) continue;
        seen.add(eventId);
        const values = Array.isArray(row.stats) ? row.stats.map(String) : [];
        const stats: Record<string, number> = {};
        names.forEach((name, index) => {
          const ids = COLUMNS[name];
          const value = values[index] ?? '';
          if (Array.isArray(ids)) {
            const [made, tried] = value.split('-').map(Number);
            if (Number.isFinite(made) && Number.isFinite(tried)) { stats[ids[0]] = made; stats[ids[1]] = tried; }
          } else if (ids && num(value) !== null) {
            stats[ids] = Number(value);
          }
        });
        const opp = (event.opponent ?? {}) as Record<string, unknown>;
        const home = String(event.homeTeamId ?? '') !== String(opp.id ?? '');
        const homeScore = num(event.homeTeamScore), awayScore = num(event.awayTeamScore);
        games.push({
          eventId,
          date: String(event.gameDate ?? ''),
          season,
          home,
          opp: normalizeTeam(opp.abbreviation) ?? String(opp.abbreviation ?? ''),
          result: event.gameResult === 'W' || event.gameResult === 'L' ? event.gameResult : null,
          teamScore: home ? homeScore : awayScore,
          oppScore: home ? awayScore : homeScore,
          stats: completeLine(stats),
        });
      }
    }
  }
  return { seasonId, games: games.sort((a, b) => b.date.localeCompare(a.date)) };
}

export function gameFantasyPoints(game: Pick<LogGame, 'stats'>, scoring: readonly ScoringItem[]): number {
  return scoreLine(game, scoring);
}

/** Average fantasy points and minutes. Null for no games. */
export function logAverages(games: readonly LogGame[], scoring: readonly ScoringItem[]): { fpts: number; min: number } | null {
  if (games.length === 0) return null;
  const total = (pick: (game: LogGame) => number) => games.reduce((sum, game) => sum + pick(game), 0) / games.length;
  return { fpts: round1(total((game) => gameFantasyPoints(game, scoring))), min: round1(total((game) => game.stats['40'] ?? 0)) };
}

/** "19 min · 13 pts · 2 reb · 3 ast · 1 stl", skipping the zeros after points. */
export function logLine(stats: Readonly<Record<string, number>>): string {
  const parts: Array<[string, string]> = [['6', 'reb'], ['3', 'ast'], ['2', 'stl'], ['1', 'blk'], ['17', '3pm'], ['11', 'to']];
  return [`${stats['40'] ?? 0} min`, `${stats['0'] ?? 0} pts`, ...parts.filter(([id]) => (stats[id] ?? 0) > 0).map(([id, label]) => `${stats[id]} ${label}`)].join(' · ');
}

export interface TodayGame {
  gameId: string;
  home: boolean;
  opp: string;
  state: 'pre' | 'in' | 'post';
  /** "LIVE · Q2 10:15" or "F 120-110". Empty before tip-off; show the tip time. */
  status: string;
  /** Tip-off, ISO. */
  tipoff: string;
  /** His box score line so far. Null before he plays. */
  stats: Record<string, number> | null;
}

/**
 * His team's game today, from our daily scores, for the top of the log.
 * ESPN's game log only lists a game once it ends, so a finished game the
 * log already has is left out.
 */
export function todayGame(day: DailyNbaScores | undefined, proTeam: string, playerId: number, logged: readonly LogGame[]): TodayGame | null {
  const team = normalizeTeam(proTeam);
  const game = team ? day?.games.find((entry) => entry.home === team || entry.away === team) : undefined;
  if (!team || !game || logged.some((entry) => entry.eventId === game.id)) return null;
  const box = day?.boxScores.find((entry) => entry.gameId === game.id);
  const line = box?.lines.find((entry) => entry.athleteId === String(playerId) && entry.played);
  const live = { ...game, detail: box?.detail || game.detail, homeScore: box?.homeScore ?? game.homeScore, awayScore: box?.awayScore ?? game.awayScore };
  return {
    gameId: game.id,
    home: game.home === team,
    opp: game.home === team ? game.away : game.home,
    state: game.state,
    status: game.state === 'in' ? `LIVE · ${liveClock(live.detail)}` : game.state === 'post' ? performerGameText(live, team) : '',
    tipoff: game.tipoff,
    stats: line?.stats ?? null,
  };
}

/** "W 115-93", his team's score first. */
export function resultText(game: Pick<LogGame, 'result' | 'teamScore' | 'oppScore'>): string {
  const score = game.teamScore !== null && game.oppScore !== null ? `${game.teamScore}-${game.oppScore}` : '';
  return [game.result, score].filter(Boolean).join(' ');
}
