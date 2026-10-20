/**
 * The next two weeks of NBA games, from ESPN's public scoreboard, for the
 * WATCH page and house parties. Nothing is stored: each server keeps the
 * last read for ten minutes, since tip-offs and TV slots change rarely and
 * live scores are a bonus, not the point.
 */
import { parseScoreboard, type NbaGame } from '../../src/lib/league/houseParty.js';

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
export const DAYS_AHEAD = 14;
const KEEP_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface Scoreboard {
  fetchedAt: string;
  /** The first and last day asked for, YYYYMMDD. */
  from: string;
  to: string;
  games: NbaGame[];
  /** What went wrong, if the read was partial. */
  error: string | null;
}

let kept: Scoreboard | null = null;
/** Tests pin a scoreboard so no run ever asks ESPN. */
let pinned = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const stamp = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Every day from yesterday to two weeks out, as YYYYMMDD. ESPN only answers
 * one day at a time (a range gets a 400), so the read is one call a day.
 * Yesterday is in so a game still going at midnight Pacific stays listed.
 */
function days(now: Date): string[] {
  const list: string[] = [];
  for (let offset = -1; offset <= DAYS_AHEAD; offset += 1) list.push(stamp(new Date(now.getTime() + offset * DAY_MS)));
  return list;
}

function window(now: Date): { from: string; to: string } {
  const list = days(now);
  return { from: list[0], to: list[list.length - 1] };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
  return response.json();
}

/** The games, from the last read if it is fresh enough, else from ESPN. */
export async function getScoreboard(now = new Date(), fresh = false): Promise<Scoreboard> {
  if (kept && (pinned || (!fresh && now.getTime() - Date.parse(kept.fetchedAt) < KEEP_MS))) return kept;
  const { from, to } = window(now);
  const list = days(now);
  let missed = 0;
  let reason = '';
  const byDay = await Promise.all(list.map(async (day) => {
    try {
      return parseScoreboard(await getJson(`${SCOREBOARD_URL}?dates=${day}`));
    } catch (error) {
      missed += 1;
      reason = error instanceof Error ? error.message : 'failed';
      return [];
    }
  }));
  if (missed === list.length) {
    // A read that got nothing keeps the last good one on hand, and says so.
    if (kept) return { ...kept, error: `ESPN did not answer (${reason}). Showing the last read.` };
    return { fetchedAt: now.toISOString(), from, to, games: [], error: `ESPN did not answer (${reason}).` };
  }
  const seen = new Set<string>();
  const games: NbaGame[] = [];
  for (const game of byDay.flat()) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    games.push(game);
  }
  games.sort((a, b) => a.tipoff.localeCompare(b.tipoff) || a.id.localeCompare(b.id));
  kept = {
    fetchedAt: now.toISOString(),
    from,
    to,
    games,
    error: missed > 0 ? `ESPN missed ${missed} day${missed === 1 ? '' : 's'}. Try REFRESH.` : null,
  };
  return kept;
}

/** Tests only: these are the games, and ESPN is never asked. */
export function pinScoreboard(games: NbaGame[], now = new Date()): void {
  const { from, to } = window(now);
  kept = { fetchedAt: now.toISOString(), from, to, games, error: null };
  pinned = true;
}

/** Tests only: forget the last read. */
export function forgetScoreboard(): void {
  kept = null;
  pinned = false;
}
