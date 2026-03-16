import { Router, type Request } from 'express';
import { EspnClient } from '../../src/lib/espn/client.js';
import { normalizeLeagueResponse, normalizeMatchupDetail } from '../../src/lib/espn/adapter.js';
import { saveMatchupSnapshot, getLatestSnapshot, savePlayerSnapshots, getPlayerTrend, getTeamTrend } from '../../src/lib/supabase/snapshots.js';
import type { EspnMatchupRaw, EspnRosterEntry } from '../../src/types/index.js';

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
    const scoreboard = normalizeLeagueResponse(raw);

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

export default router;
