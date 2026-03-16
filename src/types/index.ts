// ─── Core domain types shared across the entire app ───────────────────────────

export interface TopPlayer {
  name: string;
  position: string;
  points: number;
  nbaTeamAbbrev: string;
  playerId: number;
}

export interface FantasyTeam {
  id: number;
  name: string;
  abbreviation: string;
  ownerName: string;
  /** URL to ESPN team logo, or null if unavailable */
  logoUrl: string | null;
  /** Total fantasy points scored this matchup period */
  currentScore: number;
  /** Average fantasy points per game played */
  avgPointsPerGame: number;
  /** Games played this matchup period */
  gamesPlayed: number;
  /** Max games allowed for the matchup period */
  maxGames: number;
  /** Projected score extrapolated to max games */
  projectedScore: number;
  /** Number of active roster slots */
  rosterCount: number;
  /** Playoff seed (1-based), or null if not in playoffs */
  playoffSeed: number | null;
  topPlayer: TopPlayer | null;
}

export type PlayoffTierType =
  | 'WINNERS_BRACKET'
  | 'LOSERS_CONSOLATION_LADDER'
  | 'NONE';

export interface Matchup {
  /** ESPN matchup ID */
  id: number;
  home: FantasyTeam;
  away: FantasyTeam;
  scoringPeriodId: number;
  isCompleted: boolean;
  /** Playoff tier for this matchup */
  playoffTierType: PlayoffTierType;
}

export interface PlayoffInfo {
  /** Whether the current matchup period is a playoff period */
  isPlayoffs: boolean;
  /** e.g. "PLAYOFF ROUND 1" or "CHAMPIONSHIP" */
  roundLabel: string;
  /** Current matchup period (weekly number) */
  matchupPeriod: number;
  /** Scoring periods that make up this matchup (e.g. [19, 20]) */
  scoringPeriodRange: number[];
  /** Total playoff teams */
  playoffTeamCount: number;
}

export interface LeagueScoreboard {
  leagueId: string;
  leagueName: string;
  seasonId: number;
  scoringPeriodId: number;
  matchups: Matchup[];
  fetchedAt: string;
  playoff: PlayoffInfo;
}

// ─── API response shapes (raw ESPN) ──────────────────────────────────────────

export interface EspnTeamRaw {
  id: number;
  abbrev: string;
  name: string;
  location: string;
  nickname: string;
  logo?: string;
  owners?: string[];
  playoffSeed?: number;
  record?: {
    overall: { wins: number; losses: number; ties: number };
  };
  roster?: { entries: EspnRosterEntry[] };
}

export interface EspnRosterEntry {
  lineupSlotId: number;
  playerPoolEntry: {
    appliedStatTotal: number;
    id: number;
    player: {
      fullName: string;
      defaultPositionId: number;
      proTeamId: number;
      stats?: Array<{
        statSplitTypeId: number;
        statSourceId: number;
        scoringPeriodId?: number;
        stats?: Record<string, number>;
      }>;
    };
    stats?: EspnStatEntry[];
  };
}

export interface EspnStatEntry {
  scoringPeriodId: number;
  seasonId: number;
  statSourceId: number;
  statSplitTypeId: number;
  appliedTotal: number;
  stats?: Record<string, number>;
}

export interface EspnMatchupRaw {
  id: number;
  home: {
    teamId: number;
    totalPoints: number;
    totalPointsLive?: number;
    rosterForCurrentScoringPeriod?: { entries: EspnRosterEntry[] };
    rosterForMatchupPeriod?: { entries: EspnRosterEntry[] };
  };
  away: {
    teamId: number;
    totalPoints: number;
    totalPointsLive?: number;
    rosterForCurrentScoringPeriod?: { entries: EspnRosterEntry[] };
    rosterForMatchupPeriod?: { entries: EspnRosterEntry[] };
  };
  matchupPeriodId: number;
  playoffTierType?: string;
  winner: 'HOME' | 'AWAY' | 'UNDECIDED';
}

export interface EspnLeagueResponse {
  id: number;
  settings: {
    name: string;
    scheduleSettings: {
      matchupPeriodCount: number;
      matchupPeriods: Record<string, number[]>;
      playoffMatchupPeriodLength: number;
      playoffTeamCount: number;
    };
    rosterSettings: {
      lineupSlotStatLimits?: Record<string, { limitValue: number; statId: number }>;
    };
    scoringSettings?: {
      scoringItems: Array<{
        statId: number;
        pointsOverrides?: Record<string, number>;
        points: number;
      }>;
    };
  };
  scoringPeriodId: number;
  seasonId: number;
  status: { currentMatchupPeriod: number };
  teams: EspnTeamRaw[];
  schedule: EspnMatchupRaw[];
  members?: Array<{ id: string; displayName: string; firstName: string; lastName: string }>;
}

// ─── Scoring Settings ───────────────────────────────────────────────────────

export interface ScoringItem {
  statId: number;
  pointsOverrides?: Record<string, number>;
  points: number;
}

export interface ScoringSettings {
  scoringItems: ScoringItem[];
}

// ─── Matchup Detail types ───────────────────────────────────────────────────

export interface PlayerGameStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  threepm: number;
  to: number;
  pf: number;
  min: number;
  gp: number;
}

export interface RollingAverages {
  last7: number;
  last15: number;
  last30: number;
}

export interface MatchupPlayer {
  playerId: number;
  name: string;
  position: string;
  nbaTeamAbbrev: string;
  lineupSlotId: number;
  isStarter: boolean;
  fpts: number;
  stats: PlayerGameStats;
  averages: RollingAverages;
  /** Player's headshot URL */
  imageUrl: string | null;
}

export interface MatchupDetailTeam {
  id: number;
  name: string;
  abbreviation: string;
  ownerName: string;
  logoUrl: string | null;
  currentScore: number;
  avgPointsPerGame: number;
  gamesPlayed: number;
  maxGames: number;
  playoffSeed: number | null;
  players: MatchupPlayer[];
}

export interface MatchupDetail {
  matchupId: number;
  home: MatchupDetailTeam;
  away: MatchupDetailTeam;
  scoringPeriodId: number;
  matchupPeriodId: number;
  isCompleted: boolean;
  scoringSettings: ScoringSettings;
}

// ─── Player Snapshot types (for trends) ─────────────────────────────────────

export interface PlayerSnapshot {
  id?: string;
  league_id: string;
  season_id: number;
  scoring_period_id: number;
  player_id: number;
  team_id: number;
  player_name: string;
  fpts: number;
  stats: PlayerGameStats;
  rolling_avg_7: number;
  rolling_avg_15: number;
  rolling_avg_30: number;
  captured_at: string;
}

export interface PlayerTrend {
  playerId: number;
  playerName: string;
  dataPoints: Array<{
    scoringPeriodId: number;
    fpts: number;
    rollingAvg7: number;
    rollingAvg15: number;
    rollingAvg30: number;
    capturedAt: string;
  }>;
}

export interface TeamTrend {
  teamId: number;
  teamName: string;
  dataPoints: Array<{
    scoringPeriodId: number;
    totalScore: number;
    avgPointsPerGame: number;
    gamesPlayed: number;
    capturedAt: string;
  }>;
}

// ─── Supabase snapshot types ──────────────────────────────────────────────────

export interface MatchupSnapshot {
  id?: string;
  league_id: string;
  season_id: number;
  scoring_period_id: number;
  matchup_id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  data: LeagueScoreboard;
  captured_at: string;
}
