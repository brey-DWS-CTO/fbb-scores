import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { leagueDataset } from '../../lib/league/data.js';

/** Classic draft-board position colors (colored by the player's FIRST listed position). */
export const POSITION_COLORS: Record<string, string> = {
  PG: '#00aaff',
  SG: '#00ffcc',
  SF: '#ffe600',
  PF: '#ff6600',
  C: '#cc00ff',
};

export function positionColor(positions?: string[] | null): string {
  const first = positions?.[0];
  return (first && POSITION_COLORS[first]) || '#8888aa';
}

const PLAYERS_BY_KEY = new Map(leagueDataset.players.map((p) => [p.key, p]));

export function playerForKey(key?: string): DatasetPlayer | null {
  return key ? PLAYERS_BY_KEY.get(key) ?? null : null;
}

/** What a filled board cell should show (null = empty cell). */
export interface CellDisplay {
  name: string;
  positions: string[];
  proTeam: string | null;
  color: string;
  isKeeper: boolean;
  keeperRound: number | null; // keeper tier round, when the fill is a keeper pre-fill
  enteredBy: string | null;
}

export function cellDisplay(cell: BoardCell): CellDisplay | null {
  if (cell.keeper) {
    const player = cell.keeper.player;
    return {
      name: player?.name ?? cell.keeper.selection.playerName,
      positions: player?.positions ?? [],
      proTeam: player?.proTeam ?? null,
      color: positionColor(player?.positions),
      isKeeper: true,
      keeperRound: cell.keeper.round,
      enteredBy: null,
    };
  }
  if (cell.selection) {
    const player = playerForKey(cell.selection.playerKey);
    return {
      name: cell.selection.playerName ?? player?.name ?? 'Unknown',
      positions: player?.positions ?? [],
      proTeam: player?.proTeam ?? null,
      color: positionColor(player?.positions),
      isKeeper: cell.selection.isKeeper === true,
      keeperRound: null,
      enteredBy: cell.selection.enteredBy ?? null,
    };
  }
  return null;
}

export interface RecentPick {
  overall: number;
  owner: string; // team on the clock for that pick (trade-adjusted)
  playerName: string;
  label: string; // "4.7"
  timestamp: string;
}

/** Last N live (non-keeper) selections, newest first. */
export function recentPicks(board: BoardCell[], limit = 5): RecentPick[] {
  const rows: RecentPick[] = [];
  for (const c of board) {
    const s = c.selection;
    if (!s || s.isKeeper) continue;
    rows.push({
      overall: c.pick.overall,
      owner: c.pick.currentOwner,
      playerName: s.playerName ?? playerForKey(s.playerKey)?.name ?? 'Unknown',
      label: pickLabel(c.pick),
      timestamp: s.timestamp ?? '',
    });
  }
  rows.sort((a, b) =>
    a.timestamp !== b.timestamp
      ? b.timestamp.localeCompare(a.timestamp)
      : b.overall - a.overall,
  );
  return rows.slice(0, limit);
}
