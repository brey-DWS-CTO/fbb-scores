import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { leagueDataset } from '../../lib/league/data.js';

export const POSITION_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

export interface PositionTheme {
  color: string;
  background: string;
  deepBackground: string;
  border: string;
}

/** High-contrast draft colors, keyed by the player's first listed position. */
export const POSITION_THEMES: Record<string, PositionTheme> = {
  PG: { color: '#6fb3ff', background: '#0c3470', deepBackground: '#071d46', border: '#347fd1' },
  SG: { color: '#49d6c0', background: '#064a43', deepBackground: '#032d2a', border: '#218f80' },
  SF: { color: '#ff9a5a', background: '#71300a', deepBackground: '#411803', border: '#b85b20' },
  PF: { color: '#c08aff', background: '#50247a', deepBackground: '#2e124b', border: '#8652b9' },
  C: { color: '#ff73b8', background: '#701446', deepBackground: '#410827', border: '#b83d7c' },
};

const FALLBACK_THEME: PositionTheme = {
  color: '#c2c2d6',
  background: '#303044',
  deepBackground: '#1b1b29',
  border: '#55556d',
};

export const POSITION_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(POSITION_THEMES).map(([position, theme]) => [position, theme.color]),
);

export function positionTheme(positions?: string[] | null): PositionTheme {
  const first = positions?.[0];
  return (first && POSITION_THEMES[first]) || FALLBACK_THEME;
}

export function positionColor(positions?: string[] | null): string {
  return positionTheme(positions).color;
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
    const positions = cell.selection.positions ?? player?.positions ?? [];
    return {
      name: cell.selection.playerName ?? player?.name ?? 'Unknown',
      positions,
      proTeam: cell.selection.proTeam ?? player?.proTeam ?? null,
      color: positionColor(positions),
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
