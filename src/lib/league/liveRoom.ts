/**
 * The live draft's player list, laid out like the mock room's: who is left,
 * who took the rest, and the same columns and sorts.
 *
 * Pure. No server, no browser.
 */
import type { BoardCell, DatasetPlayer } from '../keeper/types.js';
import { pickLabel } from '../keeper/engine.js';
import type { PlayerProjection } from './projections.js';

export type RoomSortKey =
  | 'rank' | 'adp' | 'fppg' | 'total' | 'games' | 'pi' | 'po'
  | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'threes' | 'to' | 'gone';

export interface RoomSort {
  key: RoomSortKey;
  dir: 1 | -1;
}

export const DEFAULT_ROOM_SORT: RoomSort = { key: 'rank', dir: 1 };

/** Who already has a player, and with which pick. */
export interface TakenBy {
  label: string;
  owner: string;
  keeper: boolean;
}

export interface RoomRow {
  player: DatasetPlayer;
  taken: TakenBy | null;
}

/** Every player on the board, picked or kept, by key. */
export function takenOnBoard(board: readonly BoardCell[]): Map<string, TakenBy> {
  const taken = new Map<string, TakenBy>();
  for (const cell of board) {
    const owner = cell.pick.currentOwner;
    const label = pickLabel(cell.pick);
    if (cell.keeper) taken.set(cell.keeper.selection.playerKey, { label, owner, keeper: true });
    else if (cell.selection?.playerKey) taken.set(cell.selection.playerKey, { label, owner, keeper: false });
  }
  return taken;
}

/** The number a column sorts by, or null when there is none. */
export function roomValue(
  projection: PlayerProjection | undefined,
  gone: ReadonlyMap<string, number> | null,
  key: RoomSortKey,
  playerKey: string,
): number | null {
  switch (key) {
    case 'rank': return projection?.valueRank ?? null;
    case 'adp': return projection?.adp ?? null;
    case 'fppg': return projection?.fppg ?? null;
    case 'total': return projection?.total ?? null;
    case 'games': return projection?.games ?? null;
    case 'pi': return projection?.playInGames ?? null;
    case 'po': return projection?.playoffGames ?? null;
    case 'gone': return gone ? gone.get(playerKey) ?? 0 : null;
    default: return projection?.line?.[key] ?? null;
  }
}

/** Tap a column again to flip it. Rank, ADP and turnovers start low; the rest start high. */
export function nextRoomSort(current: RoomSort, key: RoomSortKey): RoomSort {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === 'rank' || key === 'adp' || key === 'to' ? 1 : -1 };
}

/**
 * The rows to show. A search, or "show drafted", brings in players already
 * taken; otherwise only the players still there. Players with no number in
 * the sorted column go last, and ties fall back to our board rank.
 */
export function roomRows(input: {
  available: readonly DatasetPlayer[];
  everyone: readonly DatasetPlayer[];
  taken: ReadonlyMap<string, TakenBy>;
  projections: ReadonlyMap<string, PlayerProjection>;
  gone: ReadonlyMap<string, number> | null;
  position: string;
  search: string;
  showDrafted: boolean;
  sort: RoomSort;
  limit?: number;
}): RoomRow[] {
  const { available, everyone, taken, projections, gone, position, sort } = input;
  const needle = input.search.trim().toLowerCase();
  const base = needle || input.showDrafted ? everyone : available;
  const rank = (player: DatasetPlayer) => projections.get(player.key)?.valueRank ?? Number.POSITIVE_INFINITY;
  return base
    .filter((player) => position === 'ALL' || player.positions.includes(position))
    .filter((player) => {
      if (!needle) return true;
      return `${player.fullName ?? ''} ${player.name} ${player.proTeam}`.toLowerCase().includes(needle);
    })
    .map((player) => ({ player, taken: taken.get(player.key) ?? null }))
    .sort((a, b) => {
      const x = roomValue(projections.get(a.player.key), gone, sort.key, a.player.key);
      const y = roomValue(projections.get(b.player.key), gone, sort.key, b.player.key);
      const tie = rank(a.player) - rank(b.player) || a.player.name.localeCompare(b.player.name);
      if (x === null || y === null) return x === y ? tie : x === null ? 1 : -1;
      return (x - y) * sort.dir || tie;
    })
    .slice(0, input.limit ?? 150);
}
