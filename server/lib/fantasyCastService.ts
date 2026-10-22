import { getDailyNbaScores } from './dailyScorersService.js';
import { parseCastPlays, reconcileCastPlays, type FantasyCast } from '../../src/lib/league/fantasyCast.js';
import { castCacheSeconds, castSchedule } from '../../src/lib/league/castPolling.js';
import { getNbaSummary } from './nbaSummaryService.js';

const cache = new Map<string, { expires: number; read: Promise<FantasyCast> }>();
const games = new Map<string, { expires: number; final: boolean; plays: FantasyCast['plays'] }>();
export function getFantasyCast(date: string, now = Date.now()): Promise<FantasyCast> {
  const hit = cache.get(date);
  if (hit && now < hit.expires) return hit.read;
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  for (const [key, entry] of games) if (entry.expires <= now) games.delete(key);
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  const entry = { expires: now + 20_000, read: null as unknown as Promise<FantasyCast> };
  const read = (async () => {
    const daily = await getDailyNbaScores(date);
    const schedule = castSchedule(daily.games, now);
    entry.expires = now + castCacheSeconds(schedule, now) * 1000;
    let awaitingFinalSummary = false;
    const results = await Promise.allSettled(daily.games.filter(game => game.state !== 'pre').map(async game => {
      const existing = games.get(game.id);
      if (existing && now < existing.expires) {
        if (game.state === 'post' && !existing.final) awaitingFinalSummary = true;
        return existing.plays;
      }
      const { raw, box } = await getNbaSummary(game.id, now);
      if (!Array.isArray((raw as { plays?: unknown } | null)?.plays)) throw new Error('Play feed unavailable');
      if (!box) throw new Error('Player stats unavailable');
      if (game.state === 'post' && box.state !== 'post') awaitingFinalSummary = true;
      const plays = parseCastPlays(raw, game.id, `${game.away} @ ${game.home}`, box.lines);
      const scored = box.state === 'post' ? reconcileCastPlays(plays, box.lines) : plays;
      if (games.size >= 64) games.delete(games.keys().next().value!);
      games.set(game.id, { expires: now + (box.state === 'post' ? 900_000 : 20_000), final: box.state === 'post', plays: scored });
      return scored;
    }));
    const failed = results.some(result => result.status === 'rejected');
    if (awaitingFinalSummary) { schedule.nextPollAt = new Date(now + 20_000).toISOString(); entry.expires = now + 20_000; }
    if (failed || daily.error) { schedule.nextPollAt = new Date(now + 30_000).toISOString(); entry.expires = now + 30_000; }
    return { plays: results.flatMap(result => result.status === 'fulfilled' ? result.value : []), fetchedAt: new Date(now).toISOString(), schedule,
      error: failed ? 'Some play feeds are unavailable. Showing available games; retrying automatically.' : daily.error };
  })().catch(error => { cache.delete(date); throw error; });
  entry.read = read;
  cache.set(date, entry);
  return read;
}

export function forgetFantasyCast(): void { cache.clear(); games.clear(); }
