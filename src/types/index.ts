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
    playerPoolEntryId: number;
    player: {
      fullName: string;
      defaultPositionId: number;
      proTeamId: number;
      stats?: Array<{
        statSplitTypeId: number;
        statSourceId: number;
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
}

export interface EspnMatchupRaw {
  id: number;
  home: {
    teamId: number;
    totalPoints: number;
    rosterForCurrentScoringPeriod?: { entries: EspnRosterEntry[] };
    rosterForMatchupPeriod?: { entries: EspnRosterEntry[] };
  };
  away: {
    teamId: number;
    totalPoints: number;
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
  };
  scoringPeriodId: number;
  seasonId: number;
  status: { currentMatchupPeriod: number };
  teams: EspnTeamRaw[];
  schedule: EspnMatchupRaw[];
  members?: Array<{ id: string; displayName: string; firstName: string; lastName: string }>;
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
