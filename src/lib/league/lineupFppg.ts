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
 * The lead, spread over the extra starter-games the leader has played, as one short line.
 * "FUNK +41.5 PPG · 4 extra GP": FUNK leads by 166.1 having played 4 more games, 41.5 a game.
 * With even games, or the leader behind on games, the lead alone: "FUNK +166.1 · even GP".
 * Null until either side has a played starter-game.
 */
export function leadPerExtraGameLabel(home: ScoreSide, away: ScoreSide): string | null {
  const homeGames = lineupFppg(home).games, awayGames = lineupFppg(away).games;
  if (!homeGames && !awayGames) return null;
  const lead = Math.round((Math.abs(home.total - away.total) + Number.EPSILON) * 10) / 10;
  if (lead === 0) return 'Even';
  const homeLeads = home.total > away.total;
  const leader = homeLeads ? home : away;
  const extra = homeLeads ? homeGames - awayGames : awayGames - homeGames;
  const name = leader.abbrev || leader.name;
  if (extra > 0) return `${name} +${fppgText(lead / extra)} PPG · ${extra} extra GP`;
  return `${name} +${lead.toFixed(1)} · ${extra === 0 ? 'even GP' : `${-extra} fewer GP`}`;
}
