import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { EspnLeagueResponse } from '../../types/index.js';
import type { EspnPlayerPoolPlayer } from '../league/playerPool.js';
import type { EspnTeamName } from '../league/teamNames.js';
import { NBA_TEAM_ABBREV } from './calculations.js';

const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba';

interface EspnClientConfig {
  leagueId: string;
  seasonId: number;
  espnS2?: string;
  swid?: string;
  /** Optional: full cookie string override (e.g. copied from browser DevTools Network tab) */
  cookieOverride?: string;
}

interface EspnKonaPlayerEntry {
  id: number;
  player?: {
    id?: number;
    fullName?: string;
    proTeamId?: number;
    defaultPositionId?: number;
    eligibleSlots?: number[];
  };
  fullName?: string;
  proTeamId?: number;
  defaultPositionId?: number;
  eligibleSlots?: number[];
}

interface EspnKonaResponse {
  scoringPeriodId: number;
  players?: EspnKonaPlayerEntry[];
}

/** What the `mTeam` view answers with. Only the naming fields matter here. */
interface EspnTeamViewResponse {
  teams?: Array<{
    id?: number;
    name?: string;
    location?: string;
    nickname?: string;
    owners?: string[];
  }>;
  members?: Array<{
    id?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  }>;
}

const ELIGIBLE_SLOT_POSITION: Record<number, string> = {
  0: 'PG',
  1: 'SG',
  2: 'SF',
  3: 'PF',
  4: 'C',
};

const DEFAULT_POSITION: Record<number, string> = {
  1: 'PG',
  2: 'SG',
  3: 'SF',
  4: 'PF',
  5: 'C',
};

/**
 * A short, safe description of what ESPN sent back, for error messages.
 *
 * Keys only for objects, a clipped head for HTML or text. Never the cookies,
 * which live in the request, not the response.
 */
function describeBody(data: unknown): string {
  if (data === null || data === undefined) return 'empty body';
  if (typeof data === 'string') return `text body starts: ${data.slice(0, 120).replace(/\s+/g, ' ')}`;
  if (Array.isArray(data)) return `array body, ${data.length} entries`;
  if (typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>).slice(0, 12);
    const messages = (data as { messages?: unknown }).messages;
    const detail = Array.isArray(messages) ? ` messages: ${messages.join('; ').slice(0, 160)}` : '';
    return `object body, keys: ${keys.join(', ')}.${detail}`;
  }
  return `${typeof data} body`;
}

export class EspnClient {
  private http: AxiosInstance;

  /**
   * Same headers, no interceptor. The leagueHistory endpoint answers with an
   * array, which the main interceptor treats as a failed login.
   */
  private historyHttp: AxiosInstance;

  private leagueId: string;

  private seasonId: number;

  constructor(config: EspnClientConfig) {
    const cookieString = config.cookieOverride
      ?? `espn_s2=${config.espnS2 ?? ''}; SWID=${config.swid ?? ''}`;
    this.leagueId = config.leagueId;
    this.seasonId = config.seasonId;

    const headers = {
      Cookie: cookieString,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `https://fantasy.espn.com/basketball/league?leagueId=${config.leagueId}`,
      Origin: 'https://fantasy.espn.com',
    };

    this.historyHttp = axios.create({
      baseURL: `${ESPN_BASE}/leagueHistory`,
      maxRedirects: 0,
      validateStatus: (status) => status < 400,
      headers,
    });

    this.http = axios.create({
      baseURL: `${ESPN_BASE}/seasons/${config.seasonId}/segments/0/leagues/${config.leagueId}`,
      maxRedirects: 0, // Don't follow 302 — ESPN redirects to www.espn.com on bad auth
      validateStatus: (status) => status < 400, // treat 302 as a valid response so interceptor can handle it
      headers: {
        Cookie: cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://fantasy.espn.com/basketball/league?leagueId=${config.leagueId}`,
        Origin: 'https://fantasy.espn.com',
      },
    });

    // Intercept auth errors with a clear message
    this.http.interceptors.response.use(
      (res) => {
        // ESPN redirects to www.espn.com/fantasy/ when cookies are invalid.
        //
        // A signed-out answer is a redirect or an HTML page. A signed-in answer
        // is JSON, and which keys it carries depends on the view: the player
        // pool comes back under `players`, the scoreboard under
        // `scoringPeriodId`. Demanding `scoringPeriodId` of every view called
        // the player pool a login failure. `leagueHistory` needed its own
        // client for the same reason.
        const body = res.data as Record<string, unknown> | null;
        const looksSignedIn = Boolean(
          body && typeof body === 'object'
          && ('scoringPeriodId' in body || 'players' in body || 'teams' in body || 'id' in body),
        );
        if (res.status === 302 || typeof res.data === 'string' || !looksSignedIn) {
          // Say what came back. Without this the message blames the cookies for
          // every shape ESPN can return, including a season that is not open yet.
          throw new Error(
            'ESPN authentication failed — cookies are invalid or expired. ' +
            'Refresh your espn_s2 and SWID cookies from fantasy.espn.com and update .env. ' +
            `[status ${res.status}, ${describeBody(res.data)}]`,
          );
        }
        return res;
      },
      (error) => {
        if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 302)) {
          throw new Error(
            'ESPN authentication failed — check that ESPN_S2 and ESPN_SWID cookies are valid. ' +
            `[status ${error.response?.status}, ${describeBody(error.response?.data)}]`,
          );
        }
        if (axios.isAxiosError(error) && error.response) {
          throw new Error(
            `ESPN request failed with status ${error.response.status}. ` +
            `${describeBody(error.response.data)}`,
          );
        }
        throw error;
      },
    );
  }

  /**
   * Fetch the current scoring period from league settings.
   */
  async getCurrentScoringPeriod(): Promise<number> {
    const { data } = await this.http.get<EspnLeagueResponse>('', {
      params: { view: 'mSettings' },
    });
    return data.scoringPeriodId;
  }

  /**
   * Fetch full scoreboard data for a given scoring period.
   * If no period is supplied, the current period is fetched first.
   */
  async fetchScoreboard(scoringPeriodId?: number): Promise<EspnLeagueResponse> {
    const periodId = scoringPeriodId ?? (await this.getCurrentScoringPeriod());

    const { data } = await this.http.get<EspnLeagueResponse>('', {
      params: {
        view: ['mMatchup', 'mMatchupScore', 'mRoster', 'mTeam', 'mSettings', 'mStatus'],
        scoringPeriodId: periodId,
        _: Date.now(), // cache-buster to bypass ESPN CDN caching
      },
      // axios serializes array params as view[]=... by default;
      // ESPN expects repeated keys: view=mMatchup&view=mMatchupScore&...
      paramsSerializer: {
        indexes: null,
      },
    });

    return data;
  }

  /**
   * Fetch detailed player data for matchup detail view.
   * Requests per-scoring-period stats for the last 30 days to compute rolling averages.
   */
  async fetchMatchupDetail(scoringPeriodId: number): Promise<EspnLeagueResponse> {
    // mRoster provides team roster with pre-computed rolling averages (split types 1/2/3)
    // mMatchup provides matchup-period aggregated stats (split type 5)
    const { data } = await this.http.get<EspnLeagueResponse>('', {
      params: {
        view: ['mMatchup', 'mMatchupScore', 'mRoster', 'mTeam', 'mSettings', 'mStatus'],
        scoringPeriodId,
        _: Date.now(),
      },
      paramsSerializer: {
        indexes: null,
      },
    });

    return data;
  }

  /**
   * Fetch daily box score data for a specific scoring period.
   * Uses the x-fantasy-filter header to request per-scoring-period stat breakdowns,
   * which ESPN otherwise omits from the standard mMatchup response.
   */
  async fetchDailyBoxScore(scoringPeriodId: number): Promise<EspnLeagueResponse> {
    const { data } = await this.http.get<EspnLeagueResponse>('', {
      params: {
        view: ['mMatchup', 'mMatchupScore', 'mRoster', 'mTeam', 'mSettings', 'mStatus'],
        scoringPeriodId,
        _: Date.now(),
      },
      headers: {
        'x-fantasy-filter': JSON.stringify({
          players: {
            filterStatsForCurrentScoringPeriod: { value: true },
          },
        }),
      },
      paramsSerializer: {
        indexes: null,
      },
    });

    return data;
  }

  /**
   * One finished season's teams, final ranks, and matchup scores, for the
   * league-history import.
   *
   * The modern endpoint answers for recent seasons. The league began in
   * 2010-11 and the oldest seasons need `/leagueHistory`, which is tried second
   * and may still come back empty: ESPN does not keep everything forever.
   * Untested against the live service, because no ESPN credentials exist
   * outside Vercel.
   */
  async fetchSeasonHistory(): Promise<unknown> {
    const params = {
      view: ['mTeam', 'mMatchupScore', 'mSettings', 'mStatus'],
      _: Date.now(),
    };
    try {
      const { data } = await this.http.get('', {
        params,
        paramsSerializer: { indexes: null },
      });
      return data;
    } catch (error) {
      const fallback = await this.fetchLeagueHistorySeason();
      if (fallback) return fallback;
      throw error;
    }
  }

  /** The old-season endpoint. Returns null when ESPN has nothing for that year. */
  private async fetchLeagueHistorySeason(): Promise<unknown | null> {
    const { data } = await this.historyHttp.get(`/${this.leagueId}`, {
      params: {
        seasonId: this.seasonId,
        view: ['mTeam', 'mMatchupScore', 'mSettings', 'mStatus'],
        _: Date.now(),
      },
      paramsSerializer: { indexes: null },
    });
    if (Array.isArray(data)) return data[0] ?? null;
    return data ?? null;
  }

  /**
   * Every team's ID, current name and owner, from the `mTeam` view.
   *
   * One small read of the thing being asked about. The scoreboard carries the
   * same names inside its matchups, but it also drags in rosters, settings and
   * live scores, and it only names the teams that play this week.
   *
   * ESPN answers with `name` on modern seasons and with `location` plus
   * `nickname` on older ones, so both are read.
   */
  async fetchTeamNames(): Promise<EspnTeamName[]> {
    const { data } = await this.http.get<EspnTeamViewResponse>('', {
      params: { view: 'mTeam', _: Date.now() },
      paramsSerializer: { indexes: null },
    });

    const memberById = new Map<string, string>();
    for (const member of data.members ?? []) {
      if (!member.id) continue;
      const display = member.displayName?.trim()
        || `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim();
      if (display) memberById.set(member.id, display);
    }

    const teams: EspnTeamName[] = [];
    for (const team of data.teams ?? []) {
      if (!Number.isInteger(team.id) || (team.id ?? 0) <= 0) continue;
      const name = team.name?.trim()
        || `${team.location ?? ''} ${team.nickname ?? ''}`.trim();
      if (!name) continue;
      const firstOwner = team.owners?.[0];
      teams.push({
        espnTeamId: team.id as number,
        name,
        ownerName: (firstOwner ? memberById.get(firstOwner) : undefined) ?? '',
      });
    }
    if (teams.length === 0) throw new Error('ESPN returned no teams');
    return teams;
  }

  /** Fetch every active-player page without requesting stats. */
  async fetchPlayerPool(): Promise<EspnPlayerPoolPlayer[]> {
    const limit = 500;
    const byId = new Map<number, EspnPlayerPoolPlayer>();

    for (let page = 0; page < 10; page += 1) {
      const offset = page * limit;
      const { data } = await this.http.get<EspnKonaResponse>('', {
        params: { view: 'kona_player_info', _: Date.now() },
        headers: {
          'x-fantasy-filter': JSON.stringify({
            players: {
              filterActive: { value: true },
              limit,
              offset,
              sortPercOwned: { sortPriority: 1, sortAsc: false },
            },
          }),
        },
      });
      const entries = data.players ?? [];
      let added = 0;
      for (const entry of entries) {
        const raw = entry.player ?? entry;
        const espnId = raw.id ?? entry.id;
        const fullName = raw.fullName?.trim();
        if (!Number.isInteger(espnId) || espnId <= 0 || !fullName) continue;
        const positions = [...new Set(
          (raw.eligibleSlots ?? [])
            .map((slot) => ELIGIBLE_SLOT_POSITION[slot])
            .filter((position): position is string => Boolean(position)),
        )];
        const fallbackPosition = raw.defaultPositionId
          ? DEFAULT_POSITION[raw.defaultPositionId]
          : undefined;
        if (positions.length === 0 && fallbackPosition) positions.push(fallbackPosition);
        if (positions.length === 0) continue;
        const proTeamId = raw.proTeamId ?? 0;
        const player: EspnPlayerPoolPlayer = {
          espnId,
          fullName,
          proTeam: proTeamId === 0 ? 'FA' : (NBA_TEAM_ABBREV[proTeamId] ?? String(proTeamId)),
          positions,
        };
        if (!byId.has(espnId)) added += 1;
        byId.set(espnId, player);
      }

      if (entries.length < limit) return [...byId.values()];
      if (added === 0) {
        throw new Error(`ESPN player-pool pagination stalled at offset ${offset}`);
      }
    }

    throw new Error('ESPN player pool exceeded 5,000 entries');
  }
}
