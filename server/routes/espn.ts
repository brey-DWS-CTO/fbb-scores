import { Router, type Request } from 'express';
import { EspnClient } from '../../src/lib/espn/client.js';
import { normalizeLeagueResponse } from '../../src/lib/espn/adapter.js';

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

    res.json(scoreboard);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ESPN proxy] Error fetching scoreboard:', message);

    const hint = message.includes('auth') || message.includes('401') || message.includes('302')
      ? ' — Try adding ESPN_EXTRA_COOKIES to your .env (see README for instructions)'
      : '';
    res.status(502).json({ error: message + hint });
  }
});

export default router;
