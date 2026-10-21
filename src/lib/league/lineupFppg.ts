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

