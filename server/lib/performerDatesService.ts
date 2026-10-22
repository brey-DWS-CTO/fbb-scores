import { localDateIso, seasonStartDate } from '../../src/lib/league/scores.js';

const URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
let cached: { today: string; at: number; read: Promise<string[]> } | undefined;

/** ESPN's calendar contains game days; leave out preseason, future dates, and malformed entries. */
export function performerGameDates(raw: unknown, today: string, start: string): string[] {
  const leagues = (raw as { leagues?: { calendar?: unknown }[] } | null)?.leagues;
  const calendar = Array.isArray(leagues) ? leagues[0]?.calendar : null;
  if (!Array.isArray(calendar)) throw new Error('NBA game-day calendar unavailable');
  const dates = calendar.flatMap(entry => {
    if (typeof entry !== 'string') return [];
    const day = entry.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`))
      && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day && day >= start && day <= today ? [day] : [];
  });
  return [...new Set([...dates, today])].sort();
}

/** One cached calendar read, rather than one scoreboard request for every past day. */
export function getPerformerDates(now = new Date()): Promise<string[]> {
  const today = localDateIso(now);
  if (cached?.today === today && now.getTime() - cached.at < 12 * 60 * 60_000) return cached.read;
  const read = (async () => {
    const response = await fetch(`${URL}?dates=${today.replace(/-/g, '')}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Could not load NBA game-day calendar');
    return performerGameDates(await response.json(), today, seasonStartDate());
  })();
  cached = { today, at: now.getTime(), read };
  void read.catch(() => { if (cached?.read === read) cached = undefined; });
  return read;
}
