import { parseScoreboard } from '../../src/lib/league/houseParty.js';
import type { DailyNbaScores } from '../../src/lib/league/dailyScorers.js';
import { getBoxScores } from './boxScoreService.js';

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const cache = new Map<string, { expires: number; read: Promise<DailyNbaScores> }>();
const KEEP_MS = 45_000;

export function validScoreDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}

/** A single scoreboard date, shared between simultaneous requests; only started games need box scores. */
export function getDailyNbaScores(date: string): Promise<DailyNbaScores> {
  if (!validScoreDate(date)) return Promise.reject(new Error('Invalid score date'));
  const now = Date.now();
  const hit = cache.get(date);
  if (hit && now < hit.expires) return hit.read;
  // Bound memory even if readers explore many historical dates.
  for (const [key, entry] of cache) if (now >= entry.expires) cache.delete(key);
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  const entry = { expires: now + KEEP_MS, read: null as unknown as Promise<DailyNbaScores> };
  const read = (async (): Promise<DailyNbaScores> => {
    const response = await fetch(`${SCOREBOARD_URL}?dates=${date.replace(/-/g, '')}`, {
      signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { events?: unknown }).events)) {
      throw new Error('ESPN did not provide a scoreboard');
    }
    const games = parseScoreboard(raw);
    // Do not carry a pregame scoreboard across a scheduled tipoff.
    for (const game of games) {
      const tipoff = Date.parse(game.tipoff);
      if (game.state === 'pre' && tipoff > now) entry.expires = Math.min(entry.expires, tipoff);
    }
    const ids = games.filter(game => game.state !== 'pre').map(game => game.id);
    // A day's NBA slate is small; read its summaries in parallel so scoreboard
    // + summary timeouts stay inside the API's 30-second execution limit.
    const { boxScores, error: readError } = await getBoxScores(ids);
    let error = readError;
    if (ids.some(id => !boxScores.some(box => box.gameId === id))) {
      error ??= 'Some game stats are not available yet. Scores may be incomplete.';
    }
    return { date, fetchedAt: new Date().toISOString(), games, boxScores, error };
  })().catch(error => { cache.delete(date); throw error; });
  entry.read = read;
  cache.set(date, entry);
  return read;
}
