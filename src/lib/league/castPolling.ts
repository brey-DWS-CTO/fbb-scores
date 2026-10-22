import type { NbaGame } from './houseParty.js';

export const CAST_LIVE_MS = 20_000;
export interface CastSchedule { phase: 'waiting' | 'live' | 'complete' | 'idle'; nextPollAt: string | null }

export function castSchedule(games: readonly NbaGame[], now: number): CastSchedule {
  games = games.filter(game => !/postponed|cancelled|canceled/i.test(game.detail));
  if (!games.length) return { phase: 'idle', nextPollAt: null };
  if (games.every(game => game.state === 'post')) return { phase: 'complete', nextPollAt: null };
  const starts = games.filter(game => game.state === 'pre').map(game => Date.parse(game.tipoff)).filter(Number.isFinite);
  const nextStart = starts.length ? Math.min(...starts) : null;
  if (!games.some(game => game.state === 'in') && nextStart !== null && nextStart > now) {
    return { phase: 'waiting', nextPollAt: new Date(nextStart).toISOString() };
  }
  // A delayed game or missing tipoff is checked slowly, without requesting its play feed.
  return { phase: 'live', nextPollAt: new Date(now + (games.some(game => game.state === 'in') ? CAST_LIVE_MS : 60_000)).toISOString() };
}

export function castPollDelay(schedule: CastSchedule, now: number): number | false {
  return schedule.nextPollAt ? Math.max(1_000, Math.min(2_147_000_000, Date.parse(schedule.nextPollAt) - now)) : false;
}

export function castCacheSeconds(schedule: CastSchedule, now: number): number {
  const delay = castPollDelay(schedule, now);
  return delay === false ? 900 : Math.max(1, Math.min(3600, Math.floor(delay / 1000)));
}
