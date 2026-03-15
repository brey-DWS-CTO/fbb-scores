import type {
  EspnLeagueResponse,
  EspnMatchupRaw,
  EspnRosterEntry,
  EspnTeamRaw,
  FantasyTeam,
  LeagueScoreboard,
  Matchup,
  MatchupDetail,
  MatchupDetailTeam,
  MatchupPlayer,
  PlayoffInfo,
  PlayoffTierType,
  RollingAverages,
} from '../../types/index.js';
import {
  computeFpts,
  extractPlayerStats,
  findTopPlayer,
  getNbaTeamAbbrev,
  isActiveSlot,
  POSITION_MAP,
} from './calculations.js';

/**
 * Normalize a raw ESPN league API response into our app's LeagueScoreboard shape.
 */
export function normalizeLeagueResponse(raw: EspnLeagueResponse): LeagueScoreboard {
  // Build lookup maps
  const teamById = new Map<number, EspnTeamRaw>();
  for (const t of raw.teams) {
    teamById.set(t.id, t);
  }

  const memberById = new Map<string, string>();
  if (raw.members) {
    for (const m of raw.members) {
      memberById.set(m.id, `${m.firstName} ${m.lastName}`);
    }
  }

  const currentPeriod = raw.scoringPeriodId;
  const currentMatchupPeriod = raw.status.currentMatchupPeriod;

  // Calculate max games for the matchup period
  const maxGames = calcMaxGames(raw);

  // Determine playoff info
  const playoff = buildPlayoffInfo(raw, currentMatchupPeriod);

  // Filter schedule to matchups for the current matchup period (weekly)
  const relevantMatchups = raw.schedule.filter(
    (m) => m.matchupPeriodId === currentMatchupPeriod,
  );

  const matchups: Matchup[] = relevantMatchups.map((m) =>
    buildMatchup(m, currentPeriod, teamById, memberById, maxGames),
  );

  return {
    leagueId: String(raw.id),
    leagueName: raw.settings.name,
    seasonId: raw.seasonId,
    scoringPeriodId: currentPeriod,
    matchups,
    fetchedAt: new Date().toISOString(),
    playoff,
  };
}

/**
 * Calculate max games allowed for the current matchup period.
 * Uses the league's lineupSlotStatLimits (games per day limit × days in matchup period).
 */
function calcMaxGames(raw: EspnLeagueResponse): number {
  const { scheduleSettings, rosterSettings } = raw.settings;
  const currentMatchupPeriod = raw.status.currentMatchupPeriod;
  const matchupScoringPeriods = scheduleSettings.matchupPeriods[String(currentMatchupPeriod)];
  const weeksInMatchup = matchupScoringPeriods ? matchupScoringPeriods.length : 1;

  // lineupSlotStatLimits.15 has the games-per-day limit (statId 42 = GP)
  const gpLimit = rosterSettings.lineupSlotStatLimits?.['15'];
  if (gpLimit && gpLimit.statId === 42) {
    // limitValue is per day (e.g. 4.2857 = 30/7), multiply by 7 to get per week, then by weeks
    return Math.round(gpLimit.limitValue * 7 * weeksInMatchup);
  }

  // Fallback: 30 games per week
  return 30 * weeksInMatchup;
}

/**
 * Build playoff info from league settings and current matchup period.
 */
function buildPlayoffInfo(raw: EspnLeagueResponse, currentMatchupPeriod: number): PlayoffInfo {
  const { scheduleSettings } = raw.settings;
  const regularSeasonMatchups = scheduleSettings.matchupPeriodCount;
  const isPlayoffs = currentMatchupPeriod > regularSeasonMatchups;
  const playoffTeamCount = scheduleSettings.playoffTeamCount;
  const scoringPeriodRange = scheduleSettings.matchupPeriods[String(currentMatchupPeriod)] ?? [];

  let roundLabel = `WEEK ${currentMatchupPeriod}`;
  if (isPlayoffs) {
    const playoffRound = currentMatchupPeriod - regularSeasonMatchups;
    const totalPlayoffRounds = Math.ceil(Math.log2(playoffTeamCount));
    if (playoffRound >= totalPlayoffRounds) {
      roundLabel = 'CHAMPIONSHIP';
    } else {
      roundLabel = `PLAYOFF ROUND ${playoffRound}`;
    }
  }

  return {
    isPlayoffs,
    roundLabel,
    matchupPeriod: currentMatchupPeriod,
    scoringPeriodRange,
    playoffTeamCount,
  };
}

/**
 * Count games played from rosterForMatchupPeriod entries.
 * Uses stat ID 42 (GP) from player stats with splitTypeId 5 (matchup period stats).
 */
function countGamesPlayed(roster?: { entries: EspnRosterEntry[] }): number {
  if (!roster) return 0;
  let gp = 0;
  for (const entry of roster.entries) {
    const playerStats = entry.playerPoolEntry.player.stats;
    if (playerStats) {
      for (const stat of playerStats) {
        if (stat.statSplitTypeId === 5 && stat.statSourceId === 0 && stat.stats) {
          gp += (stat.stats['42'] || 0);
        }
      }
    }
  }
  return gp;
}

function buildMatchup(
  m: EspnMatchupRaw,
  scoringPeriodId: number,
  teamById: Map<number, EspnTeamRaw>,
  memberById: Map<string, string>,
  maxGames: number,
): Matchup {
  const playoffTierType = (m.playoffTierType as PlayoffTierType) ?? 'NONE';

  return {
    id: m.id,
    home: buildTeam(m.home, teamById, memberById, maxGames),
    away: buildTeam(m.away, teamById, memberById, maxGames),
    scoringPeriodId,
    isCompleted: m.winner !== 'UNDECIDED',
    playoffTierType,
  };
}

function buildTeam(
  side: EspnMatchupRaw['home'],
  teamById: Map<number, EspnTeamRaw>,
  memberById: Map<string, string>,
  maxGames: number,
): FantasyTeam {
  const team = teamById.get(side.teamId);
  // Use matchup period roster for top player (has full matchup stats),
  // fall back to current scoring period roster
  const matchupEntries: EspnRosterEntry[] =
    side.rosterForMatchupPeriod?.entries ?? [];
  const currentEntries: EspnRosterEntry[] =
    side.rosterForCurrentScoringPeriod?.entries ?? [];
  const rosterEntries = matchupEntries.length > 0 ? matchupEntries : currentEntries;
  const rosterCount = rosterEntries.filter((e) => isActiveSlot(e.lineupSlotId)).length;
  // Use totalPointsLive for real-time scores (includes in-progress games)
  const currentScore = side.totalPointsLive ?? side.totalPoints;

  // Count games played from matchup period roster
  const gamesPlayed = countGamesPlayed(side.rosterForMatchupPeriod);

  // Average = total score / games played
  const avgPointsPerGame = gamesPlayed > 0 ? Math.round((currentScore / gamesPlayed) * 10) / 10 : 0;

  // Projection: extrapolate to max games
  const projectedScore = gamesPlayed > 0
    ? Math.round((currentScore / gamesPlayed) * maxGames * 10) / 10
    : 0;

  // Resolve owner name from members list
  let ownerName = 'Unknown Owner';
  if (team?.owners?.[0]) {
    ownerName = memberById.get(team.owners[0]) ?? 'Unknown Owner';
  }

  return {
    id: side.teamId,
    name: team?.name ?? `Team ${side.teamId}`,
    abbreviation: team?.abbrev ?? '???',
    ownerName,
    logoUrl: team?.logo ?? null,
    currentScore,
    avgPointsPerGame,
    gamesPlayed,
    maxGames,
    projectedScore,
    rosterCount,
    playoffSeed: team?.playoffSeed ?? null,
    topPlayer: findTopPlayer(rosterEntries),
  };
}

// ─── Matchup Detail ─────────────────────────────────────────────────────────

/**
 * Extract rolling averages from ESPN's pre-computed split types.
 * Split type 1 = last 7 days, 2 = last 15 days, 3 = last 30 days.
 * These are total FPTS for the window — divide by GP to get per-game average.
 */
function extractRollingAverages(
  playerStats: Array<{ statSplitTypeId: number; statSourceId: number; stats?: Record<string, number>; appliedTotal?: number }>,
  scoringItems: Array<{ statId: number; points: number }>,
): RollingAverages {
  const getAvg = (splitTypeId: number): number => {
    const stat = playerStats.find(
      (s) => s.statSplitTypeId === splitTypeId && s.statSourceId === 0,
    );
    if (!stat?.stats) return 0;
    const gp = stat.stats['42'] ?? 0;
    if (gp === 0) return 0;
    const totalFpts = computeFpts(stat.stats, scoringItems);
    return Math.round((totalFpts / gp) * 10) / 10;
  };

  return {
    last7: getAvg(1),
    last15: getAvg(2),
    last30: getAvg(3),
  };
}

/**
 * Normalize a raw ESPN league API response into a MatchupDetail for a specific matchup.
 * Uses team roster data (from mRoster view) for rolling averages since those contain
 * ESPN's pre-computed split types (1=7day, 2=15day, 3=30day).
 */
export function normalizeMatchupDetail(
  raw: EspnLeagueResponse,
  matchupId: number,
): MatchupDetail | null {
  const currentMatchupPeriod = raw.status.currentMatchupPeriod;
  const matchup = raw.schedule.find(
    (m) => m.id === matchupId && m.matchupPeriodId === currentMatchupPeriod,
  );
  if (!matchup) return null;

  const teamById = new Map<number, EspnTeamRaw>();
  for (const t of raw.teams) teamById.set(t.id, t);

  const memberById = new Map<string, string>();
  if (raw.members) {
    for (const m of raw.members) memberById.set(m.id, `${m.firstName} ${m.lastName}`);
  }

  const maxGames = calcMaxGames(raw);
  const scoringItems = raw.settings.scoringSettings?.scoringItems ?? [];

  // Build a lookup of player stats from team rosters (mRoster view).
  // Team roster entries have ESPN's pre-computed split types 1/2/3 for rolling averages.
  const playerRosterStats = new Map<number, Array<{ statSplitTypeId: number; statSourceId: number; stats?: Record<string, number>; appliedTotal?: number }>>();
  for (const t of raw.teams) {
    if (t.roster?.entries) {
      for (const entry of t.roster.entries) {
        const pid = entry.playerPoolEntry.id;
        const stats = entry.playerPoolEntry.player.stats ?? [];
        playerRosterStats.set(pid, stats as Array<{ statSplitTypeId: number; statSourceId: number; stats?: Record<string, number>; appliedTotal?: number }>);
      }
    }
  }

  function buildDetailTeam(side: EspnMatchupRaw['home']): MatchupDetailTeam {
    const team = teamById.get(side.teamId);
    const currentScore = side.totalPointsLive ?? side.totalPoints;
    const gamesPlayed = countGamesPlayed(side.rosterForMatchupPeriod);
    const avgPointsPerGame =
      gamesPlayed > 0 ? Math.round((currentScore / gamesPlayed) * 10) / 10 : 0;

    // Build player list from matchup period roster
    const rosterEntries =
      side.rosterForMatchupPeriod?.entries ??
      side.rosterForCurrentScoringPeriod?.entries ??
      [];

    const players: MatchupPlayer[] = rosterEntries.map((entry) => {
      const player = entry.playerPoolEntry.player;
      const playerStats = player.stats ?? [];

      // Get matchup period stats (splitTypeId 5)
      const matchupStats = playerStats.find(
        (s) => s.statSplitTypeId === 5 && s.statSourceId === 0,
      );
      const rawStats = matchupStats?.stats ?? {};

      // Get rolling averages from team roster stats (has split types 1/2/3)
      const playerId = entry.playerPoolEntry.id;
      const rosterStats = playerRosterStats.get(playerId) ?? playerStats;
      const averages = extractRollingAverages(
        rosterStats as Array<{ statSplitTypeId: number; statSourceId: number; stats?: Record<string, number>; appliedTotal?: number }>,
        scoringItems,
      );

      return {
        playerId,
        name: player.fullName,
        position: POSITION_MAP[player.defaultPositionId] ?? 'Unknown',
        nbaTeamAbbrev: getNbaTeamAbbrev(player.proTeamId),
        lineupSlotId: entry.lineupSlotId,
        isStarter: isActiveSlot(entry.lineupSlotId),
        fpts: entry.playerPoolEntry.appliedStatTotal,
        stats: extractPlayerStats(rawStats),
        averages,
        imageUrl: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=96&h=70&cb=1`,
      };
    });

    // Sort: starters first (by lineup slot), then bench
    players.sort((a, b) => {
      if (a.isStarter && !b.isStarter) return -1;
      if (!a.isStarter && b.isStarter) return 1;
      return a.lineupSlotId - b.lineupSlotId;
    });

    let ownerName = 'Unknown Owner';
    if (team?.owners?.[0]) {
      ownerName = memberById.get(team.owners[0]) ?? 'Unknown Owner';
    }

    return {
      id: side.teamId,
      name: team?.name ?? `Team ${side.teamId}`,
      abbreviation: team?.abbrev ?? '???',
      ownerName,
      logoUrl: team?.logo ?? null,
      currentScore,
      avgPointsPerGame,
      gamesPlayed,
      maxGames,
      playoffSeed: team?.playoffSeed ?? null,
      players,
    };
  }

  return {
    matchupId: matchup.id,
    home: buildDetailTeam(matchup.home),
    away: buildDetailTeam(matchup.away),
    scoringPeriodId: raw.scoringPeriodId,
    matchupPeriodId: currentMatchupPeriod,
    isCompleted: matchup.winner !== 'UNDECIDED',
    scoringSettings: { scoringItems },
  };
}
