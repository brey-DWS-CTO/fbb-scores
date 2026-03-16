// ─── League Info (for week selector) ────────────────────────────────────────

export interface LeagueInfo {
  regularSeasonWeeks: number;
  playoffTeamCount: number;
  currentMatchupPeriod: number;
  totalMatchupPeriods: number;
  matchupPeriods: Record<string, number[]>;
}

// ─── Core domain types shared across the entire app ───────────────────────────

export interface TopPlayer {
  name: string;
  position: string;
  points: number;
  nbaTeamAbbrev: string;
  playerId: number;
}

export interface PlayerProjectionBreakdown {
  playerId: number;
  name: string;
  position: string;
  nbaTeamAbbrev: string;
  /** Whether the player is in an active (starter) lineup slot */
  isStarter: boolean;
  /** L15 rolling average FPTS per game */
  rollingAvg15: number;
  /** Number of remaining games in the matchup period for this player's NBA team */
  remainingGames: number;
  /** Total projected FPTS contribution from this player */
  projectedFpts: number;
  /** Whether this bench player was "smart filled" into the projection */
  isSmartFilled: boolean;
  /** Player headshot URL */
  imageUrl: string | null;
  /** ESPN injury designation: "OUT", "DAY_TO_DAY", "SUSPENSION", etc. */
  injuryStatus?: string;
}

export interface ProjectionBreakdown {
  /** Per-player projection details, sorted by projected contribution descending */
  players: PlayerProjectionBreakdown[];
  /** Total projected score */
  projectedTotal: number;
  /** Total game slots filled by the projection */
  gameSlotsFilled: number;
  /** Max games allowed */
  maxGames: number;
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
  /** Detailed per-player projection breakdown (populated when NBA schedule available) */
  projectionBreakdown: ProjectionBreakdown | null;
}

export type PlayoffTierType =
  | 'WINNERS_BRACKET'
  | 'LOSERS_CONSOLATION_LADDER'
  | 'NONE';

export interface WinProbability {
  homeWinPct: number;
  awayWinPct: number;
}

export interface Matchup {
  /** ESPN matchup ID */
  id: number;
  home: FantasyTeam;
  away: FantasyTeam;
  scoringPeriodId: number;
  isCompleted: boolean;
  /** Playoff tier for this matchup */
  playoffTierType: PlayoffTierType;
  /** Win probability for each team */
  winProbability: WinProbability;
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
      /** ESPN injury designation: "ACTIVE", "OUT", "DAY_TO_DAY", "SUSPENSION", etc. */
      injuryStatus?: string;
      injured?: boolean;
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
  /** Matchup period total FPTS */
  fpts: number;
  stats: PlayerGameStats;
  averages: RollingAverages;
  /** Season FPTS per game average (from season stats split type 0) */
  seasonFptsPerGame: number;
  /** Player's headshot URL */
  imageUrl: string | null;
  /** ESPN injury designation: "OUT", "DAY_TO_DAY", "SUSPENSION", etc. */
  injuryStatus?: string;
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
  /** Lineup efficiency: actual score vs optimal lineup across the matchup period */
  efficiency: TeamEfficiency;
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

// ─── Daily View types ───────────────────────────────────────────────────────

export type GameStatus = 'live' | 'final' | 'upcoming' | 'unknown';

export interface NbaGameInfo {
  status: GameStatus;
  /** e.g. "3:06 - 3rd" or "Final" or "7:00 PM" */
  statusDetail: string;
  /** e.g. "SAC 89 - UTAH 85" */
  scoreDisplay: string;
  /** Opponent team abbreviation */
  opponent: string;
  /** Whether the player's team is the home team */
  isHome: boolean;
  /** Current period (1-4 regulation, 5+ OT) */
  period: number;
  /** Minutes remaining in the game (including OT if applicable) */
  minutesRemaining: number;
}

// ─── Projection types ──────────────────────────────────────────────────────

export interface PlayerProjectionInput {
  playerId: number;
  proTeamId: number;
  isActive: boolean;
  todayFpts: number;
  rollingAvg15: number;
  matchupAvgPerGame: number;
  gameStatus: GameStatus | 'none';
  minutesRemaining: number;
  remainingGamesAfterToday: number;
  /** Future hook: augment projection accuracy with pace/game-total data */
  overrideProjection?: number;
  /** Whether the player is on IR/IL (should not be smart-filled) */
  isOnIR?: boolean;
  /** ESPN injury designation: "OUT", "DAY_TO_DAY", "SUSPENSION", etc. */
  injuryStatus?: string;
}

/** NBA team schedule: proTeamId → number of remaining games in the matchup period */
export type NbaScheduleMap = Map<number, number>;

/** NBA scoreboard: nbaTeamAbbrev → NbaGameInfo */
export type NbaScoreboardMap = Map<string, NbaGameInfo>;

export interface DailyPlayer {
  playerId: number;
  name: string;
  position: string;
  nbaTeamAbbrev: string;
  imageUrl: string | null;
  lineupSlotId: number;
  isStarted: boolean;
  todayFpts: number;
  matchupFpts: number;
  todayStats: {
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    min: number;
  };
  /** Live NBA game info (populated from ESPN public scoreboard API) */
  gameInfo?: NbaGameInfo;
  /** ESPN injury designation: "OUT", "DAY_TO_DAY", "SUSPENSION", etc. */
  injuryStatus?: string;
}

export interface TeamEfficiency {
  actualScore: number;
  maxPossibleScore: number;
  efficiencyPct: number;
  missedPoints: number;
}

export interface DailyTeam {
  id: number;
  name: string;
  abbreviation: string;
  ownerName: string;
  logoUrl: string | null;
  totalScore: number;
  todayScore: number;
  players: DailyPlayer[];
  efficiency: TeamEfficiency;
}

export interface DailyMatchup {
  matchupId: number;
  scoringPeriodId: number;
  date: string;
  home: DailyTeam;
  away: DailyTeam;
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
