import { parseScoreboard } from '../../src/lib/league/houseParty.js';
import { parseBoxScore, type BoxScore } from '../../src/lib/league/partyScore.js';
import axios from 'axios';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  addDaysIso,
  firstRegularSeasonDate,
  planWeek,
  readEspnWeek,
  readNbaScoreboard,
  seasonStartDate,
  scoringPeriodDates,
  type DateAnchor,
  type EspnDayInput,
  type ScoresWeek,
} from '../../src/lib/league/scores.js';

const summaryCache = new Map<string, { until: number; read: Promise<BoxScore> }>();

/** Share in-flight reads across phones; finals are rechecked for stat corrections. */
function readSummary(id: string): Promise<BoxScore> {
  const now = Date.now();
  const hit = summaryCache.get(id);
  if (hit && hit.until > now) return hit.read;
  for (const [key, entry] of summaryCache) if (entry.until <= now) summaryCache.delete(key);
  if (summaryCache.size >= 256) summaryCache.delete(summaryCache.keys().next().value!);
  const entry = { until: now + 15_000, read: null as unknown as Promise<BoxScore> };
  entry.read = axios.get<unknown>(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`, { timeout: 8000 }).then(({ data }) => {
    const box = parseBoxScore(data, id);
    if (!box || box.lines.length === 0) throw new Error(`NBA box score unavailable for ${id}`);
    entry.until = Date.now() + (box.state === 'post' ? 300_000 : 15_000);
    return box;
  }).catch(error => { summaryCache.delete(id); throw error; });
  summaryCache.set(id, entry);
  return entry.read;
}

const NBA_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

/**
 * Before the season ESPN's current scoring period is 0 and says nothing
 * about dates. Opening night is scoring period 1, and the public scoreboard
 * knows which day that is: the first date from the league's week 1 with a
 * regular-season game. Falls back to the league's own season start.
 */
async function openingNightAnchor(): Promise<DateAnchor> {
  const start = seasonStartDate();
  const dates = Array.from({ length: 7 }, (_, offset) => addDaysIso(start, offset));
  const days = await Promise.all(dates.map(async (date) => ({ date, payload: await fetchNbaScoreboardRaw(date) })));
  const opening = firstRegularSeasonDate(days);
  return opening
    ? { scoringPeriodId: 1, date: opening, source: 'opening-night' }
    : { scoringPeriodId: 1, date: start, source: 'season-start' };
}

export async function loadWeekPlan(client: EspnClient, requested: number | null) {
  const settings = await client.fetchWeekSettings();
  // Calendar dates stay pinned to the NBA schedule across midnight and time zones.
  const league = settings as { settings?: { proTeams?: unknown } } | null;
  const known = scoringPeriodDates(league?.settings?.proTeams);
  const first = known.entries().next().value;
  const anchor: DateAnchor = first
    ? { scoringPeriodId: first[0], date: first[1], source: 'pro-schedule' }
    : await openingNightAnchor();
  return { settings, plan: planWeek(settings, requested, anchor) };
}

export async function loadWeek(client: EspnClient, requested: number | null, maxDays?: number): Promise<ScoresWeek> {
  const { settings, plan } = await loadWeekPlan(client, requested);
  if (maxDays !== undefined && plan.days.length > maxDays) throw new Error('Week exceeds evaluation read budget');
  const days: EspnDayInput[] = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < plan.days.length; i += BATCH_SIZE) {
    const batch = plan.days.slice(i, i + BATCH_SIZE);
    const loaded = await Promise.all(batch.map(async (day) => {
      const [payload, nba] = await Promise.all([
        client.fetchDailyBoxScore(day.scoringPeriodId),
        fetchNbaDay(day.date),
      ]);
      return { scoringPeriodId: day.scoringPeriodId, date: day.date, payload, ...nba };
    }));
    days.push(...loaded);
  }

  return readEspnWeek({ plan, settings, days, fetchedAt: new Date().toISOString() });
}

async function fetchNbaScoreboardRaw(date: string): Promise<unknown | null> {
  try {
    const { data } = await axios.get<unknown>(`${NBA_SCOREBOARD_URL}?dates=${date.replace(/-/g, '')}`, { timeout: 8000 });
    return data;
  } catch (err) {
    console.error(`[NBA Scoreboard] Failed to fetch ${date}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchNbaDay(date: string): Promise<Pick<EspnDayInput, 'games' | 'playerStats'>> {
  const raw = await fetchNbaScoreboardRaw(date);
  if (raw === null) throw new Error(`NBA scoreboard unavailable for ${date}`);
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { events?: unknown }).events)) throw new Error(`Invalid NBA scoreboard for ${date}`);
  const games = readNbaScoreboard(raw);
  const playerStats: Record<string, Record<string, number>> = {};
  await Promise.all(parseScoreboard(raw).filter(game => game.state !== 'pre').map(async game => {
    const box = await readSummary(game.id);
    if (game.state === 'post' && box.state !== 'post') throw new Error(`NBA final stats are not ready for ${game.id}`);
    if (![box.home, box.away].every(team => box.lines.some(line => line.team === team))) throw new Error(`Incomplete NBA box score for ${game.id}`);
    for (const line of box.lines) playerStats[line.athleteId] = { ...line.stats, '42': line.played ? 1 : 0 };
  }));
  return { games, playerStats };
}

/** A fresh read for scheduled warnings, using the same loader as the score page. */
export async function loadCurrentScoresWeek(): Promise<ScoresWeek> { return loadScoresWeek(null); }
export async function loadScoresWeek(period: number | null, budget?: { timeoutMs: number; maxDays: number }): Promise<ScoresWeek> {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) throw new Error('Missing ESPN credentials');
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID, seasonId: Number(ESPN_SEASON_ID ?? 2026),
    espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: ESPN_COOKIE_STRING, timeoutMs: budget?.timeoutMs, maxResponseBytes: budget ? 8 * 1024 * 1024 : undefined,
  });
  return loadWeek(client, period, budget?.maxDays);
}
