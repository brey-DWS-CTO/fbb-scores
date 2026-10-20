/**
 * League-manager writes to ESPN, with the cookies the app already reads with.
 *
 * Two writes, both captured from the LM Tools pages in a browser on
 * 18 October 2026 (see memory `espn-waiver-settings-write`):
 *
 *   POST .../leagues/{id}/settings?scoringPeriodId=0
 *   {"acquisitionSettings":{"waiverProcessHour":17}}      hour in Eastern
 *
 *   POST .../leagues/{id}/transactions/
 *   {"isLeagueManager":true,"teamId":5,"type":"FREEAGENT","scoringPeriodId":1,
 *    "executionType":"EXECUTE","items":[{"playerId":3012,"type":"ADD","toTeamId":5}],
 *    "isActingAsTeamOwner":false,"skipTransactionCounters":false}
 *
 * Both shapes are exactly what the LM Tools pages sent, cookies and all.
 * Run with ESPN_LM_DRY_RUN=1 first on a new deploy and read the log.
 *
 * ESPN answers a bad or stale sign-in with a 302 to espn.com or a 401. Either
 * marks the write side as down until a write succeeds again, and the app
 * shows a banner so the commissioner refreshes the cookies in Vercel.
 */
import axios, { type AxiosInstance } from 'axios';
import { appendAudit } from './leagueStore.js';

const WRITES_BASE = 'https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba';

export interface EspnWriteResult {
  ok: boolean;
  /** True when nothing was sent (dry run). */
  dryRun: boolean;
  status: number | null;
  /** ESPN's answer, cut short, for the audit log. */
  body: string;
  /** True when ESPN refused the session itself, not the request. */
  authFailed: boolean;
}

export interface EspnLmConfig {
  leagueId: string;
  seasonId: number;
  cookie: string;
  dryRun: boolean;
}

/** Why the write side is down, or null while it works. */
let writeTrouble: string | null = null;

export function espnWriteTrouble(): string | null {
  return writeTrouble;
}

export function dryRunOn(): boolean {
  return process.env.ESPN_LM_DRY_RUN === '1' || process.env.ESPN_LM_DRY_RUN === 'true';
}

/** The config from the environment, or null when the cookies are not set. */
export function espnLmConfig(): EspnLmConfig | null {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) return null;
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) return null;
  return {
    leagueId: ESPN_LEAGUE_ID,
    seasonId: ESPN_SEASON_ID ? Number.parseInt(ESPN_SEASON_ID, 10) : 2027,
    cookie: ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
    dryRun: dryRunOn(),
  };
}

function http(config: EspnLmConfig): AxiosInstance {
  return axios.create({
    baseURL: `${WRITES_BASE}/seasons/${config.seasonId}/segments/0/leagues/${config.leagueId}`,
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15_000,
    headers: {
      Cookie: config.cookie,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'espn-fantasy-web',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: `https://fantasy.espn.com/basketball/league/settings?leagueId=${config.leagueId}`,
      Origin: 'https://fantasy.espn.com',
    },
  });
}

async function post(config: EspnLmConfig, path: string, body: unknown, action: string): Promise<EspnWriteResult> {
  if (config.dryRun) {
    console.log(`[espn-lm] DRY RUN ${action}: POST ${path} ${JSON.stringify(body)}`);
    await appendAudit(null, `${action}.dry-run`, { path, body });
    return { ok: true, dryRun: true, status: null, body: '', authFailed: false };
  }
  try {
    const response = await http(config).post(path, body);
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    const authFailed = response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400);
    const ok = response.status >= 200 && response.status < 300;
    if (authFailed) writeTrouble = `ESPN refused the sign-in (${response.status}). Refresh the ESPN cookies in Vercel.`;
    else if (ok) writeTrouble = null;
    return { ok, dryRun: false, status: response.status, body: text.slice(0, 500), authFailed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, dryRun: false, status: null, body: message.slice(0, 500), authFailed: false };
  }
}

/** Set the hour ESPN runs waivers at, Eastern time, 0 to 23. */
export async function setWaiverHour(config: EspnLmConfig, hourET: number): Promise<EspnWriteResult> {
  const hour = Math.max(0, Math.min(23, Math.round(hourET)));
  return post(config, '/settings?scoringPeriodId=0', { acquisitionSettings: { waiverProcessHour: hour } }, 'lm.waiverHour');
}

export interface LmAddInput {
  teamId: number;
  playerId: number;
  scoringPeriodId: number;
}

/** Add a free agent to a team as the league manager. No drop; the member drops. */
export async function lmAdd(config: EspnLmConfig, input: LmAddInput): Promise<EspnWriteResult> {
  const body = {
    isLeagueManager: true,
    teamId: input.teamId,
    type: 'FREEAGENT',
    scoringPeriodId: input.scoringPeriodId,
    executionType: 'EXECUTE',
    items: [{ playerId: input.playerId, type: 'ADD', toTeamId: input.teamId }],
    isActingAsTeamOwner: false,
    skipTransactionCounters: false,
  };
  return post(config, '/transactions/', body, 'lm.add');
}

/** What ESPN said, in one line for a note or a log. */
export function describeWrite(result: EspnWriteResult): string {
  if (result.dryRun) return 'dry run, nothing sent';
  if (result.ok) return `ESPN accepted (${result.status})`;
  if (result.authFailed) return `ESPN refused the sign-in (${result.status})`;
  return `ESPN said ${result.status ?? 'nothing'}: ${result.body || 'no detail'}`;
}
