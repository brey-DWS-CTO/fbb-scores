import type { ScoreSide } from './scores.js';



/** Starter player-games only; DNPs and future games never dilute the average. */

export function lineupFppg(side: ScoreSide, period?: number) {

  const days = side.players.flatMap((player) => Object.entries(player.days)

    .filter(([key, day]) => (period === undefined || Number(key) === period) && day.started && day.played)

    .map(([, day]) => day));

  const points = days.reduce((sum, day) => sum + day.points, 0);

  return { games: days.length, points, average: days.length ? points / days.length : null,

    live: days.some((day) => day.game?.status === 'live') };

}

export const fppgText = (value: number | null) => value === null ? '—' : (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);


export function sortLineupFppg(teams: readonly ScoreSide[], column: string, ascending: boolean, periods: readonly number[]): ScoreSide[] {
  const value = (side: ScoreSide): number | null => {
    if (column === 'gp') return lineupFppg(side).games;
    if (column === 'trend') {
      const daily = periods.map(period => lineupFppg(side, period).average).filter((average): average is number => average !== null);
      return daily.length < 2 ? null : daily[daily.length - 1] - daily[0];
    }
    return lineupFppg(side, column === 'week' ? undefined : Number(column)).average;
  };
  return [...teams].sort((a, b) => {
    if (column === 'team') return a.name.localeCompare(b.name) * (ascending ? 1 : -1);
    const av = value(a), bv = value(b);
    if (av === null || bv === null) return av === null ? bv === null ? a.name.localeCompare(b.name) : 1 : -1;
    return (av - bv) * (ascending ? 1 : -1) || a.name.localeCompare(b.name);
  });
}

/**
 * The per-game gap between two sides of a matchup, as one short line.
 * "GSW +2.5 FPPG" means GSW scores 2.5 more per starter-game than the other side.
 * Null until both sides have a played starter-game.
 */
export function fppgGapLabel(home: ScoreSide, away: ScoreSide, period?: number): string | null {
  const h = lineupFppg(home, period).average, a = lineupFppg(away, period).average;
  if (h === null || a === null) return null;
  // Subtract the shown one-decimal numbers, so the gap matches the two FPPG labels beside it.
  const gap = Math.round((Math.abs(Number(fppgText(h)) - Number(fppgText(a))) + Number.EPSILON) * 10) / 10;
  if (gap === 0) return 'Even FPPG';
  const leader = h > a ? home : away;
  return `${leader.abbrev || leader.name} +${gap.toFixed(1)} FPPG`;
}
