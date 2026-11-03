import { sharedDefensePoints, type MatchupEnvironment, type MatchupPosition } from './matchupProjection.js';
import type { ScoringItem } from './partyScore.js';

export interface MatchupTableRow { team: string; games: number; value: number | null; rank: number | null }
/** Rank by pace or shared-stat points allowed. Zero-sample allowances stay unknown. */
export function matchupTableRows(environment: MatchupEnvironment, view: 'pace' | 'defense', position: MatchupPosition, scoring: readonly ScoringItem[]): MatchupTableRow[] {
  const rows = Object.entries(environment.teams).map(([team, data]) => {
    const defense = data.defense[position];
    const value = view === 'pace' ? data.pace : defense.games > 0 ? sharedDefensePoints(defense, scoring) : null;
    return { team, games: defense.games, value: value !== null && Number.isFinite(value) ? value : null, rank: null as number | null };
  }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.team.localeCompare(b.team));
  let rank = 0;
  rows.forEach((row, index) => {
    if (row.value === null) return;
    if (index === 0 || row.value !== rows[index - 1].value) rank = index + 1;
    row.rank = rank;
  });
  return rows;
}
