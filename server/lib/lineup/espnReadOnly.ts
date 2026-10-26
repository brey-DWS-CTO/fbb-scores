import { createHash, randomUUID } from 'node:crypto';
import axios from 'axios';
import { parseEspnLineup, espnLineupRevisionContent } from '../../../src/lib/league/espnLineup.js';
import type { LineupSnapshot } from '../../../src/lib/league/lineup.js';
import { DisabledEspnLineupProvider, type TeamBinding } from './provider.js';

export interface EspnLineupReadConfig { leagueId: string; seasonId: number; cookie: string }
export interface EspnReadRequest { url: string; headers: Record<string, string>; timeoutMs: number }
export interface EspnReadResponse { status: number; data: unknown }
/** GET-only transport. No method, request body, arbitrary host, or write path. */
export type EspnReadTransport = (request: EspnReadRequest) => Promise<EspnReadResponse>;
const READ_ORIGIN = 'https://lm-api-reads.fantasy.espn.com';

export function lineupReadsEnabled(): boolean { return process.env.ESPN_LINEUP_READS_ENABLED === '1'; }
export function espnLineupReadConfig(): EspnLineupReadConfig | null {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const seasonId = Number(process.env.ESPN_SEASON_ID ?? 2027);
  const cookie = process.env.ESPN_COOKIE_STRING || (process.env.ESPN_S2 && process.env.ESPN_SWID
    ? `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}` : '');
  return leagueId && cookie ? { leagueId, seasonId, cookie } : null;
}
export const espnReadGet: EspnReadTransport = async request => {
  // Do not return or log Axios errors: they can include the Cookie header.
  try {
    const response = await axios.get<unknown>(request.url, { headers: request.headers,
      timeout: request.timeoutMs, maxRedirects: 0, validateStatus: () => true,
      maxContentLength: 8 * 1024 * 1024 });
    return { status: response.status, data: response.data };
  } catch { throw new Error('The ESPN roster read could not be completed.'); }
};

/** Observed LM editor reads; execute() remains the inherited unconditional refusal. */
export class EspnReadOnlyLineupProvider extends DisabledEspnLineupProvider {
  private config: () => EspnLineupReadConfig | null;
  private transport: EspnReadTransport;
  private enabled: () => boolean;
  private clock: () => Date;
  constructor(config = espnLineupReadConfig, transport = espnReadGet, enabled = lineupReadsEnabled, clock = () => new Date()) {
    super(); this.config = config; this.transport = transport; this.enabled = enabled; this.clock = clock;
  }
  override async read(team: TeamBinding): Promise<LineupSnapshot> {
    if (!this.enabled()) throw new Error('ESPN roster reads are not enabled.');
    const config = this.config();
    if (!config || !/^\d+$/.test(config.leagueId) || !Number.isSafeInteger(config.seasonId)
      || config.seasonId < 2000 || config.seasonId > 2200 || !config.cookie
      || config.leagueId !== team.leagueId || !Number.isSafeInteger(team.teamId) || team.teamId < 1) {
      throw new Error('ESPN roster configuration or team binding is unavailable.');
    }
    const startedAt = this.clock();
    const base = `${READ_ORIGIN}/apis/v3/games/fba/seasons/${config.seasonId}/segments/0/leagues/${config.leagueId}`;
    const get = async (params: Array<[string, string]>): Promise<unknown> => {
      const url = new URL(base);
      for (const [key, value] of params) url.searchParams.append(key, value);
      // The captured browser requests were conditional 304s. Do not reuse those
      // bodies as fresh verification: request a unique uncached read each time.
      url.searchParams.set('_', randomUUID());
      let response: EspnReadResponse;
      try {
        response = await this.transport({ url: url.toString(), timeoutMs: 12000,
          headers: { Cookie: config.cookie, Accept: 'application/json', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
      } catch { throw new Error('The ESPN roster read could not be completed.'); }
      if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 304)) {
        throw new Error('The ESPN session needs to be refreshed.');
      }
      if (response.status !== 200) throw new Error('ESPN did not return a fresh roster response.');
      return response.data;
    };
    // These are the view names and team-scoped roster parameters observed in
    // LM Tools → Edit Roster → Perform as Team Manager, October 25, 2026.
    const settings = await get([['view', 'mSettings'], ['view', 'mTeam']]);
    const period = settings && typeof settings === 'object' && 'scoringPeriodId' in settings ? settings.scoringPeriodId : null;
    if (!Number.isSafeInteger(period) || Number(period) < 0) throw new Error('ESPN did not identify the current scoring period.');
    const roster = await get([['forTeamId', String(team.teamId)], ['scoringPeriodId', String(period)], ['view', 'mRoster']]);
    const completedAt = this.clock();
    // A slow response must not be stamped as if the data was just obtained.
    if (completedAt.getTime() - startedAt.getTime() > 30000 || completedAt < startedAt) throw new Error('The ESPN roster read is stale.');
    let snapshot: LineupSnapshot;
    try { snapshot = parseEspnLineup(settings, roster, { ...team, seasonId: config.seasonId }, startedAt); }
    catch { throw new Error('ESPN roster data could not be safely interpreted.'); }
    snapshot.revision = createHash('sha256').update(espnLineupRevisionContent(snapshot, settings)).digest('hex');
    return snapshot;
  }
}
