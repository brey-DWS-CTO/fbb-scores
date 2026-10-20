/**
 * Outside projections, laid over ESPN's for the commissioner alone.
 *
 * Hashtag Basketball publishes a per-game line already split into what this
 * league scores: makes, missed field goals, missed free throws, double- and
 * triple-doubles. The commissioner picks ESPN, Hashtag, or a 50/50 blend of
 * the two. The pick rewrites each matched player's projection row in the
 * snapshot, so points, the bonus, season totals, the board and the mock draft
 * all read it through code they already use. A player Hashtag leaves out
 * keeps ESPN's line. Owners' own edits go on top of whichever source.
 *
 * Hashtag has no minutes or free throws made, so those come from ESPN's line
 * when he has one.
 *
 * Pure. No server, no browser.
 */
import { bonusOdds } from './doubleDoubles.js';
import { projectedPerGame, type DraftRankingPlayer, type DraftRankingSnapshot, type ProjectionRow } from './draftRankings.js';
import { nameKey } from './nbaWatch.js';

export type ProjectionSource = 'espn' | 'hashtag' | 'blend';

export const PROJECTION_SOURCES: readonly { id: ProjectionSource; label: string }[] = [
  { id: 'espn', label: 'ESPN' },
  { id: 'hashtag', label: 'Hashtag' },
  { id: 'blend', label: 'Blend' },
];

export function sourceLabel(source: ProjectionSource): string {
  return PROJECTION_SOURCES.find((entry) => entry.id === source)?.label ?? 'ESPN';
}

/** One player's outside line. */
export interface ExpertLine {
  name: string;
  team: string;
  games: number;
  /** Per game, by ESPN stat id. */
  perGame: Record<string, number>;
}

export interface ExpertProjections {
  source: 'hashtag';
  /** The day the numbers were copied. */
  updated: string;
  players: ExpertLine[];
}

// ─── Reading a Hashtag paste ────────────────────────────────────────────────

/**
 * Hashtag's columns after TOTAL and GP, as ESPN stat ids: PTS, TREB, AST,
 * STL, BLK, 3PM, FGM, FGMI, FTMI, TO, DD, TD.
 */
const HASHTAG_STATS = ['0', '6', '3', '2', '1', '17', '13', '23', '24', '11', '37', '38'] as const;

/**
 * The rows of a copy of Hashtag's projections table. Each player starts with
 * a rank and name, then one line per position, then the team and the numbers.
 */
export function parseHashtagPaste(text: string): ExpertLine[] {
  const out: ExpertLine[] = [];
  let name: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split('\t').map((cell) => cell.trim());
    if (/^\d+$/.test(cells[0]) && cells[1]) {
      name = cells[1];
      continue;
    }
    if (!name || cells.length < 3) continue;
    const numbers = cells.slice(1).filter((cell) => cell !== '').map(Number);
    if (numbers.length !== HASHTAG_STATS.length + 2 || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(`Could not read the numbers for ${name}.`);
    }
    const [, games, ...stats] = numbers;
    const perGame: Record<string, number> = {};
    HASHTAG_STATS.forEach((id, index) => { perGame[id] = stats[index]; });
    perGame['14'] = perGame['13'] + perGame['23'];
    out.push({ name, team: cells[0], games, perGame });
    name = null;
  }
  return out;
}

// ─── Laying a source over ESPN ──────────────────────────────────────────────

/** Names a source spells differently from ESPN, as name keys. */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  'alexandre sarr': 'alex sarr',
  'nicolas claxton': 'nic claxton',
};

const matchKey = (name: string) => {
  const key = nameKey(name);
  return NAME_ALIASES[key] ?? key;
};

/** Hashtag's team codes where ESPN's differ. */
const TEAM_ALIASES: Readonly<Record<string, string>> = { GS: 'GSW', NO: 'NOP', NY: 'NYK', PHO: 'PHX', SA: 'SAS' };

/** Outside lines keyed by ESPN id, and the names that matched nobody. Team breaks a tie between two of one name. */
export function matchExpert(
  players: readonly (Pick<DraftRankingPlayer, 'espnId' | 'fullName'> & { proTeam?: string })[],
  expert: Pick<ExpertProjections, 'players'>,
): { byEspnId: Map<number, ExpertLine>; unmatched: string[] } {
  const byName = new Map<string, { espnId: number; proTeam?: string }[]>();
  for (const player of players) {
    const key = nameKey(player.fullName);
    byName.set(key, [...(byName.get(key) ?? []), { espnId: player.espnId, proTeam: player.proTeam }]);
  }
  const byEspnId = new Map<number, ExpertLine>();
  const unmatched: string[] = [];
  for (const line of expert.players) {
    const named = byName.get(matchKey(line.name)) ?? [];
    const team = TEAM_ALIASES[line.team] ?? line.team;
    const found = named.find((entry) => entry.proTeam === team) ?? named[0];
    if (!found) unmatched.push(line.name);
    else byEspnId.set(found.espnId, line);
  }
  return { byEspnId, unmatched };
}

/** The outside line per game, with minutes and free throws made filled in from ESPN's. */
export function expertPerGame(line: ExpertLine, espn: Readonly<Record<string, number>> | null): Record<string, number> {
  const perGame = { ...line.perGame };
  if (espn?.['40'] !== undefined) perGame['40'] = espn['40'];
  if (espn?.['15'] !== undefined) {
    perGame['15'] = espn['15'];
    perGame['16'] = espn['15'] + perGame['24'];
  }
  return perGame;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Half ESPN, half the outside line. ESPN projects no double-doubles, so its
 * side of the bonus is the odds the app already estimates from his line.
 */
export function blendPerGame(
  expert: Readonly<Record<string, number>>,
  espn: Readonly<Record<string, number>> | null,
): Record<string, number> {
  if (!espn) return { ...expert };
  const odds = bonusOdds(espn);
  const espnSide: Record<string, number> = { ...espn, '37': odds.doubleDouble, '38': odds.tripleDouble };
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(expert)) {
    const other = espnSide[id];
    out[id] = other === undefined ? value : round2((value + other) / 2);
  }
  return out;
}

function rowOf(perGame: Readonly<Record<string, number>>, games: number, id: string): ProjectionRow {
  const stats: Record<string, number> = {};
  for (const [stat, value] of Object.entries(perGame)) stats[stat] = value * games;
  stats['42'] = games;
  return { id, stats, averageStats: null };
}

/** A snapshot that names whose lines it holds, when they are not ESPN's. */
export interface SourcedSnapshot {
  lineLabel?: string;
}

/** The snapshot with each matched player's projection taken from the chosen source. */
export function applyProjectionSource<T extends Pick<DraftRankingSnapshot, 'players'>>(
  snapshot: T,
  expert: Pick<ExpertProjections, 'players'> | null,
  source: ProjectionSource,
): T & SourcedSnapshot {
  if (source === 'espn' || !expert) return snapshot;
  const { byEspnId } = matchExpert(snapshot.players, expert);
  return {
    ...snapshot,
    lineLabel: sourceLabel(source),
    players: snapshot.players.map((player): DraftRankingPlayer => {
      const line = byEspnId.get(player.espnId);
      if (!line) return player;
      const espn = projectedPerGame(player.projection);
      const outside = expertPerGame(line, espn);
      const espnGames = player.projection?.stats['42'];
      const id = player.projection?.id ?? source;
      if (source === 'hashtag' || !espn || espnGames === undefined) {
        return { ...player, projection: rowOf(outside, line.games, id) };
      }
      return { ...player, projection: rowOf(blendPerGame(outside, espn), Math.round((line.games + espnGames) / 2), id) };
    }),
  };
}

// ─── ESPN's blanks ──────────────────────────────────────────────────────────

/**
 * The outside lines for players ESPN lists but does not project (Sandro
 * Mamukelashvili, Cam Spencer, Daniss Jenkins on 17 October). These fill the
 * blanks for every owner, so they are the only outside lines anyone but the
 * commissioner receives.
 */
export function projectionGaps(
  players: readonly (Pick<DraftRankingPlayer, 'espnId' | 'fullName' | 'projection'> & { proTeam?: string })[],
  expert: Pick<ExpertProjections, 'players'>,
): ExpertLine[] {
  const blanks = players.filter((player) => player.projection === null);
  return [...matchExpert(blanks, expert).byEspnId.values()];
}

/** The snapshot with ESPN's blanks filled from the outside lines. A player ESPN projects is left alone. */
export function fillProjectionGaps<T extends Pick<DraftRankingSnapshot, 'players'>>(
  snapshot: T,
  fills: Pick<ExpertProjections, 'players'> | null,
): T {
  if (!fills || fills.players.length === 0) return snapshot;
  const blanks = snapshot.players.filter((player) => player.projection === null);
  const { byEspnId } = matchExpert(blanks, fills);
  if (byEspnId.size === 0) return snapshot;
  return {
    ...snapshot,
    players: snapshot.players.map((player): DraftRankingPlayer => {
      const line = byEspnId.get(player.espnId);
      return line ? { ...player, projection: rowOf(expertPerGame(line, null), line.games, 'hashtag') } : player;
    }),
  };
}

/** An outside line for a drafted player ESPN does not project. */
export interface FillLine {
  espnId: number;
  fullName: string;
  proTeam: string;
  games: number;
  perGame: Record<string, number>;
}

/**
 * Outside lines for the drafted players ESPN leaves without a projection,
 * so the recap can value everyone the room took. Players ESPN projects are
 * left alone.
 */
export function missingFromEspn(
  drafted: readonly { espnId: number; fullName: string; proTeam: string }[],
  snapshot: Pick<DraftRankingSnapshot, 'players'> | null,
  expert: Pick<ExpertProjections, 'players'>,
): FillLine[] {
  const projected = new Set((snapshot?.players ?? []).filter((player) => player.projection).map((player) => player.espnId));
  const missing = drafted.filter((player) => !projected.has(player.espnId));
  const { byEspnId } = matchExpert(missing, expert);
  return missing.flatMap((player) => {
    const line = byEspnId.get(player.espnId);
    return line ? [{ ...player, games: line.games, perGame: expertPerGame(line, null) }] : [];
  });
}

/** The snapshot with each fill line as that player's projection, adding him if ESPN never listed him. */
export function withFills<T extends Pick<DraftRankingSnapshot, 'players'>>(snapshot: T, fills: readonly FillLine[]): T {
  if (fills.length === 0) return snapshot;
  const byId = new Map(fills.map((fill) => [fill.espnId, fill]));
  const players = snapshot.players.map((player): DraftRankingPlayer => {
    const fill = byId.get(player.espnId);
    if (!fill || player.projection) return player;
    byId.delete(player.espnId);
    return { ...player, projection: rowOf(fill.perGame, fill.games, 'hashtag') };
  });
  for (const fill of byId.values()) {
    players.push({
      espnId: fill.espnId,
      fullName: fill.fullName,
      proTeam: fill.proTeam,
      adp: null,
      percentOwned: null,
      standard: null,
      roto: null,
      projection: rowOf(fill.perGame, fill.games, 'hashtag'),
      lastSeason: null,
    } as DraftRankingPlayer);
  }
  return { ...snapshot, players };
}
