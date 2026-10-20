import axios from 'axios';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  addDaysIso,
  espnToday,
  firstRegularSeasonDate,
  planWeek,
  readCurrentScoringPeriod,
  readEspnWeek,
  readNbaScoreboard,
  seasonStartDate,
  type DateAnchor,
  type EspnDayInput,
  type GameLine,
  type ScoresWeek,
} from '../../src/lib/league/scores.js';

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

export async function loadWeek(client: EspnClient, requested: number | null): Promise<ScoresWeek> {
  const settings = await client.fetchWeekSettings();
  const current = readCurrentScoringPeriod(settings);
  const anchor: DateAnchor = current >= 1
    ? { scoringPeriodId: current, date: espnToday(), source: 'scoring-period' }
    : await openingNightAnchor();
  const plan = planWeek(settings, requested, anchor);

  const days: EspnDayInput[] = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < plan.days.length; i += BATCH_SIZE) {
    const batch = plan.days.slice(i, i + BATCH_SIZE);
    const loaded = await Promise.all(batch.map(async (day) => {
      const [payload, games] = await Promise.all([
        client.fetchDailyBoxScore(day.scoringPeriodId),
        fetchNbaGamesForDate(day.date),
      ]);
      return { scoringPeriodId: day.scoringPeriodId, date: day.date, payload, games };
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

async function fetchNbaGamesForDate(date: string): Promise<Record<string, GameLine> | null> {
  const raw = await fetchNbaScoreboardRaw(date);
  return raw === null ? null : readNbaScoreboard(raw);
}

/** A fresh read for scheduled warnings, using the same loader as the score page. */
export async function loadCurrentScoresWeek(): Promise<ScoresWeek> {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) throw new Error('Missing ESPN credentials');
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID, seasonId: Number(ESPN_SEASON_ID ?? 2026),
    espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: ESPN_COOKIE_STRING,
  });
  return loadWeek(client, null);
}
