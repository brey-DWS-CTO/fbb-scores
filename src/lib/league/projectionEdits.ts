/**
 * The commissioner's edits to ESPN's projections.
 *
 * An edit names a player by ESPN id and changes any of his projected games
 * and per-game stats. Applying it rewrites his projection row in the
 * snapshot, so everything downstream (points per game in our scoring, the
 * double-double bonus, season totals, draft value, the mock draft) reads the
 * edited line through the code it already uses. Nothing scores twice.
 *
 * Totals are stored as per-game times games, so dividing back by games gives
 * exactly the per-game line, ratios included. Missed shots (ESPN stats 23
 * and 24, which this league scores) follow from makes and attempts.
 *
 * Pure. No server, no browser.
 */
import { computeFpts, round1 } from '../espn/calculations.js';
import { estimatedBonusPerGame } from './doubleDoubles.js';
import { projectedPerGame, type DraftRankingPlayer, type DraftRankingSnapshot, type ProjectionRow } from './draftRankings.js';

export interface EditableStat {
  key: string;
  /** ESPN stat id. */
  id: string;
  label: string;
}

/** Games first, then the per-game line in the order the table shows it. */
export const GAMES_STAT: EditableStat = { key: 'games', id: '42', label: 'GP' };
export const PER_GAME_STATS: readonly EditableStat[] = [
  { key: 'min', id: '40', label: 'MIN' },
  { key: 'pts', id: '0', label: 'PTS' },
  { key: 'reb', id: '6', label: 'REB' },
  { key: 'ast', id: '3', label: 'AST' },
  { key: 'stl', id: '2', label: 'STL' },
  { key: 'blk', id: '1', label: 'BLK' },
  { key: 'threes', id: '17', label: '3PM' },
  { key: 'to', id: '11', label: 'TO' },
  { key: 'fgm', id: '13', label: 'FGM' },
  { key: 'fga', id: '14', label: 'FGA' },
  { key: 'ftm', id: '15', label: 'FTM' },
  { key: 'fta', id: '16', label: 'FTA' },
];
const PER_GAME_IDS = new Set(PER_GAME_STATS.map((stat) => stat.id));

export interface ProjectionEdit {
  espnId: number;
  name: string;
  /** Games he plays, or null to keep ESPN's. */
  games: number | null;
  /** Per-game values by ESPN stat id; only the ones changed. */
  perGame: Record<string, number>;
  note: string;
  editedAt: string;
  editedBy: string;
}

export type ProjectionEdits = ReadonlyMap<number, ProjectionEdit>;

export function editsById(edits: readonly ProjectionEdit[]): Map<number, ProjectionEdit> {
  return new Map(edits.map((edit) => [edit.espnId, edit]));
}

/** The two estimates the commissioner made before edits had a screen. */
export const SEED_EDITS: readonly Omit<ProjectionEdit, 'editedAt' | 'editedBy'>[] = [
  { espnId: 3102531, name: 'Kristaps Porzingis', games: 25, perGame: {}, note: 'Hurt.' },
  { espnId: 3913176, name: 'Brandon Ingram', games: 45, perGame: {}, note: 'Hurt.' },
];

// ─── Reading an edit off the wire ───────────────────────────────────────────

const MAX_PER_GAME = 100;

/** Validate a client's edit. Throws a plain-English error on anything wrong. */
export function parseProjectionEdit(espnId: number, body: unknown): Pick<ProjectionEdit, 'espnId' | 'name' | 'games' | 'perGame' | 'note'> {
  if (!Number.isInteger(espnId) || espnId <= 0) throw new Error('That is not a player.');
  if (typeof body !== 'object' || body === null) throw new Error('Send the edit as an object.');
  const value = body as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '';
  if (!name) throw new Error('The edit needs the player name.');
  let games: number | null = null;
  if (value.games !== null && value.games !== undefined) {
    if (typeof value.games !== 'number' || !Number.isFinite(value.games) || value.games < 0 || value.games > 82) {
      throw new Error('Games must be between 0 and 82.');
    }
    games = Math.round(value.games);
  }
  const perGame: Record<string, number> = {};
  if (value.perGame !== undefined && value.perGame !== null) {
    if (typeof value.perGame !== 'object') throw new Error('Per-game stats must be an object.');
    for (const [id, number] of Object.entries(value.perGame as Record<string, unknown>)) {
      if (!PER_GAME_IDS.has(id)) throw new Error(`Stat ${id} cannot be edited.`);
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > MAX_PER_GAME) {
        throw new Error(`Each stat must be between 0 and ${MAX_PER_GAME} a game.`);
      }
      perGame[id] = Math.round(number * 10) / 10;
    }
  }
  if (games === null && Object.keys(perGame).length === 0) throw new Error('Change at least one number.');
  const note = typeof value.note === 'string' ? value.note.trim().slice(0, 200) : '';
  return { espnId, name, games, perGame, note };
}

// ─── Applying edits ─────────────────────────────────────────────────────────

/** ESPN's games for a projection, or null. */
export function projectionGames(projection: ProjectionRow | null): number | null {
  const games = projection?.stats['42'];
  return games !== undefined && Number.isFinite(games) ? games : null;
}

/** The projection row with an edit laid over it. */
export function editedProjection(projection: ProjectionRow | null, edit: ProjectionEdit): ProjectionRow | null {
  const base = projectedPerGame(projection);
  const perGame: Record<string, number> = { ...(base ?? {}) };
  for (const [id, value] of Object.entries(edit.perGame)) perGame[id] = value;
  // The league scores missed shots; they follow from makes and attempts.
  if (perGame['14'] !== undefined && perGame['13'] !== undefined) perGame['23'] = Math.max(0, perGame['14'] - perGame['13']);
  if (perGame['16'] !== undefined && perGame['15'] !== undefined) perGame['24'] = Math.max(0, perGame['16'] - perGame['15']);
  const games = edit.games ?? projectionGames(projection);
  if (games === null) return projection;
  const stats: Record<string, number> = {};
  for (const [id, value] of Object.entries(perGame)) stats[id] = value * games;
  stats['42'] = games;
  return {
    id: projection?.id ?? 'edited',
    stats,
    averageStats: projection?.averageStats ? { ...perGame, '42': games } : null,
  };
}

/** A snapshot with every edit applied. The original is left alone. */
export function applyProjectionEdits<T extends Pick<DraftRankingSnapshot, 'players'>>(snapshot: T, edits: ProjectionEdits): T {
  if (edits.size === 0) return snapshot;
  return {
    ...snapshot,
    players: snapshot.players.map((player): DraftRankingPlayer => {
      const edit = edits.get(player.espnId);
      return edit ? { ...player, projection: editedProjection(player.projection, edit) } : player;
    }),
  };
}

export interface EditPreview {
  fppg: number | null;
  total: number | null;
  games: number | null;
  bonus: number;
}

/** What a draft edit would make of a player, in this league's scoring. */
export function previewEdit(
  projection: ProjectionRow | null,
  edit: Pick<ProjectionEdit, 'games' | 'perGame'>,
  scoringItems: readonly { statId: number; points: number }[],
): EditPreview {
  const row = editedProjection(projection, { ...edit, espnId: 0, name: '', note: '', editedAt: '', editedBy: '' });
  const perGame = projectedPerGame(row);
  const games = projectionGames(row);
  if (!perGame || scoringItems.length === 0) return { fppg: null, total: null, games, bonus: 0 };
  const bonus = estimatedBonusPerGame(perGame, scoringItems);
  const fppg = round1(computeFpts(perGame, [...scoringItems]) + bonus);
  return { fppg, total: games !== null ? Math.round(fppg * games) : null, games, bonus: round1(bonus) };
}

// ─── Editing one cell ───────────────────────────────────────────────────────

/** Projections table columns that can be typed into, and the ESPN stat each one is. */
export const EDITABLE_COLUMNS: Readonly<Record<string, string>> = {
  games: '42', min: '40', pts: '0', reb: '6', ast: '3', stl: '2', blk: '1',
  threes: '17', to: '11', fgm: '13', fga: '14', ftm: '15', fta: '16',
};

const sameTenth = (a: number | null | undefined, b: number | null | undefined) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.round(a * 10) === Math.round(b * 10);

/**
 * The edit after one cell changes, or null when nothing differs from ESPN
 * any more (so the edit should go). A value equal to ESPN's drops that
 * field rather than storing a copy of ESPN.
 */
export function withCellEdit(
  current: Pick<ProjectionEdit, 'games' | 'perGame' | 'note'> | null,
  espn: ProjectionRow | null,
  statId: string,
  value: number,
): Pick<ProjectionEdit, 'games' | 'perGame' | 'note'> | null {
  const games = statId === '42'
    ? (sameTenth(value, projectionGames(espn)) ? null : Math.round(value))
    : current?.games ?? null;
  const perGame = { ...(current?.perGame ?? {}) };
  if (statId !== '42') {
    if (sameTenth(value, projectedPerGame(espn)?.[statId])) delete perGame[statId];
    else perGame[statId] = Math.round(value * 10) / 10;
  }
  if (games === null && Object.keys(perGame).length === 0) return null;
  return { games, perGame, note: current?.note ?? '' };
}

/** True when this cell of an edited player differs from ESPN. */
export function cellEdited(edit: Pick<ProjectionEdit, 'games' | 'perGame'> | null, statId: string): boolean {
  if (!edit) return false;
  return statId === '42' ? edit.games !== null : edit.perGame[statId] !== undefined;
}
