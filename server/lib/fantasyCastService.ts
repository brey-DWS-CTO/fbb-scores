import { getDailyNbaScores } from './dailyScorersService.js';
import { parseCastPlays, reconcileCastPlays, type FantasyCast } from '../../src/lib/league/fantasyCast.js';

const cache = new Map<string, { at: number; read: Promise<FantasyCast> }>();
export function getFantasyCast(date: string): Promise<FantasyCast> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < 20_000) return hit.read;
  for (const [key, entry] of cache) if (Date.now() - entry.at > 60_000) cache.delete(key);
  const read = (async () => {
    const daily = await getDailyNbaScores(date);
    const results = await Promise.allSettled(daily.games.filter(game => game.state !== 'pre').map(async game => {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${encodeURIComponent(game.id)}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Play feed unavailable');
      const raw: unknown = await response.json();
      if (!Array.isArray((raw as { plays?: unknown } | null)?.plays)) throw new Error('Play feed unavailable');
      const box = daily.boxScores.find(box => box.gameId === game.id);
      if (!box) throw new Error('Player stats unavailable');
      const plays = parseCastPlays(raw, game.id, `${game.away} @ ${game.home}`, box.lines);
      return box.state === 'post' ? reconcileCastPlays(plays, box.lines) : plays;
    }));
    return { plays: results.flatMap(result => result.status === 'fulfilled' ? result.value : []), fetchedAt: new Date().toISOString(),
      error: results.some(result => result.status === 'rejected') ? 'Some play feeds are unavailable. Showing available games; retrying automatically.' : daily.error };
  })().catch(error => { cache.delete(date); throw error; });
  cache.set(date, { at: Date.now(), read });
  return read;
}
