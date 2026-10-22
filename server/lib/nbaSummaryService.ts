import { parseBoxScore, type BoxScore } from '../../src/lib/league/partyScore.js';

interface Summary { raw: unknown; box: BoxScore | null }
const cache = new Map<string, { expires: number; read: Promise<Summary> }>();

/** One fetch and box parse shared by Cast, scoreboards and parties, including in-flight reads. */
export function getNbaSummary(gameId: string, now = Date.now()): Promise<Summary> {
  const hit = cache.get(gameId);
  if (hit && hit.expires > now) return hit.read;
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  const entry = { expires: now + 20_000, read: null as unknown as Promise<Summary> };
  entry.read = (async () => {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${encodeURIComponent(gameId)}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    const raw: unknown = await response.json();
    const box = parseBoxScore(raw, gameId);
    entry.expires = now + (box?.state === 'post' ? 900_000 : 20_000);
    return { raw, box };
  })().catch(error => { if (cache.get(gameId) === entry) cache.delete(gameId); throw error; });
  cache.set(gameId, entry);
  return entry.read;
}

export function forgetNbaSummaries(): void { cache.clear(); }
