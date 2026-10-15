/**
 * The whole draft board of a finished mock, kept with its grade so a past
 * mock can show every team's picks, not just the person's own.
 *
 * Saved small: one cell per pick with the names on it, so the board reads
 * back without replaying the draft. Mocks finished before boards were kept
 * have none.
 *
 * Pure. No server, no browser.
 */
import type { DraftGrid } from './draftRoom.js';

export interface BoardCellView {
  overall: number;
  round: number;
  slot: number;
  owner: string;
  /** Who held the pick at the start, when it was traded. */
  via: string | null;
  playerKey: string | null;
  playerName: string | null;
  positions: string[];
  how: 'keeper' | 'pick' | null;
  keeperProjected: boolean;
  keeperEarly: string | null;
  /** The pick on the clock now. Never set on a saved board. */
  current?: boolean;
}

export interface SavedBoard {
  /** Teams in first-round order, left to right. */
  owners: string[];
  rounds: BoardCellView[][];
}

/** Most a saved board may weigh, so a broken client cannot fill the table. */
export const MAX_BOARD_CHARS = 80_000;

/** A live grid as cells the board component draws. */
export function boardFromGrid(grid: DraftGrid): SavedBoard {
  return {
    owners: [...grid.owners],
    rounds: grid.rounds.map((row) => row.map((cell): BoardCellView => ({
      overall: cell.overall,
      round: cell.round,
      slot: cell.slot,
      owner: cell.owner,
      via: cell.via,
      playerKey: cell.pick?.playerKey ?? null,
      playerName: cell.pick?.playerName ?? null,
      positions: cell.pick ? [...cell.pick.positions] : [],
      how: cell.pick?.how === 'keeper' ? 'keeper' : cell.pick?.playerKey ? 'pick' : null,
      keeperProjected: cell.pick?.how === 'keeper' && cell.pick.keeperStatus === 'assumed',
      keeperEarly: cell.pick?.keeperEarly ?? null,
      ...(cell.current ? { current: true } : {}),
    }))),
  };
}

const text = (value: unknown, max = 80): string | null =>
  typeof value === 'string' && value.length <= max ? value : null;
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10_000 ? value : null;

/** A board a client sent, checked, or null when it is not one. */
export function parseSavedBoard(value: unknown): SavedBoard | null {
  if (typeof value !== 'object' || value === null) return null;
  if (JSON.stringify(value).length > MAX_BOARD_CHARS) return null;
  const raw = value as { owners?: unknown; rounds?: unknown };
  if (!Array.isArray(raw.owners) || !Array.isArray(raw.rounds)) return null;
  const owners = raw.owners.map((owner) => text(owner));
  if (owners.length === 0 || owners.length > 20 || owners.some((owner) => owner === null)) return null;
  const rounds: BoardCellView[][] = [];
  for (const row of raw.rounds.slice(0, 30)) {
    if (!Array.isArray(row)) return null;
    const cells: BoardCellView[] = [];
    for (const entry of row.slice(0, 20)) {
      const cell = (entry ?? {}) as Record<string, unknown>;
      const overall = whole(cell.overall);
      const round = whole(cell.round);
      const slot = whole(cell.slot);
      const owner = text(cell.owner);
      if (overall === null || round === null || slot === null || owner === null) return null;
      cells.push({
        overall,
        round,
        slot,
        owner,
        via: text(cell.via),
        playerKey: text(cell.playerKey),
        playerName: text(cell.playerName),
        positions: Array.isArray(cell.positions)
          ? cell.positions.map((position) => text(position, 4)).filter((position): position is string => position !== null).slice(0, 5)
          : [],
        how: cell.how === 'keeper' || cell.how === 'pick' ? cell.how : null,
        keeperProjected: cell.keeperProjected === true,
        keeperEarly: text(cell.keeperEarly, 200),
      });
    }
    rounds.push(cells);
  }
  return { owners: owners as string[], rounds };
}
