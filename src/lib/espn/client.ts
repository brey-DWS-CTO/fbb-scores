import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { EspnLeagueResponse } from '../../types/index.js';
import type { EspnPlayerPoolPlayer } from '../league/playerPool.js';
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

export class EspnClient {
  private http: AxiosInstance;

  constructor(config: EspnClientConfig) {
    const cookieString = config.cookieOverride
      ?? `espn_s2=${config.espnS2 ?? ''}; SWID=${config.swid ?? ''}`;

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
        // ESPN redirects to www.espn.com/fantasy/ when cookies are invalid
        if (
          res.status === 302 ||
          typeof res.data === 'string' ||
          (res.data && typeof res.data === 'object' && !('scoringPeriodId' in res.data))
        ) {
          throw new Error(
            'ESPN authentication failed — cookies are invalid or expired. ' +
            'Refresh your espn_s2 and SWID cookies from fantasy.espn.com and update .env.',
          );
        }
        return res;
      },
      (error) => {
        if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 302)) {
          throw new Error(
            'ESPN authentication failed — check that ESPN_S2 and ESPN_SWID cookies are valid.',
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
