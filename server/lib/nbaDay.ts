/**
 * The NBA's games on one day, from ESPN's public scoreboard. No sign-in.
 * Tip-offs are what the waiver clock and the LM add window run on.
 *
 * Answers are kept for ten minutes per date. A day whose games have all
 * tipped off does not change, but the schedule can: postponements happen.
 */
import axios from 'axios';
import type { DayGame } from '../../src/lib/league/lmWeekend.js';
import { normalizeNbaTeamCode } from '../../src/lib/league/schedule.js';

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const TTL_MS = 10 * 60 * 1000;

interface ScoreboardEvent {
  date?: string;
  competitions?: Array<{
    date?: string;
    /** False when ESPN has only a placeholder time (TBD). */
    timeValid?: boolean;
    competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }>;
  }>;
}

const cache = new Map<string, { at: number; games: DayGame[] }>();

/** Games as the public scoreboard lists them, read with no trust in any field. */
export function readScoreboard(events: readonly ScoreboardEvent[] | undefined): DayGame[] {
  const games: DayGame[] = [];
  for (const event of events ?? []) {
    const comp = event.competitions?.[0];
    const tipoff = comp?.date ?? event.date;
    if (!comp || !tipoff || !Number.isFinite(Date.parse(tipoff))) continue;
    // A placeholder time would make a fake early day. Better no game than a wrong one.
    if (comp.timeValid === false) continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home')?.team?.abbreviation;
    const away = comp.competitors?.find((c) => c.homeAway === 'away')?.team?.abbreviation;
    if (!home || !away) continue;
    games.push({ home: normalizeNbaTeamCode(home), away: normalizeNbaTeamCode(away), tipoff: new Date(tipoff).toISOString() });
  }
  return games.sort((a, b) => a.tipoff.localeCompare(b.tipoff));
}

/** The games on a Pacific date, YYYY-MM-DD. */
export async function gamesOn(date: string): Promise<DayGame[]> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.games;
  const { data } = await axios.get<{ events?: ScoreboardEvent[] }>(SCOREBOARD_URL, {
    params: { dates: date.replace(/-/g, '') },
    timeout: 10_000,
  });
  const games = readScoreboard(data.events);
  cache.set(date, { at: Date.now(), games });
  return games;
}

/**
 * Games for each of the next `days` Pacific dates from `from`, by date. A
 * date the scoreboard will not answer for comes back empty, and `onError`
 * hears about it: an empty day looks like a normal one.
 */
export async function gamesForDays(
  from: string,
  days: number,
  onError?: (err: unknown, date: string) => Promise<void>,
): Promise<Record<string, DayGame[]>> {
  const out: Record<string, DayGame[]> = {};
  const cursor = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    try {
      out[date] = await gamesOn(date);
    } catch (err) {
      console.warn(`[nba] scoreboard ${date}:`, err instanceof Error ? err.message : err);
      out[date] = [];
      await onError?.(err, date);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
