import type {
  DailyMatchup,
  DailyPlayer,
  DailyTeam,
  EspnLeagueResponse,
  EspnMatchupRaw,
  EspnRosterEntry,
  EspnStatEntry,
  EspnTeamRaw,
  FantasyTeam,
  GameStatus,
  LeagueScoreboard,
  Matchup,
  MatchupDetail,
  MatchupDetailTeam,
  MatchupPlayer,
  NbaGameInfo,
  NbaScoreboardMap,
  NbaScheduleMap,
  PlayerProjectionInput,
  PlayoffInfo,
  PlayoffTierType,
  RollingAverages,
  TeamEfficiency,
} from '../../types/index.js';
import {
  computeFpts,
  computePlayerGameProjection,
  computeProjectedScore,
  computeTeamProjection,
  computeWinProbability,
  estimateLiveGameProjection,
  extractPlayerStats,
  findTopPlayer,
  getNbaTeamAbbrev,
  isActiveSlot,
  POSITION_MAP,
  round1,
} from './calculations.js';

/**
 * Normalize a raw ESPN league API response into our app's LeagueScoreboard shape.
 */
export function normalizeLeagueResponse(
  raw: EspnLeagueResponse,
  overrideMatchupPeriod?: number,
  nbaScoreboard?: NbaScoreboardMap,
  nbaSchedule?: NbaScheduleMap,
): LeagueScoreboard {
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
  const effectiveMatchupPeriod = overrideMatchupPeriod ?? raw.status.currentMatchupPeriod;

  // Calculate max games for the matchup period
  const maxGames = calcMaxGames(raw, effectiveMatchupPeriod);

  // Determine playoff info
  const playoff = buildPlayoffInfo(raw, effectiveMatchupPeriod);

  // Filter schedule to matchups for the effective matchup period (weekly)
  const relevantMatchups = raw.schedule.filter(
    (m) => m.matchupPeriodId === effectiveMatchupPeriod,
  );

  const scoringItems = raw.settings.scoringSettings?.scoringItems ?? [];

  const matchups: Matchup[] = relevantMatchups.map((m) =>
    buildMatchup(m, currentPeriod, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems),
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
function calcMaxGames(raw: EspnLeagueResponse, matchupPeriod?: number): number {
  const { scheduleSettings, rosterSettings } = raw.settings;
  const effectivePeriod = matchupPeriod ?? raw.status.currentMatchupPeriod;
  const matchupScoringPeriods = scheduleSettings.matchupPeriods[String(effectivePeriod)];
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
  nbaScoreboard?: NbaScoreboardMap,
  nbaSchedule?: NbaScheduleMap,
  scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }> = [],
): Matchup {
  const playoffTierType = (m.playoffTierType as PlayoffTierType) ?? 'NONE';

  const home = buildTeam(m.home, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems);
  const away = buildTeam(m.away, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems);

  const winProbability = computeWinProbability(
    home.currentScore, home.gamesPlayed, home.maxGames, home.avgPointsPerGame,
    away.currentScore, away.gamesPlayed, away.maxGames, away.avgPointsPerGame,
    home.projectedScore, away.projectedScore,
  );

  return {
    id: m.id,
    home,
    away,
    scoringPeriodId,
    isCompleted: m.winner !== 'UNDECIDED',
    playoffTierType,
    winProbability,
  };
}

function buildTeam(
  side: EspnMatchupRaw['home'],
  teamById: Map<number, EspnTeamRaw>,
  memberById: Map<string, string>,
  maxGames: number,
  nbaScoreboard?: NbaScoreboardMap,
  nbaSchedule?: NbaScheduleMap,
  scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }> = [],
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

  const avgPointsPerGame = gamesPlayed > 0 ? round1(currentScore / gamesPlayed) : 0;

  // ── Per-player projection engine ──────────────────────────────────────
  // Build rolling average and matchup avg for each player
  const playerMatchupAvgs = new Map<number, number>();
  const playerRollingAvg15 = new Map<number, number>();

  for (const entry of matchupEntries) {
    const playerId = entry.playerPoolEntry.id;
    const playerStats = entry.playerPoolEntry.player.stats ?? [];

    // Matchup period per-game average (splitTypeId 5)
    const matchupStat = playerStats.find(
      (s: { statSplitTypeId: number; statSourceId: number }) =>
        s.statSplitTypeId === 5 && s.statSourceId === 0,
    );
    if (matchupStat?.stats) {
      const playerGp = matchupStat.stats['42'] ?? 0;
      const totalApplied = entry.playerPoolEntry.appliedStatTotal ?? 0;
      if (playerGp > 0) {
        playerMatchupAvgs.set(playerId, round1(totalApplied / playerGp));
      }
    }

  }

  // Compute L15 rolling averages from team roster entries (has raw stats for splitTypeId 2).
  // Roster view stats are per-game averages (same as season split type 0),
  // so computeFpts directly gives FPTS/G — no GP division needed.
  if (team?.roster?.entries) {
    for (const entry of team.roster.entries) {
      const playerId = entry.playerPoolEntry.id;
      const playerStats = entry.playerPoolEntry.player.stats ?? [];

      const rolling15Stat = playerStats.find(
        (s) => s.statSplitTypeId === 2 && s.statSourceId === 0,
      );
      if (rolling15Stat?.stats) {
        const fpts15 = computeFpts(rolling15Stat.stats, scoringItems);
        if (fpts15 > 0) {
          playerRollingAvg15.set(playerId, round1(fpts15));
        }
      }
    }
  }

  // Build PlayerProjectionInput for each roster player
  let projectedScore: number;

  if (nbaScoreboard && nbaSchedule) {
    // ── New per-player projection engine ──
    const projectionInputs: PlayerProjectionInput[] = [];

    // Build from current period entries (has today's live data)
    // Cross-reference with matchup entries for averages
    const allEntries = currentEntries.length > 0 ? currentEntries : matchupEntries;

    for (const entry of allEntries) {
      const playerId = entry.playerPoolEntry.id;
      const proTeamId = entry.playerPoolEntry.player.proTeamId;
      const nbaAbbrev = getNbaTeamAbbrev(proTeamId);
      const gameInfo: NbaGameInfo | undefined = nbaScoreboard.get(nbaAbbrev);

      const todayFpts = entry.playerPoolEntry.appliedStatTotal ?? 0;
      const rollingAvg15 = playerRollingAvg15.get(playerId) ?? playerMatchupAvgs.get(playerId) ?? 0;
      const matchupAvgPerGame = playerMatchupAvgs.get(playerId) ?? 0;

      // Determine game status from NBA scoreboard
      let gameStatus: GameStatus | 'none' = 'none';
      let minutesRemaining = 0;
      if (gameInfo) {
        gameStatus = gameInfo.status;
        minutesRemaining = gameInfo.minutesRemaining;
      }

      // Remaining games after today from NBA schedule
      const remainingGamesAfterToday = nbaSchedule.get(proTeamId) ?? 0;

      projectionInputs.push({
        playerId,
        proTeamId,
        isActive: isActiveSlot(entry.lineupSlotId),
        todayFpts,
        rollingAvg15,
        matchupAvgPerGame,
        gameStatus,
        minutesRemaining,
        remainingGamesAfterToday,
      });
    }

    projectedScore = computeTeamProjection(currentScore, gamesPlayed, maxGames, projectionInputs);
  } else {
    // ── Fallback: old pace-based projection ──
    projectedScore = computeProjectedScore(currentScore, gamesPlayed, maxGames);

    // Old heuristic for live game bonus
    const playerRollingAvgs = new Map<number, number>();
    for (const [id, avg] of playerMatchupAvgs) {
      playerRollingAvgs.set(id, avg);
    }
    const liveBonus = estimateLiveGameProjection(currentEntries, playerRollingAvgs);
    if (liveBonus > 0) {
      projectedScore = round1(Math.max(projectedScore, currentScore + liveBonus));
    }
  }

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
 * Roster view stats are per-game averages (same as type 0 season stats),
 * so computeFpts directly gives FPTS/G — no need to divide by GP.
 */
function extractRollingAverages(
  playerStats: EspnStatEntry[],
  scoringItems: Array<{ statId: number; points: number }>,
): RollingAverages {
  const getAvg = (splitTypeId: number): number => {
    const stat = playerStats.find(
      (s) => s.statSplitTypeId === splitTypeId && s.statSourceId === 0,
    );
    if (!stat?.stats) return 0;
    return round1(computeFpts(stat.stats, scoringItems));
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
  const playerRosterStats = new Map<number, EspnStatEntry[]>();
  for (const t of raw.teams) {
    if (t.roster?.entries) {
      for (const entry of t.roster.entries) {
        const pid = entry.playerPoolEntry.id;
        const stats = entry.playerPoolEntry.player.stats ?? [];
        playerRosterStats.set(pid, stats as EspnStatEntry[]);
      }
    }
  }

  function buildDetailTeam(side: EspnMatchupRaw['home']): MatchupDetailTeam {
    const team = teamById.get(side.teamId);
    const currentScore = side.totalPointsLive ?? side.totalPoints;
    const gamesPlayed = countGamesPlayed(side.rosterForMatchupPeriod);
    const avgPointsPerGame = gamesPlayed > 0 ? round1(currentScore / gamesPlayed) : 0;

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

      // Get season stats (splitTypeId 0) for true season FPTS/G
      const playerId = entry.playerPoolEntry.id;
      const rosterStats = playerRosterStats.get(playerId) ?? playerStats;
      const seasonStats = (rosterStats as EspnStatEntry[]).find(
        (s) => s.statSplitTypeId === 0 && s.statSourceId === 0,
      );
      let seasonFptsPerGame = 0;
      if (seasonStats?.stats) {
        // Roster view stats (split type 0) are per-game averages, same as
        // rolling averages (types 1/2/3). computeFpts directly gives FPTS/G.
        seasonFptsPerGame = round1(computeFpts(seasonStats.stats, scoringItems));
      }

      // Get rolling averages from team roster stats (has split types 1/2/3)
      const averages = extractRollingAverages(
        rosterStats as EspnStatEntry[],
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
        seasonFptsPerGame,
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

    // ── Matchup-period efficiency ───────────────────────────────────
    // For each player, get their total FPTS from raw stats (all games played,
    // regardless of lineup slot). Then build a pool of per-game averages and
    // pick the top maxGames entries as the "optimal lineup" total.
    const gameEntries: number[] = [];
    for (const entry of rosterEntries) {
      const playerStats = entry.playerPoolEntry.player.stats ?? [];
      const matchupStat = playerStats.find(
        (s: { statSplitTypeId: number; statSourceId: number; stats?: Record<string, number> }) =>
          s.statSplitTypeId === 5 && s.statSourceId === 0,
      );
      if (!matchupStat?.stats) continue;

      // Compute total FPTS from raw stats using scoring settings
      const totalFpts = computeFpts(matchupStat.stats, scoringItems);
      const playerGp = matchupStat.stats['42'] ?? 0;
      if (playerGp <= 0 || totalFpts <= 0) continue;

      // Create individual "game entries" at the per-game average
      const avgPerGame = totalFpts / playerGp;
      for (let g = 0; g < playerGp; g++) {
        gameEntries.push(avgPerGame);
      }
    }

    // Sort descending and take top maxGames
    gameEntries.sort((a, b) => b - a);
    const optimalEntries = gameEntries.slice(0, maxGames);
    const maxPossibleScore = round1(optimalEntries.reduce((sum, v) => sum + v, 0));
    const efficiencyPct = maxPossibleScore > 0
      ? round1((currentScore / maxPossibleScore) * 100)
      : 100;

    const efficiency: TeamEfficiency = {
      actualScore: currentScore,
      maxPossibleScore,
      efficiencyPct,
      missedPoints: round1(Math.max(0, maxPossibleScore - currentScore)),
    };

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
      efficiency,
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

// ─── Daily View ─────────────────────────────────────────────────────────────

const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 11: 'UTL',
  12: 'BE', 13: 'IR', 20: 'BE', 21: 'IR', 23: 'IR+',
};

/**
 * Count the number of active (non-bench/IR) roster slots for a team.
 */
function countActiveSlots(entries: EspnRosterEntry[]): number {
  return entries.filter((e) => isActiveSlot(e.lineupSlotId)).length;
}

/**
 * Calculate team efficiency: actual points vs max possible if optimal lineup was set.
 */
function calculateEfficiency(players: DailyPlayer[], activeSlotCount: number): TeamEfficiency {
  // Sort all players by todayFpts descending to find optimal lineup
  const sortedByFpts = [...players].sort((a, b) => b.todayFpts - a.todayFpts);
  const optimalPlayers = sortedByFpts.slice(0, activeSlotCount);
  const maxPossibleScore = round1(optimalPlayers.reduce((sum, p) => sum + p.todayFpts, 0));

  // Actual score = sum of started players' todayFpts
  const actualScore = round1(players.filter((p) => p.isStarted).reduce((sum, p) => sum + p.todayFpts, 0));

  const efficiencyPct = maxPossibleScore > 0
    ? round1((actualScore / maxPossibleScore) * 100)
    : 100;

  return {
    actualScore,
    maxPossibleScore,
    efficiencyPct,
    missedPoints: round1(maxPossibleScore - actualScore),
  };
}

/**
 * Normalize raw ESPN data into a DailyMatchup for today's scoring period.
 */
export function normalizeDailyView(
  raw: EspnLeagueResponse,
  matchupId: number,
): DailyMatchup | null {
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

  function buildDailyTeam(side: EspnMatchupRaw['home']): DailyTeam {
    const team = teamById.get(side.teamId);
    const totalScore = side.totalPointsLive ?? side.totalPoints;

    // Use current scoring period roster for today's data
    const currentEntries: EspnRosterEntry[] =
      side.rosterForCurrentScoringPeriod?.entries ?? [];

    const activeSlotCount = countActiveSlots(currentEntries);

    const players: DailyPlayer[] = currentEntries.map((entry) => {
      const player = entry.playerPoolEntry.player;
      const playerId = entry.playerPoolEntry.id;
      const todayFpts = entry.playerPoolEntry.appliedStatTotal ?? 0;

      // Get today's stats from current scoring period (statSplitTypeId 0, statSourceId 0)
      const playerStats = player.stats ?? [];
      const todayStat = playerStats.find(
        (s) => s.statSplitTypeId === 0 && s.statSourceId === 0,
      );
      const rawStats = todayStat?.stats ?? {};

      // Get matchup period total fpts from matchup roster if available
      const matchupEntries = side.rosterForMatchupPeriod?.entries ?? [];
      const matchupEntry = matchupEntries.find((e) => e.playerPoolEntry.id === playerId);
      const matchupFpts = matchupEntry?.playerPoolEntry.appliedStatTotal ?? todayFpts;

      return {
        playerId,
        name: player.fullName,
        position: POSITION_MAP[player.defaultPositionId] ?? 'Unknown',
        nbaTeamAbbrev: getNbaTeamAbbrev(player.proTeamId),
        imageUrl: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=96&h=70&cb=1`,
        lineupSlotId: entry.lineupSlotId,
        isStarted: isActiveSlot(entry.lineupSlotId),
        todayFpts,
        matchupFpts,
        todayStats: {
          pts: rawStats['0'] ?? 0,
          reb: rawStats['6'] ?? 0,
          ast: rawStats['3'] ?? 0,
          stl: rawStats['2'] ?? 0,
          blk: rawStats['1'] ?? 0,
          min: rawStats['40'] ?? 0,
        },
      };
    });

    // Sort: starters first by lineup slot, then bench
    players.sort((a, b) => {
      if (a.isStarted && !b.isStarted) return -1;
      if (!a.isStarted && b.isStarted) return 1;
      return a.lineupSlotId - b.lineupSlotId;
    });

    const todayScore = round1(
      players.filter((p) => p.isStarted).reduce((sum, p) => sum + p.todayFpts, 0),
    );

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
      totalScore,
      todayScore,
      players,
      efficiency: calculateEfficiency(players, activeSlotCount),
    };
  }

  // Build today's date string
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  return {
    matchupId: matchup.id,
    scoringPeriodId: raw.scoringPeriodId,
    date: dateStr,
    home: buildDailyTeam(matchup.home),
    away: buildDailyTeam(matchup.away),
  };
}
