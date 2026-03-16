import { Router, type Request } from 'express';
import axios from 'axios';
import { EspnClient } from '../../src/lib/espn/client.js';
import { normalizeLeagueResponse, normalizeMatchupDetail, normalizeDailyView } from '../../src/lib/espn/adapter.js';
import { saveMatchupSnapshot, getLatestSnapshot, savePlayerSnapshots, getPlayerTrend, getTeamTrend } from '../../src/lib/supabase/snapshots.js';
import type { EspnMatchupRaw, EspnRosterEntry, GameStatus, NbaGameInfo } from '../../src/types/index.js';
import { NBA_TEAM_ABBREV } from '../../src/lib/espn/calculations.js';

const router = Router();

/**
 * Build the full cookie string for ESPN requests.
 *
 * Priority:
 *  1. ESPN_COOKIE_STRING — the entire cookie header copied from Chrome DevTools Network tab (recommended)
 *  2. espn_s2 + SWID built from individual env vars (may not work if ESPN needs more cookies)
 */
function buildCookieString(req: Request): string {
  const { ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (ESPN_COOKIE_STRING) return ESPN_COOKIE_STRING;
  const parts: string[] = [];
  if (ESPN_S2) parts.push(`espn_s2=${ESPN_S2}`);
  if (ESPN_SWID) parts.push(`SWID=${ESPN_SWID}`);
  // Allow the frontend to forward browser cookies as a fallback
  const forwarded = req.headers['x-espn-cookies'];
  if (forwarded && typeof forwarded === 'string') parts.push(forwarded);
  return parts.join('; ');
}

/**
 * GET /api/espn/scoreboard
 * Fetches the current week's matchup data from ESPN and returns normalized scoreboard data.
 */
router.get('/espn/scoreboard', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;

  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({
      error: 'Missing credentials: set ESPN_COOKIE_STRING (preferred) or both ESPN_S2 and ESPN_SWID in .env',
    });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID,
      seasonId,
      espnS2: ESPN_S2,
      swid: ESPN_SWID,
      cookieOverride: cookieString,
    });

    const raw = await client.fetchScoreboard();
    const matchupPeriod = req.query.matchupPeriod
      ? parseInt(req.query.matchupPeriod as string, 10)
      : undefined;

    // Fetch NBA scoreboard for live game data + schedule for remaining matchup days
    const effectiveMatchupPeriod = matchupPeriod ?? raw.status.currentMatchupPeriod;
    const matchupScoringPeriods = raw.settings.scheduleSettings.matchupPeriods[String(effectiveMatchupPeriod)] ?? [];
    const todayScoringPeriod = raw.scoringPeriodId;

    // Get remaining days in matchup period (after today)
    const remainingDates = getRemainingMatchupDates(matchupScoringPeriods, todayScoringPeriod);

    const [nbaScoreboard, nbaSchedule] = await Promise.all([
      fetchNbaScoreboard(),
      fetchNbaScheduleForDates(remainingDates),
    ]);

    const scoreboard = normalizeLeagueResponse(raw, matchupPeriod, nbaScoreboard, nbaSchedule);

    // Save snapshot to Supabase (fire-and-forget)
    saveMatchupSnapshot(scoreboard).catch((e) =>
      console.error('[Supabase] Snapshot save failed:', e),
    );

    res.json(scoreboard);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching scoreboard:', message);

    // Try returning cached data from Supabase as fallback
    try {
      const cached = await getLatestSnapshot(ESPN_LEAGUE_ID, seasonId);
      if (cached) {
        console.log('[ESPN proxy] Returning cached scoreboard from Supabase');
        res.json(cached);
        return;
      }
    } catch { /* ignore cache errors */ }

    const hint = message.includes('auth') || message.includes('401') || message.includes('302')
      ? ' — Try adding ESPN_EXTRA_COOKIES to your .env (see README for instructions)'
      : '';
    res.status(502).json({ error: message + hint });
  }
});

/**
 * GET /api/espn/league-info
 * Returns league schedule settings for the week selector.
 */
router.get('/espn/league-info', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;

  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({ error: 'Missing credentials' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID, seasonId,
      espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: cookieString,
    });

    const raw = await client.fetchScoreboard();
    const { scheduleSettings } = raw.settings;
    const totalMatchupPeriods = Object.keys(scheduleSettings.matchupPeriods).length;

    res.json({
      regularSeasonWeeks: scheduleSettings.matchupPeriodCount,
      playoffTeamCount: scheduleSettings.playoffTeamCount,
      currentMatchupPeriod: raw.status.currentMatchupPeriod,
      totalMatchupPeriods,
      matchupPeriods: scheduleSettings.matchupPeriods,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching league info:', message);
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/espn/debug — raw ESPN data for debugging score discrepancies.
 * Only available in development.
 */
router.get('/espn/debug', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') { res.status(404).json({ error: 'Not found' }); return; }
  next();
}, async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({ error: 'Missing credentials' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID, seasonId,
      espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: cookieString,
    });

    const raw = await client.fetchScoreboard();
    const cmp = raw.status.currentMatchupPeriod;
    const matchups = raw.schedule.filter((m) => m.matchupPeriodId === cmp);

    const debug = matchups.map((m) => {
      const buildSideDebug = (side: EspnMatchupRaw['home']) => ({
        teamId: side.teamId,
        totalPoints: side.totalPoints,
        totalPointsLive: side.totalPointsLive,
        hasMatchupRoster: !!side.rosterForMatchupPeriod,
        hasCurrentRoster: !!side.rosterForCurrentScoringPeriod,
        currentDayPts: side.rosterForCurrentScoringPeriod?.entries?.reduce(
          (sum: number, e: EspnRosterEntry) => sum + (e.playerPoolEntry?.appliedStatTotal || 0), 0) || 0,
        matchupPeriodPts: side.rosterForMatchupPeriod?.entries?.reduce(
          (sum: number, e: EspnRosterEntry) => sum + (e.playerPoolEntry?.appliedStatTotal || 0), 0) || 0,
      });
      return { id: m.id, home: buildSideDebug(m.home), away: buildSideDebug(m.away) };
    });

    res.json({
      scoringPeriodId: raw.scoringPeriodId,
      currentMatchupPeriod: cmp,
      matchupPeriods: raw.settings.scheduleSettings.matchupPeriods[String(cmp)],
      debug,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/espn/daily/:matchupId
 * Fetches today's per-player scoring data for a specific matchup.
 */
router.get('/espn/daily/:matchupId', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({ error: 'Missing credentials' });
    return;
  }

  const matchupId = parseInt(req.params.matchupId, 10);
  if (isNaN(matchupId)) {
    res.status(400).json({ error: 'Invalid matchup ID' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID, seasonId,
      espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: cookieString,
    });

    const scoringPeriodId = await client.getCurrentScoringPeriod();
    const [raw, nbaGames] = await Promise.all([
      client.fetchMatchupDetail(scoringPeriodId),
      fetchNbaScoreboard(),
    ]);
    const daily = normalizeDailyView(raw, matchupId);

    if (!daily) {
      res.status(404).json({ error: 'Matchup not found' });
      return;
    }

    // Enrich daily players with live NBA game info
    if (nbaGames.size > 0) {
      for (const team of [daily.home, daily.away]) {
        for (const player of team.players) {
          const gameInfo = nbaGames.get(player.nbaTeamAbbrev);
          if (gameInfo) {
            player.gameInfo = gameInfo;
          }
        }
      }
    }

    res.json(daily);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching daily view:', message);
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/espn/matchup/:matchupId
 * Fetches detailed player data for a specific matchup.
 */
router.get('/espn/matchup/:matchupId', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({ error: 'Missing credentials' });
    return;
  }

  const matchupId = parseInt(req.params.matchupId, 10);
  if (isNaN(matchupId)) {
    res.status(400).json({ error: 'Invalid matchup ID' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID, seasonId,
      espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: cookieString,
    });

    // Get current period info first, then fetch with per-player stats
    const scoringPeriodId = await client.getCurrentScoringPeriod();
    const raw = await client.fetchMatchupDetail(scoringPeriodId);
    const matchupDetail = normalizeMatchupDetail(raw, matchupId);

    if (!matchupDetail) {
      res.status(404).json({ error: 'Matchup not found' });
      return;
    }

    // Save player snapshots to Supabase (fire-and-forget)
    savePlayerSnapshots(ESPN_LEAGUE_ID, seasonId, matchupDetail).catch((e) =>
      console.error('[Supabase] Player snapshot save failed:', e),
    );

    res.json(matchupDetail);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching matchup detail:', message);
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/espn/debug-stats — inspect raw player stat entries to debug rolling averages.
 * Only available in development.
 */
router.get('/espn/debug-stats', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') { res.status(404).json({ error: 'Not found' }); return; }
  next();
}, async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID || (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID))) {
    res.status(500).json({ error: 'Missing credentials' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;
  const cookieString = buildCookieString(req);

  try {
    const client = new EspnClient({
      leagueId: ESPN_LEAGUE_ID, seasonId,
      espnS2: ESPN_S2, swid: ESPN_SWID, cookieOverride: cookieString,
    });

    const scoringPeriodId = await client.getCurrentScoringPeriod();
    const raw = await client.fetchMatchupDetail(scoringPeriodId);
    const cmp = raw.status.currentMatchupPeriod;
    const matchup = raw.schedule.find((m) => m.matchupPeriodId === cmp);
    if (!matchup) { res.json({ error: 'No matchup found' }); return; }

    // Get first player's raw stats to understand structure
    const entries = matchup.home.rosterForMatchupPeriod?.entries ??
                    matchup.home.rosterForCurrentScoringPeriod?.entries ?? [];
    const firstEntry = entries[0];
    if (!firstEntry) { res.json({ error: 'No roster entries' }); return; }

    const player = firstEntry.playerPoolEntry.player;
    const statEntries = player.stats ?? [];

    res.json({
      scoringPeriodId,
      playerName: player.fullName,
      totalStatEntries: statEntries.length,
      statEntrySummary: statEntries.map((s) => ({
        statSplitTypeId: s.statSplitTypeId,
        statSourceId: s.statSourceId,
        scoringPeriodId: s.scoringPeriodId,
        hasStats: !!s.stats,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/espn/trends/player/:playerId
 * Returns historical trend data for a single player.
 */
router.get('/espn/trends/player/:playerId', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID } = process.env;
  if (!ESPN_LEAGUE_ID) {
    res.status(500).json({ error: 'Missing ESPN_LEAGUE_ID' });
    return;
  }

  const playerId = parseInt(req.params.playerId, 10);
  if (isNaN(playerId)) {
    res.status(400).json({ error: 'Invalid player ID' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;

  try {
    const trend = await getPlayerTrend(ESPN_LEAGUE_ID, seasonId, playerId);
    if (!trend) {
      res.status(404).json({ error: 'No trend data found for this player' });
      return;
    }
    res.json(trend);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching player trend:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/espn/trends/team/:teamId
 * Returns historical trend data for a fantasy team.
 */
router.get('/espn/trends/team/:teamId', async (req, res) => {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID } = process.env;
  if (!ESPN_LEAGUE_ID) {
    res.status(500).json({ error: 'Missing ESPN_LEAGUE_ID' });
    return;
  }

  const teamId = parseInt(req.params.teamId, 10);
  if (isNaN(teamId)) {
    res.status(400).json({ error: 'Invalid team ID' });
    return;
  }

  const seasonId = ESPN_SEASON_ID ? parseInt(ESPN_SEASON_ID, 10) : 2026;

  try {
    const trend = await getTeamTrend(ESPN_LEAGUE_ID, seasonId, teamId);
    if (!trend) {
      res.status(404).json({ error: 'No trend data found for this team' });
      return;
    }
    res.json(trend);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching team trend:', message);
    res.status(500).json({ error: message });
  }
});

// ─── NBA Schedule Helpers ────────────────────────────────────────────────────

/**
 * Given the scoring periods in a matchup and today's scoring period,
 * return the dates for remaining days (after today) as YYYY-MM-DD strings.
 *
 * ESPN scoring periods increment by 1 per day, so we can convert them
 * to dates by offsetting from today's date + scoring period.
 */
function getRemainingMatchupDates(
  matchupScoringPeriods: number[],
  todayScoringPeriod: number,
): string[] {
  const futurePeriods = matchupScoringPeriods.filter((sp) => sp > todayScoringPeriod);
  if (futurePeriods.length === 0) return [];

  const today = new Date();
  return futurePeriods.map((sp) => {
    const daysFromToday = sp - todayScoringPeriod;
    const date = new Date(today);
    date.setDate(date.getDate() + daysFromToday);
    return date.toISOString().split('T')[0];
  });
}

// ─── NBA Scoreboard (public API) ─────────────────────────────────────────────

const NBA_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

interface EspnNbaScoreboard {
  events?: Array<{
    competitions?: Array<{
      status?: {
        clock?: number; // seconds remaining in current period
        type?: { name?: string; shortDetail?: string };
        displayClock?: string;
        period?: number;
      };
      competitors?: Array<{
        homeAway?: string;
        score?: string;
        team?: { abbreviation?: string };
      }>;
    }>;
  }>;
}

/**
 * Fetch today's NBA scoreboard from ESPN's public API (no auth required).
 * Returns a map of NBA team abbreviation → game info.
 */
async function fetchNbaScoreboard(): Promise<Map<string, NbaGameInfo>> {
  const gameMap = new Map<string, NbaGameInfo>();

  try {
    const { data } = await axios.get<EspnNbaScoreboard>(NBA_SCOREBOARD_URL, {
      timeout: 5000,
    });

    if (!data.events) return gameMap;

    for (const event of data.events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const statusName = comp.status?.type?.name ?? '';
      const shortDetail = comp.status?.type?.shortDetail ?? '';
      const displayClock = comp.displayClock ?? '';
      const period = comp.status?.period ?? 0;

      // Clock is in seconds remaining in current period
      const clockSeconds = comp.status?.clock ?? 0;

      let status: GameStatus = 'unknown';
      if (statusName === 'STATUS_IN_PROGRESS') status = 'live';
      else if (statusName === 'STATUS_FINAL') status = 'final';
      else if (statusName === 'STATUS_SCHEDULED') status = 'upcoming';
      else if (statusName === 'STATUS_HALFTIME') status = 'live';

      // Compute minutes remaining in the game
      // Regulation: (4 - period) * 12 + clockSeconds/60
      // OT: each OT period is 5 minutes; add 5 per remaining OT period
      let minutesRemaining = 0;
      if (status === 'live' && period > 0) {
        if (period <= 4) {
          // Regulation: remaining full quarters + current quarter clock
          minutesRemaining = (4 - period) * 12 + clockSeconds / 60;
        } else {
          // In OT: only current OT period clock remains (5 min periods)
          minutesRemaining = clockSeconds / 60;
        }
      } else if (status === 'upcoming') {
        minutesRemaining = 48; // Full game
      }
      // final → 0 (default)

      // Build status detail string
      let statusDetail = shortDetail;
      if (status === 'live' && displayClock && period > 0) {
        const periodNames = ['', '1st', '2nd', '3rd', '4th', 'OT'];
        const periodName = period <= 4 ? periodNames[period] : `${period - 4}OT`;
        statusDetail = statusName === 'STATUS_HALFTIME' ? 'Halftime' : `${displayClock} - ${periodName}`;
      }

      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

      const homeAbbr = home.team.abbreviation;
      const awayAbbr = away.team.abbreviation;
      const scoreDisplay = `${awayAbbr} ${away.score ?? 0} - ${homeAbbr} ${home.score ?? 0}`;

      // Add entry for home team
      gameMap.set(homeAbbr, {
        status,
        statusDetail,
        scoreDisplay,
        opponent: awayAbbr,
        isHome: true,
        period,
        minutesRemaining,
      });

      // Add entry for away team
      gameMap.set(awayAbbr, {
        status,
        statusDetail,
        scoreDisplay,
        opponent: homeAbbr,
        isHome: false,
        period,
        minutesRemaining,
      });
    }
  } catch (err) {
    console.error('[NBA Scoreboard] Failed to fetch:', err instanceof Error ? err.message : err);
  }

  return gameMap;
}

/**
 * Fetch NBA schedule for specific dates to determine which teams play on remaining days.
 * Returns a map of ESPN proTeamId → number of remaining games.
 */
async function fetchNbaScheduleForDates(dates: string[]): Promise<Map<number, number>> {
  const teamGamesRemaining = new Map<number, number>();
  if (dates.length === 0) return teamGamesRemaining;

  // Reverse lookup: NBA abbreviation → ESPN proTeamId
  const abbrevToProTeamId = new Map<string, number>();
  for (const [id, abbr] of Object.entries(NBA_TEAM_ABBREV)) {
    abbrevToProTeamId.set(abbr, parseInt(id, 10));
  }

  try {
    // Fetch scoreboard for each remaining date
    const fetches = dates.map(async (date) => {
      const dateStr = date.replace(/-/g, ''); // YYYYMMDD
      const { data } = await axios.get<EspnNbaScoreboard>(
        `${NBA_SCOREBOARD_URL}?dates=${dateStr}`,
        { timeout: 5000 },
      );
      return data;
    });

    const results = await Promise.all(fetches);

    for (const data of results) {
      if (!data.events) continue;
      for (const event of data.events) {
        const comp = event.competitions?.[0];
        if (!comp?.competitors) continue;
        for (const team of comp.competitors) {
          const abbr = team.team?.abbreviation;
          if (!abbr) continue;
          const proTeamId = abbrevToProTeamId.get(abbr);
          if (proTeamId != null) {
            teamGamesRemaining.set(proTeamId, (teamGamesRemaining.get(proTeamId) ?? 0) + 1);
          }
        }
      }
    }
  } catch (err) {
    console.error('[NBA Schedule] Failed to fetch:', err instanceof Error ? err.message : err);
  }

  return teamGamesRemaining;
}

export default router;
