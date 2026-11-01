/**
 * The live scoreboard on a house party: what each guest's players are doing
 * in the party's games, in this league's points.
 *
 * ESPN's game summary carries a box score per team: a list of stat keys and,
 * per player, a list of strings in the same order. `parseBoxScore` turns that
 * into ESPN fantasy stat ids, the same ids the draft rankings snapshot's
 * scoring items use, so `computeFpts` can score a line with no translation.
 * Double-doubles and the rarer ones are counted here, because the box score
 * does not carry them and the league pays for them.
 *
 * Matching a guest's roster to the box score goes by ESPN athlete id first.
 * Every player key in the dataset is `p<espnId>`, so the id is almost always
 * there. Names are the fallback, loosely compared and on the same team only,
 * for a player who came in by name alone.
 *
 * Pure. No server, no browser.
 */
import { computeFpts, round1 } from '../espn/calculations.js';
import { foulsByPeriod } from './fouls.js';
import { normalizeTeam, whoIsIn, type GameState, type HouseParty, type RosterPlayer, type RostersByOwner } from './houseParty.js';

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface ScoringItem {
  statId: number;
  points: number;
}

/**
 * The league's scoring as ESPN reports it, for when no draft rankings
 * snapshot has been accepted yet. Appendix A of the rule book says the same
 * numbers in words. ESPN has no 5x5 stat, so that one is not here.
 */
export const LEAGUE_SCORING: readonly ScoringItem[] = [
  { statId: 0, points: 1 },      // points
  { statId: 6, points: 1 },      // rebounds
  { statId: 3, points: 1.4 },    // assists
  { statId: 2, points: 2.5 },    // steals
  { statId: 1, points: 2.5 },    // blocks
  { statId: 13, points: 1 },     // field goals made
  { statId: 23, points: -0.7 },  // field goals missed
  { statId: 24, points: -0.5 },  // free throws missed
  { statId: 17, points: 0.5 },   // threes made
  { statId: 11, points: -1.8 },  // turnovers
  { statId: 37, points: 1.8 },   // double-double
  { statId: 38, points: 6.2 },   // triple-double
  { statId: 39, points: 170 },   // quadruple-double
];

/** ESPN's box score keys to its fantasy stat ids. Pairs like "5-8" split in two. */
const STAT_KEYS: Record<string, [string] | [string, string]> = {
  minutes: ['40'],
  points: ['0'],
  'fieldGoalsMade-fieldGoalsAttempted': ['13', '14'],
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': ['17', '18'],
  'freeThrowsMade-freeThrowsAttempted': ['15', '16'],
  rebounds: ['6'],
  offensiveRebounds: ['4'],
  defensiveRebounds: ['5'],
  assists: ['3'],
  steals: ['2'],
  blocks: ['1'],
  turnovers: ['11'],
  fouls: ['9'],
};

/** Points, rebounds, assists, steals, blocks: the categories a double-double counts. */
const TEN_PLUS = ['0', '6', '3', '2', '1'];

/**
 * Fill in what the box score leaves out: misses, and the double-double
 * family. A triple-double is also a double-double, which is how ESPN counts
 * them and how the league pays them.
 */
export function completeLine(stats: Record<string, number>): Record<string, number> {
  const out = { ...stats };
  if (out['14'] !== undefined && out['13'] !== undefined) out['23'] = Math.max(0, out['14'] - out['13']);
  if (out['16'] !== undefined && out['15'] !== undefined) out['24'] = Math.max(0, out['16'] - out['15']);
  const tens = TEN_PLUS.filter((id) => (out[id] ?? 0) >= 10).length;
  out['37'] = tens >= 2 ? 1 : 0;
  out['38'] = tens >= 3 ? 1 : 0;
  out['39'] = tens >= 4 ? 1 : 0;
  return out;
}

// ─── The box score ──────────────────────────────────────────────────────────

/** One player's line in one game. */
export interface BoxLine {
  /** ESPN's athlete id, as a string. */
  athleteId: string;
  name: string;
  /** "N. Jokic", as ESPN shortens it. */
  shortName: string;
  /** ESPN's team code. */
  team: string;
  /** ESPN's position letter, "G", "F" or "C". Missing on older saved box scores. */
  position?: string;
  /** False for a player listed but on the bench all night. */
  played: boolean;
  /** Explicit provider DNP, distinct from missing/zero-minute stats. */
  didNotPlay?: boolean;
  /** ESPN fantasy stat ids to values, misses and double-doubles filled in. */
  stats: Record<string, number>;
  /** On the floor now, by ESPN's box score. Only means something while the game runs. */
  onCourt?: boolean;
  /** Personal fouls in each period, 1st quarter first, from the play feed. */
  foulsByPeriod?: number[];
}

export interface BoxScore {
  gameId: string;
  state: GameState;
  /** "3rd 5:12", "Final". */
  detail: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  /** The period now, or the last one played. 0 before tip-off. */
  period?: number;
  lines: BoxLine[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** "5-8" is two numbers; "23" is one; "+8" and "--" are nothing useful. */
function statValues(raw: unknown): number[] {
  const value = text(raw);
  if (!value) return [];
  return value.split('-').map((part) => number(part.replace(/^\+/, '')) ?? 0);
}

/**
 * One player's stat strings, in the order the keys say, into stat ids.
 * Keys this file does not know are skipped, and a line shorter than its
 * keys stops early.
 */
export function lineStats(keys: readonly string[], values: readonly unknown[]): Record<string, number> {
  const stats: Record<string, number> = {};
  keys.forEach((key, index) => {
    const ids = STAT_KEYS[key];
    if (!ids || index >= values.length) return;
    const raw = values[index];
    const minutes = key === 'minutes' && typeof raw === 'string'
      ? /^(\d+):(\d{2})$/.exec(raw.trim()) : null;
    const parts = minutes
      ? [Number(minutes[1]) + Number(minutes[2]) / 60]
      : statValues(raw);
    ids.forEach((id, slot) => {
      stats[id] = parts[slot] ?? 0;
    });
  });
  return completeLine(stats);
}

/**
 * ESPN's game summary into one plain box score, or null when the answer is
 * not a game at all. A game before tip-off has no player lines and that is
 * fine: the state says so.
 */
export function parseBoxScore(raw: unknown, gameId: string): BoxScore | null {
  const root = record(raw);
  if (!root) return null;
  const header = record(root.header);
  const competition = record(Array.isArray(header?.competitions) ? header?.competitions[0] : null);
  const status = record(competition?.status);
  const type = record(status?.type);
  const stateText = text(type?.state);
  const state: GameState = stateText === 'in' ? 'in' : stateText === 'post' ? 'post' : 'pre';
  let home = '';
  let away = '';
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  for (const side of Array.isArray(competition?.competitors) ? competition.competitors : []) {
    const competitor = record(side);
    const code = normalizeTeam(text(record(competitor?.team)?.abbreviation));
    if (!competitor || !code) continue;
    if (competitor.homeAway === 'home') {
      home = code;
      homeScore = number(competitor.score);
    } else if (competitor.homeAway === 'away') {
      away = code;
      awayScore = number(competitor.score);
    }
  }
  const lines: BoxLine[] = [];
  const fouls = foulsByPeriod(root);
  const boxscore = record(root.boxscore);
  for (const entry of Array.isArray(boxscore?.players) ? boxscore.players : []) {
    const side = record(entry);
    const team = normalizeTeam(text(record(side?.team)?.abbreviation)) ?? '';
    for (const block of Array.isArray(side?.statistics) ? side.statistics : []) {
      const table = record(block);
      const keys = Array.isArray(table?.keys) ? table.keys.filter((key): key is string => typeof key === 'string') : [];
      for (const row of Array.isArray(table?.athletes) ? table.athletes : []) {
        const athleteRow = record(row);
        const athlete = record(athleteRow?.athlete);
        const athleteId = text(athlete?.id);
        const name = text(athlete?.displayName);
        if (!athleteId && !name) continue;
        const values = Array.isArray(athleteRow?.stats) ? athleteRow.stats : [];
        const stats = lineStats(keys, values);
        const played = athleteRow?.didNotPlay !== true && (stats['40'] ?? 0) > 0;
        const byPeriod = fouls.get(athleteId);
        lines.push({
          athleteId, name, shortName: text(athlete?.shortName), team, played, stats,
          ...(athleteRow?.didNotPlay === true ? { didNotPlay: true } : {}),
          ...(text(record(athlete?.position)?.abbreviation) ? { position: text(record(athlete?.position)?.abbreviation) } : {}),
          onCourt: athleteRow?.active === true,
          ...(byPeriod ? { foulsByPeriod: byPeriod } : {}),
        });
      }
    }
  }
  if (!home && !away && lines.length === 0) return null;
  return {
    gameId,
    state,
    detail: text(type?.shortDetail) || text(type?.detail),
    home,
    away,
    homeScore,
    awayScore,
    period: number(status?.period) ?? 0,
    lines,
  };
}

// ─── Matching ───────────────────────────────────────────────────────────────

/** "Nikola Jokić Jr." and "nikola jokic" are the same name. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((part) => part && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(part))
    .join(' ');
}

/** "N. Jokic" from a full name, the way the dataset shortens one. */
function shortKey(name: string): string {
  const parts = nameKey(name).split(' ');
  if (parts.length < 2) return parts.join(' ');
  return `${parts[0][0]} ${parts.slice(1).join(' ')}`;
}

/** The ESPN id behind a roster player: the field, or the `p<id>` key. */
export function espnIdOf(player: Pick<RosterPlayer, 'key' | 'espnId'>): string | null {
  if (typeof player.espnId === 'number' && player.espnId > 0) return String(player.espnId);
  const match = /^p(\d+)$/.exec(player.key);
  return match ? match[1] : null;
}

/**
 * The box line for one roster player: by ESPN id, then by name on the same
 * team. A name alone never crosses teams, so two players called the same
 * thing on different sides of a game cannot swap.
 */
export function findLine(player: RosterPlayer, lines: readonly BoxLine[]): BoxLine | null {
  const id = espnIdOf(player);
  if (id) {
    const byId = lines.find((line) => line.athleteId === id);
    if (byId) return byId;
  }
  const team = normalizeTeam(player.proTeam);
  const same = team ? lines.filter((line) => line.team === team) : lines;
  const full = nameKey(player.name);
  const short = shortKey(player.name);
  return same.find((line) => nameKey(line.name) === full)
    ?? same.find((line) => shortKey(line.name) === short || nameKey(line.shortName) === short)
    ?? null;
}

// ─── The party ──────────────────────────────────────────────────────────────

/** One guest's player in one of the party's games, scored. */
export interface ScoredPlayer {
  key: string;
  name: string;
  team: string;
  gameId: string;
  /** Null until the game starts or when the player is not in the box score. */
  fpts: number | null;
  /** "24 pts, 11 reb, 6 ast" for a tooltip. Empty before tip-off. */
  line: string;
  played: boolean;
}

export interface GuestScore {
  owner: string;
  total: number;
  players: ScoredPlayer[];
}

/** "24 pts, 11 reb, 6 ast, 2 stl, 1 blk, 3 to". Zeros are left out. */
export function statLine(stats: Readonly<Record<string, number>>): string {
  const parts: Array<[string, string]> = [['0', 'pts'], ['6', 'reb'], ['3', 'ast'], ['2', 'stl'], ['1', 'blk'], ['17', '3pm'], ['11', 'to']];
  const words = parts.filter(([id]) => (stats[id] ?? 0) > 0).map(([id, label]) => `${stats[id]} ${label}`);
  if (stats['40'] !== undefined) words.unshift(`${round1(stats['40'])} min`);
  if (stats['39']) words.push('quadruple-double');
  else if (stats['38']) words.push('triple-double');
  else if (stats['37']) words.push('double-double');
  if (stats['9'] !== undefined) words.push(`${stats['9']} fouls`);
  return words.join(', ');
}

/** Score one box line in the league's points. */
export function scoreLine(line: Pick<BoxLine, 'stats'>, scoring: readonly ScoringItem[]): number {
  return computeFpts(line.stats, [...scoring]);
}

/**
 * Every guest's players in the party's games, scored, most points first.
 * A game with no box score yet contributes players with no points, so the
 * strip still shows who is coming up.
 */
export function partyScores(
  party: Pick<HouseParty, 'games' | 'rsvps'>,
  rosters: RostersByOwner,
  boxScores: readonly BoxScore[],
  scoring: readonly ScoringItem[] = LEAGUE_SCORING,
): GuestScore[] {
  const byGame = new Map(boxScores.map((box) => [box.gameId, box]));
  return whoIsIn(party)
    .map((owner): GuestScore => {
      const players: ScoredPlayer[] = [];
      for (const game of party.games) {
        const box = byGame.get(game.id) ?? null;
        for (const player of rosters[owner] ?? []) {
          const team = normalizeTeam(player.proTeam);
          if (team !== game.home && team !== game.away) continue;
          const line = box && box.state !== 'pre' ? findLine(player, box.lines) : null;
          players.push({
            key: player.key,
            name: player.name,
            team: team ?? player.proTeam,
            gameId: game.id,
            fpts: line ? scoreLine(line, scoring) : null,
            line: line ? statLine(line.stats) : '',
            played: line?.played ?? false,
          });
        }
      }
      players.sort((a, b) => (b.fpts ?? -1) - (a.fpts ?? -1) || a.name.localeCompare(b.name));
      return { owner, total: round1(players.reduce((sum, player) => sum + (player.fpts ?? 0), 0)), players };
    })
    .sort((a, b) => b.total - a.total || b.players.length - a.players.length || a.owner.localeCompare(b.owner));
}

/** Whether any of the party's games has tipped off, by the clock alone. */
export function partyStarted(party: Pick<HouseParty, 'games'>, now: Date): boolean {
  return party.games.some((game) => Date.parse(game.tipoff) <= now.getTime());
}
