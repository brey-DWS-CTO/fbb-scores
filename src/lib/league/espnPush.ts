/**
 * The finished draft, laid out the way ESPN's offline draft form wants it.
 *
 * ESPN's form is one table per team with a row for each round, 1 to 14, and a
 * player search box on every row. A keeper is a draft pick there like any
 * other. Teams are matched on ESPN team id, never on the name: people rename
 * their team on ESPN whenever they like.
 *
 * A traded pick means a team can hold two picks in one round and none in
 * another. ESPN's rows are still 1 to 14, so each team's picks go in draft
 * order and the row number is their place in that order. The real pick label
 * rides along so a person can check it.
 *
 * Pure. No server, no browser.
 */
import type { BoardCell, TeamInfo } from '../keeper/types.js';
import { pickLabel } from '../keeper/engine.js';
import { teamNameOf, type TeamNameOverrides } from './teamNames.js';

export interface EspnPushRow {
  /** Row in ESPN's form, 1 to 14: the team's place in its own pick order. */
  row: number;
  /** The real pick, "3.7". */
  label: string;
  overall: number;
  round: number;
  playerName: string | null;
  proTeam: string | null;
  positions: string[];
  keeper: boolean;
}

export interface EspnPushTeam {
  owner: string;
  espnTeamId: number;
  /** The name ESPN last reported, so the form's table is easy to find. */
  teamName: string;
  rows: EspnPushRow[];
  problems: string[];
}

export interface EspnPushPlan {
  teams: EspnPushTeam[];
  /** Picks with a player, over every team. */
  filled: number;
  total: number;
  /** Anything a person must settle before the push. Empty means go. */
  problems: string[];
}

function rowFor(cell: BoardCell, row: number): EspnPushRow {
  const base = { row, label: pickLabel(cell.pick), overall: cell.pick.overall, round: cell.pick.round };
  if (cell.keeper) {
    const player = cell.keeper.player;
    return {
      ...base,
      playerName: player?.fullName ?? cell.keeper.selection.playerName ?? player?.name ?? null,
      proTeam: player?.proTeam ?? null,
      positions: player?.positions ?? [],
      keeper: true,
    };
  }
  if (cell.selection?.playerKey) {
    return {
      ...base,
      playerName: cell.selection.playerName ?? null,
      proTeam: cell.selection.proTeam ?? null,
      positions: cell.selection.positions ?? [],
      keeper: cell.selection.isKeeper === true,
    };
  }
  return { ...base, playerName: null, proTeam: null, positions: [], keeper: false };
}

/** Lay the board out per ESPN team. `rowsPerTeam` is the form's row count. */
export function espnPushPlan(
  board: readonly BoardCell[],
  teams: readonly TeamInfo[],
  overrides?: TeamNameOverrides | null,
  rowsPerTeam = 14,
): EspnPushPlan {
  const cellsByOwner = new Map<string, BoardCell[]>();
  for (const cell of [...board].sort((a, b) => a.pick.overall - b.pick.overall)) {
    const list = cellsByOwner.get(cell.pick.currentOwner) ?? [];
    list.push(cell);
    cellsByOwner.set(cell.pick.currentOwner, list);
  }

  const problems: string[] = [];
  let filled = 0;
  const out: EspnPushTeam[] = [...teams]
    .sort((a, b) => a.draftPosition - b.draftPosition)
    .map((team) => {
      const cells = cellsByOwner.get(team.owner) ?? [];
      const rows = cells.map((cell, index) => rowFor(cell, index + 1));
      const teamProblems: string[] = [];
      const empty = rows.filter((row) => row.playerName === null);
      filled += rows.length - empty.length;
      if (empty.length > 0) {
        teamProblems.push(`${empty.length === 1 ? 'Pick' : 'Picks'} ${empty.map((row) => row.label).join(', ')} still empty.`);
      }
      if (rows.length > rowsPerTeam) {
        teamProblems.push(`${rows.length} picks, but ESPN has ${rowsPerTeam} rows.`);
      }
      const name = teamNameOf(team, overrides);
      for (const problem of teamProblems) problems.push(`${name}: ${problem}`);
      return { owner: team.owner, espnTeamId: team.espnTeamId, teamName: name, rows, problems: teamProblems };
    });

  return { teams: out, filled, total: board.length, problems };
}

/** The plan as plain text, one team after another, ready to paste or read. */
export function espnPushText(plan: EspnPushPlan, leagueName = 'ESPN offline draft'): string {
  const lines: string[] = [`${leagueName}: ${plan.filled} of ${plan.total} picks filled.`];
  if (plan.problems.length > 0) {
    lines.push('', 'Settle first:');
    for (const problem of plan.problems) lines.push(`- ${problem}`);
  }
  for (const team of plan.teams) {
    lines.push('', `${team.teamName} (ESPN team ${team.espnTeamId}, ${team.owner})`);
    for (const row of team.rows) {
      const who = row.playerName ?? 'EMPTY';
      const where = [row.proTeam, row.positions.join('/')].filter((part) => part).join(' ');
      const tags = [row.keeper ? 'keeper' : null, `pick ${row.label}`].filter((tag) => tag !== null).join(', ');
      lines.push(`${String(row.row).padStart(2)}. ${who}${where ? `, ${where}` : ''} (${tags})`);
    }
  }
  return lines.join('\n');
}
