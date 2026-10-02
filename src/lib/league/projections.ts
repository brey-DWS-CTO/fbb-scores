/**
 * The projections table: every player's projected season in this league's
 * scoring, with the parts it is built from laid out side by side.
 *
 * Nothing here scores anything new. Points per game come from `valueBoard`,
 * which already picks the best source for each player (a 2026-27 projection,
 * else ESPN's rank turned into points, else last season). The split into
 * ESPN's line and the double-double bonus comes from `draftRankings.ts` and
 * `doubleDoubles.ts`. This file only lines those numbers up, adds who is
 * keeping whom, and filters, sorts and exports the result.
 *
 * Pure. No server, no browser.
 */
import { computeFpts, round1 } from '../espn/calculations.js';
import { bonusOdds } from './doubleDoubles.js';
import { gamesOverride } from './gamesOverrides.js';
import {
  lastSeasonFppg,
  projectedPerGame,
  type DraftRankingPlayer,
  type DraftRankingSnapshot,
  type RankSource,
} from './draftRankings.js';
import { realAdp, type Position, type ValueBoard } from './draftValue.js';
import type { KeeperStatus } from './mockDraft.js';
import type { KeeperSelection } from '../keeper/types.js';

/** Where a player stands for the draft. */
export type KeeperTag = 'keeper' | 'projected' | 'open';

/** One projected per-game line, in the stats a fan reads. */
export interface ProjectedLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
  to: number;
  min: number;
  fgm: number;
  fga: number;
  /** Made over attempted, as a percent. Null with no attempts. */
  fgPct: number | null;
  ftm: number;
  fta: number;
  ftPct: number | null;
}

export interface PlayerProjection {
  key: string;
  name: string;
  proTeam: string;
  positions: Position[];
  /** The fantasy team he was on at the end of last season. */
  lastTeam: string | null;
  tag: KeeperTag;
  /** Who keeps him, when someone does or is projected to. */
  keptBy: string | null;
  /** Which source `fppg` came from. */
  source: RankSource;
  /** Points per game in this league's scoring, bonus included. */
  fppg: number | null;
  /** Points for the season: FPPG times the games ESPN projects. Null without games. */
  total: number | null;
  /** ESPN's projected line scored our way, before the bonus. */
  base: number | null;
  /** The double- and triple-double bonus we add, per game. */
  bonus: number | null;
  /** Odds per game of a double-double and a triple-double. */
  ddOdds: number | null;
  tdOdds: number | null;
  /** Games ESPN projects him to play, or the commissioner's estimate. */
  games: number | null;
  /** Set when the games are the commissioner's estimate, not ESPN's. */
  gamesNote: string | null;
  line: ProjectedLine | null;
  lastSeason: number | null;
  /** This season's number less last season's. */
  change: number | null;
  espnRank: number | null;
  /** ADP, or null when ESPN's number only means "undrafted". */
  adp: number | null;
  /** Place on our draft board: points, position scarcity and schedule. */
  valueRank: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function lineOf(perGame: Readonly<Record<string, number>>): ProjectedLine {
  const stat = (id: string) => round1(perGame[id] ?? 0);
  // Percentages come from makes over attempts. ESPN's own percent fields are
  // season ratios, and dividing them by games like a count would ruin them.
  const pct = (made: string, tried: string) => {
    const attempts = perGame[tried] ?? 0;
    return attempts > 0 ? round1(((perGame[made] ?? 0) / attempts) * 100) : null;
  };
  return {
    pts: stat('0'),
    reb: stat('6'),
    ast: stat('3'),
    stl: stat('2'),
    blk: stat('1'),
    threes: stat('17'),
    to: stat('11'),
    min: stat('40'),
    fgm: stat('13'),
    fga: stat('14'),
    fgPct: pct('13', '14'),
    ftm: stat('15'),
    fta: stat('16'),
    ftPct: pct('15', '16'),
  };
}

export interface KeeperSets {
  keepers: Record<string, readonly KeeperSelection[]>;
  status: Record<string, KeeperStatus>;
}

/** Player key to who keeps him and whether that is known or a guess. */
export function keeperIndex(sets: KeeperSets): Map<string, { owner: string; tag: Exclude<KeeperTag, 'open'> }> {
  const index = new Map<string, { owner: string; tag: Exclude<KeeperTag, 'open'> }>();
  for (const [owner, selections] of Object.entries(sets.keepers)) {
    const tag = sets.status[owner] === 'known' ? 'keeper' : 'projected';
    for (const selection of selections) index.set(selection.playerKey, { owner, tag });
  }
  return index;
}

/**
 * One row per player on the value board, in board order. A player with no
 * ESPN projection keeps his row: his points come from the fallback source
 * and the projection columns stay empty.
 */
export function buildProjections(
  values: Pick<ValueBoard, 'entries'>,
  snapshot: Pick<DraftRankingSnapshot, 'players' | 'scoringItems'> | null,
  keepers: KeeperSets,
): PlayerProjection[] {
  const byEspnId = new Map<number, DraftRankingPlayer>();
  for (const entry of snapshot?.players ?? []) byEspnId.set(entry.espnId, entry);
  const scoringItems = snapshot?.scoringItems ?? [];
  const kept = keeperIndex(keepers);

  return values.entries.map((entry) => {
    const player = entry.player;
    const espn = player.espnId !== null ? byEspnId.get(player.espnId) ?? null : null;
    const perGame = projectedPerGame(espn?.projection ?? null);
    const base = perGame !== null && scoringItems.length > 0 ? round1(computeFpts(perGame, [...scoringItems])) : null;
    // The bonus is whatever the projected total carries over ESPN's line, so
    // the two parts always add up to the number on screen.
    const bonus = base !== null && entry.source === 'projection' && entry.fppg !== null
      ? round1(entry.fppg - base)
      : null;
    const odds = perGame ? bonusOdds(perGame) : null;
    const rawGames = espn?.projection?.stats['42'];
    const override = gamesOverride(player.espnId);
    const games = override ? override.games : rawGames !== undefined && Number.isFinite(rawGames) ? rawGames : null;
    const keeper = kept.get(player.key) ?? null;
    const lastSeason = lastSeasonFppg(player);

    return {
      key: player.key,
      name: player.fullName ?? player.name,
      proTeam: player.proTeam,
      positions: entry.positions,
      lastTeam: player.fantasyTeam,
      tag: keeper?.tag ?? 'open',
      keptBy: keeper?.owner ?? null,
      source: entry.source,
      fppg: entry.fppg,
      total: entry.fppg !== null && games !== null ? Math.round(entry.fppg * games) : null,
      base,
      bonus,
      ddOdds: odds ? round2(odds.doubleDouble) : null,
      tdOdds: odds ? round2(odds.tripleDouble) : null,
      games,
      gamesNote: override ? `${override.note} ESPN had ${rawGames ?? 'no'} games.` : null,
      line: perGame ? lineOf(perGame) : null,
      lastSeason,
      change: entry.fppg !== null && lastSeason !== null && entry.source !== 'last-season'
        ? round1(entry.fppg - lastSeason)
        : null,
      espnRank: entry.espnRank,
      adp: realAdp(entry.adp),
      valueRank: entry.rank,
    };
  });
}

// ─── Columns ────────────────────────────────────────────────────────────────

export type ProjectionColumnId =
  | 'valueRank' | 'name' | 'proTeam' | 'positions' | 'tag' | 'games' | 'fppg' | 'total' | 'base' | 'bonus'
  | 'ddOdds' | 'tdOdds' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'threes' | 'to'
  | 'fgm' | 'fga' | 'fgPct' | 'ftm' | 'fta' | 'ftPct'
  | 'lastSeason' | 'change' | 'espnRank' | 'adp';

export interface ProjectionColumn {
  id: ProjectionColumnId;
  /** Short header for the screen. */
  label: string;
  /** Plain header for a spreadsheet. */
  header: string;
  /** Which way a first tap sorts. Numbers where more is better start high. */
  firstDir: SortDir;
  value: (row: PlayerProjection) => string | number | null;
}

const tagLabel: Record<KeeperTag, string> = { keeper: 'Keeper', projected: 'Projected keeper', open: 'Open' };

export const PROJECTION_COLUMNS: readonly ProjectionColumn[] = [
  { id: 'name', label: 'PLAYER', header: 'Player', firstDir: 'asc', value: (row) => row.name },
  { id: 'proTeam', label: 'TM', header: 'Team', firstDir: 'asc', value: (row) => row.proTeam },
  { id: 'positions', label: 'POS', header: 'Positions', firstDir: 'asc', value: (row) => row.positions.join('/') },
  { id: 'tag', label: 'STATUS', header: 'Status', firstDir: 'asc', value: (row) => (row.keptBy ? `${tagLabel[row.tag]} (${row.keptBy})` : tagLabel[row.tag]) },
  { id: 'fppg', label: 'FPPG', header: 'Projected FPPG', firstDir: 'desc', value: (row) => row.fppg },
  { id: 'total', label: 'TOTAL', header: 'Projected season points', firstDir: 'desc', value: (row) => row.total },
  { id: 'base', label: 'ESPN', header: 'ESPN line, our scoring', firstDir: 'desc', value: (row) => row.base },
  { id: 'change', label: 'VS LAST', header: 'Change from last season', firstDir: 'desc', value: (row) => row.change },
  { id: 'bonus', label: '+DD', header: 'Double-double bonus', firstDir: 'desc', value: (row) => row.bonus },
  { id: 'ddOdds', label: 'DD%', header: 'Double-double odds', firstDir: 'desc', value: (row) => row.ddOdds },
  { id: 'tdOdds', label: 'TD%', header: 'Triple-double odds', firstDir: 'desc', value: (row) => row.tdOdds },
  { id: 'games', label: 'GP', header: 'Projected games', firstDir: 'desc', value: (row) => row.games },
  { id: 'min', label: 'MIN', header: 'Minutes', firstDir: 'desc', value: (row) => row.line?.min ?? null },
  { id: 'pts', label: 'PTS', header: 'Points', firstDir: 'desc', value: (row) => row.line?.pts ?? null },
  { id: 'reb', label: 'REB', header: 'Rebounds', firstDir: 'desc', value: (row) => row.line?.reb ?? null },
  { id: 'ast', label: 'AST', header: 'Assists', firstDir: 'desc', value: (row) => row.line?.ast ?? null },
  { id: 'stl', label: 'STL', header: 'Steals', firstDir: 'desc', value: (row) => row.line?.stl ?? null },
  { id: 'blk', label: 'BLK', header: 'Blocks', firstDir: 'desc', value: (row) => row.line?.blk ?? null },
  { id: 'threes', label: '3PM', header: 'Threes made', firstDir: 'desc', value: (row) => row.line?.threes ?? null },
  { id: 'to', label: 'TO', header: 'Turnovers', firstDir: 'asc', value: (row) => row.line?.to ?? null },
  { id: 'fgm', label: 'FGM', header: 'Field goals made', firstDir: 'desc', value: (row) => row.line?.fgm ?? null },
  { id: 'fga', label: 'FGA', header: 'Field goals tried', firstDir: 'desc', value: (row) => row.line?.fga ?? null },
  { id: 'fgPct', label: 'FG%', header: 'Field goal percent', firstDir: 'desc', value: (row) => row.line?.fgPct ?? null },
  { id: 'ftm', label: 'FTM', header: 'Free throws made', firstDir: 'desc', value: (row) => row.line?.ftm ?? null },
  { id: 'fta', label: 'FTA', header: 'Free throws tried', firstDir: 'desc', value: (row) => row.line?.fta ?? null },
  { id: 'ftPct', label: 'FT%', header: 'Free throw percent', firstDir: 'desc', value: (row) => row.line?.ftPct ?? null },
  { id: 'lastSeason', label: 'LAST', header: 'Last season FPPG', firstDir: 'desc', value: (row) => row.lastSeason },
  { id: 'espnRank', label: 'ESPN RK', header: 'ESPN rank', firstDir: 'asc', value: (row) => row.espnRank },
  { id: 'adp', label: 'ADP', header: 'ADP', firstDir: 'asc', value: (row) => row.adp },
  { id: 'valueRank', label: 'BOARD', header: 'Board rank', firstDir: 'asc', value: (row) => row.valueRank },
];

const COLUMN_BY_ID = new Map(PROJECTION_COLUMNS.map((column) => [column.id, column]));

/** The player column cannot be hidden: a row needs a name. */
export const FIXED_COLUMNS: ReadonlySet<ProjectionColumnId> = new Set(['name']);

/** The columns to show, in table order, with the hidden ones left out. */
export function visibleColumns(hidden: ReadonlySet<string>): ProjectionColumn[] {
  return PROJECTION_COLUMNS.filter((column) => FIXED_COLUMNS.has(column.id) || !hidden.has(column.id));
}

/** Hidden column ids from storage. Anything unknown or malformed is ignored. */
export function parseHiddenColumns(raw: string | null): Set<ProjectionColumnId> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is ProjectionColumnId =>
      typeof id === 'string' && COLUMN_BY_ID.has(id as ProjectionColumnId) && !FIXED_COLUMNS.has(id as ProjectionColumnId)));
  } catch {
    return new Set();
  }
}

export function projectionColumn(id: ProjectionColumnId): ProjectionColumn {
  return COLUMN_BY_ID.get(id)!;
}

// ─── Filter, sort, page ─────────────────────────────────────────────────────

export interface ProjectionFilter {
  query?: string;
  position?: Position | 'ALL';
  /** Leave out keepers and projected keepers: only who can be drafted. */
  hideKept?: boolean;
}

export function filterProjections(rows: readonly PlayerProjection[], filter: ProjectionFilter): PlayerProjection[] {
  const words = (filter.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.position && filter.position !== 'ALL' && !row.positions.includes(filter.position)) return false;
    if (filter.hideKept && row.tag !== 'open') return false;
    if (words.length === 0) return true;
    const haystack = PROJECTION_COLUMNS
      .map((column) => column.value(row))
      .concat(row.lastTeam)
      .filter((value) => value !== null)
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export type SortDir = 'asc' | 'desc';

export interface ProjectionSort {
  column: ProjectionColumnId;
  dir: SortDir;
}

/** The first tap on a header sorts its best way, the second flips it, the third clears it. */
export function nextSort(current: ProjectionSort | null, column: ProjectionColumnId): ProjectionSort | null {
  const first = projectionColumn(column).firstDir;
  if (!current || current.column !== column) return { column, dir: first };
  if (current.dir === first) return { column, dir: first === 'asc' ? 'desc' : 'asc' };
  return null;
}

/** Sort a copy. Blanks always sink, whichever way the column runs. No sort means board order. */
export function sortProjections(rows: readonly PlayerProjection[], sort: ProjectionSort | null): PlayerProjection[] {
  if (!sort) return [...rows].sort((a, b) => a.valueRank - b.valueRank);
  const read = projectionColumn(sort.column).value;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = read(a);
    const y = read(b);
    if (x === null || y === null) {
      if (x === y) return a.valueRank - b.valueRank;
      return x === null ? 1 : -1;
    }
    const gap = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return gap !== 0 ? gap * sign : a.valueRank - b.valueRank;
  });
}

export interface ProjectionPage {
  rows: PlayerProjection[];
  /** 1-based, clamped into range. */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row shown; 0 and 0 when empty. */
  from: number;
  to: number;
  total: number;
}

export function pageOf(rows: readonly PlayerProjection[], page: number, size: number): ProjectionPage {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const shown = rows.slice(start, start + size);
  return {
    rows: shown,
    page: current,
    pageCount,
    from: shown.length > 0 ? start + 1 : 0,
    to: start + shown.length,
    total: rows.length,
  };
}

// ─── Colour and export ──────────────────────────────────────────────────────

export type Tone = 'good' | 'warn' | 'bad' | null;

/** A swing of three points a game either way is worth a second look. */
export const CHANGE_STEP = 3;

export function changeTone(change: number | null): Tone {
  if (change === null) return null;
  if (change >= CHANGE_STEP) return 'good';
  if (change <= -CHANGE_STEP) return 'bad';
  return null;
}

/** Fewer than 65 projected games is a risk; fewer than 50 is a big one. */
export function gamesTone(games: number | null): Tone {
  if (games === null) return null;
  if (games < 50) return 'bad';
  if (games < 65) return 'warn';
  return 'good';
}

/** Half the time or more is a double-double machine. */
export function oddsTone(odds: number | null): Tone {
  if (odds === null) return null;
  return odds >= 0.5 ? 'good' : null;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every column, every row given, in the order given, numbered from 1. */
export function projectionsToCsv(
  rows: readonly PlayerProjection[],
  columns: readonly ProjectionColumn[] = PROJECTION_COLUMNS,
): string {
  const lines = [['#', ...columns.map((column) => csvCell(column.header))].join(',')];
  rows.forEach((row, index) => {
    lines.push([String(index + 1), ...columns.map((column) => csvCell(column.value(row)))].join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}
