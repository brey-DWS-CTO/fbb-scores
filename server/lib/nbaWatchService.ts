/**
 * Read NBA depth charts from ESPN and award odds from Kalshi for the commish's
 * AWARDS and DEPTH CHARTS pages. Nothing is stored: each server keeps the last read for
 * an hour, and REFRESH reads again.
 */
import {
  AWARDS,
  ESPN_TEAM_IDS,
  parseAwardMarkets,
  parseDepthChart,
  type AwardResult,
  type NbaWatch,
  type TeamDepth,
} from '../../src/lib/league/nbaWatch.js';

const DEPTH_URL = (teamId: number) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/depthcharts`;
const ODDS_URL = (series: string) =>
  `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=200`;
const KEEP_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

let kept: NbaWatch | null = null;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return response.json();
}

const reason = (error: unknown) => (error instanceof Error ? error.message : 'failed');

/** The last read if it is under an hour old, else a fresh one. */
export async function getNbaWatch(fresh = false): Promise<NbaWatch> {
  if (!fresh && kept && Date.now() - Date.parse(kept.fetchedAt) < KEEP_MS) return kept;
  const errors: string[] = [];
  const [teams, awards] = await Promise.all([
    Promise.all(ESPN_TEAM_IDS.map(async (teamId) => {
      try {
        return parseDepthChart(await getJson(DEPTH_URL(teamId)));
      } catch (error) {
        errors.push(`ESPN team ${teamId}: ${reason(error)}`);
        return null;
      }
    })),
    Promise.all(AWARDS.map(async (award): Promise<AwardResult> => {
      try {
        return { award, rows: parseAwardMarkets(await getJson(ODDS_URL(award.series))) };
      } catch (error) {
        return { award, rows: [], error: `Kalshi did not answer (${reason(error)}).` };
      }
    })),
  ]);
  const result: NbaWatch = {
    fetchedAt: new Date().toISOString(),
    teams: teams.filter((team): team is TeamDepth => team !== null).sort((a, b) => a.name.localeCompare(b.name)),
    awards,
    errors,
  };
  // A read that got nothing keeps the last good one on hand for next time.
  if (result.teams.length > 0 || awards.some((entry) => entry.rows.length > 0)) kept = result;
  return result;
}
