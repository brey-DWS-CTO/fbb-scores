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
  ProjectionBreakdown,
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

  // Detect if we're viewing a future matchup period (all scoring periods are ahead of today)
  const matchupScoringPeriods = raw.settings.scheduleSettings.matchupPeriods[String(effectiveMatchupPeriod)] ?? [];
  const isFutureMatchup = matchupScoringPeriods.length > 0 && matchupScoringPeriods[0] > currentPeriod;

  const matchups: Matchup[] = relevantMatchups.map((m) =>
    buildMatchup(m, currentPeriod, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems, isFutureMatchup),
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
 *
 * Only counts GP for active (started) players to match ESPN's scoring model.
 */
function countGamesPlayed(roster?: { entries: EspnRosterEntry[] }): number {
  if (!roster) return 0;
  let gp = 0;
  for (const entry of roster.entries) {
    // Only count GP for active lineup slots (not bench/IR)
    if (!isActiveSlot(entry.lineupSlotId)) continue;
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

/**
 * Estimate GP for completed matchups when stat split type 5 data is unavailable.
 *
 * Strategy: Try to find individual player GP from ANY stat split type.
 * For past matchups, rosterForMatchupPeriod entries may still contain
 * season stats (type 0) with total GP, but not matchup-specific GP.
 * As a last resort, count active players with non-zero appliedStatTotal.
 */
function estimateGamesPlayed(roster?: { entries: EspnRosterEntry[] }): number {
  if (!roster) return 0;

  // First pass: try to sum GP (stat 42) from matchup stats (type 5)
  let gp = 0;
  for (const entry of roster.entries) {
    if (!isActiveSlot(entry.lineupSlotId)) continue;
    const playerStats = entry.playerPoolEntry.player.stats;
    if (!playerStats) continue;
    for (const stat of playerStats) {
      if (stat.statSplitTypeId === 5 && stat.statSourceId === 0 && stat.stats) {
        gp += (stat.stats['42'] || 0);
      }
    }
  }
  if (gp > 0) return gp;

  // Second pass: count active players with points as a minimum floor.
  // Each such player played at least 1 game, and in a typical 7-day matchup
  // an NBA player plays ~3-4 games. Use playerCount × 4 as a rough estimate.
  let playerCount = 0;
  for (const entry of roster.entries) {
    if (!isActiveSlot(entry.lineupSlotId)) continue;
    const applied = entry.playerPoolEntry.appliedStatTotal ?? 0;
    if (applied > 0) playerCount++;
  }
  // Rough estimate: ~4 games per active player in a typical week
  return playerCount > 0 ? playerCount * 4 : 0;
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
  isFutureMatchup = false,
): Matchup {
  const playoffTierType = (m.playoffTierType as PlayoffTierType) ?? 'NONE';

  const home = buildTeam(m.home, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems, isFutureMatchup);
  const away = buildTeam(m.away, teamById, memberById, maxGames, nbaScoreboard, nbaSchedule, scoringItems, isFutureMatchup);

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

// ─── Player Average Extraction Helpers ─────────────────────────────────────

type ScoringItemsList = Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }>;

/** Extract per-game matchup averages (splitTypeId 5) from matchup roster entries. */
function extractMatchupAvgs(matchupEntries: EspnRosterEntry[]): Map<number, number> {
  const avgs = new Map<number, number>();
  for (const entry of matchupEntries) {
    const playerId = entry.playerPoolEntry.id;
    const playerStats = entry.playerPoolEntry.player.stats ?? [];
    const matchupStat = playerStats.find(
      (s: { statSplitTypeId: number; statSourceId: number }) =>
        s.statSplitTypeId === 5 && s.statSourceId === 0,
    );
    if (matchupStat?.stats) {
      const playerGp = matchupStat.stats['42'] ?? 0;
      const totalApplied = entry.playerPoolEntry.appliedStatTotal ?? 0;
      if (playerGp > 0) {
        avgs.set(playerId, round1(totalApplied / playerGp));
      }
    }
  }
  return avgs;
}

/**
 * Extract L15 rolling averages and season FPTS/G from team roster entries.
 *
 * IMPORTANT: Rolling split types (1/2/3) from the mRoster view return TOTALS
 * over the time window — NOT per-game averages. We must divide by GP (stat 42).
 * Season split type (0) from mRoster IS a per-game average — no GP division needed.
 */
function extractRosterAvgs(
  rosterEntries: EspnRosterEntry[] | undefined,
  scoringItems: ScoringItemsList,
): { rolling15: Map<number, number>; season: Map<number, number> } {
  const rolling15 = new Map<number, number>();
  const season = new Map<number, number>();
  if (!rosterEntries) return { rolling15, season };

  for (const entry of rosterEntries) {
    const playerId = entry.playerPoolEntry.id;
    const playerStats = entry.playerPoolEntry.player.stats ?? [];

    // L15 rolling stats are TOTALS — divide by GP to get per-game average
    const rolling15Stat = playerStats.find(
      (s) => s.statSplitTypeId === 2 && s.statSourceId === 0,
    );
    if (rolling15Stat?.stats) {
      const fpts = computeFpts(rolling15Stat.stats, scoringItems);
      const gp = rolling15Stat.stats['42'] ?? 0;
      if (fpts > 0 && gp > 0) {
        rolling15.set(playerId, round1(fpts / gp));
      }
    }

    // Season stats (split type 0) from mRoster are TOTALS — divide by GP like rolling types
    const seasonStat = playerStats.find(
      (s) => s.statSplitTypeId === 0 && s.statSourceId === 0,
    );
    if (seasonStat?.stats) {
      const fpts = computeFpts(seasonStat.stats, scoringItems);
      const gp = seasonStat.stats['42'] ?? 0;
      if (fpts > 0 && gp > 0) {
        season.set(playerId, round1(fpts / gp));
      }
    }
  }
  return { rolling15, season };
}

/** IR slot IDs for excluding from smart-fill. */
const IR_SLOTS = new Set([13, 21, 23]);

/** Build projection inputs and player name map from roster entries. */
function buildProjectionInputs(
  entries: EspnRosterEntry[],
  playerRollingAvg15: Map<number, number>,
  playerMatchupAvgs: Map<number, number>,
  playerSeasonAvg: Map<number, number>,
  nbaScoreboard: NbaScoreboardMap,
  nbaSchedule: NbaScheduleMap,
  isFutureMatchup: boolean,
): { inputs: PlayerProjectionInput[]; names: Map<number, { name: string; position: string; nbaTeamAbbrev: string }> } {
  const inputs: PlayerProjectionInput[] = [];
  const names = new Map<number, { name: string; position: string; nbaTeamAbbrev: string }>();

  for (const entry of entries) {
    const playerId = entry.playerPoolEntry.id;
    const p = entry.playerPoolEntry.player;
    const proTeamId = p.proTeamId;
    const nbaAbbrev = getNbaTeamAbbrev(proTeamId);

    const rollingAvg15 = playerRollingAvg15.get(playerId) ?? playerMatchupAvgs.get(playerId) ?? playerSeasonAvg.get(playerId) ?? 0;
    const matchupAvgPerGame = playerMatchupAvgs.get(playerId) ?? 0;

    let todayFpts = 0;
    let gameStatus: GameStatus | 'none' = 'none';
    let minutesRemaining = 0;
    let remainingGamesAfterToday = nbaSchedule.get(proTeamId) ?? 0;

    if (!isFutureMatchup) {
      todayFpts = entry.playerPoolEntry.appliedStatTotal ?? 0;
      const gameInfo: NbaGameInfo | undefined = nbaScoreboard.get(nbaAbbrev);
      if (gameInfo) {
        gameStatus = gameInfo.status;
        minutesRemaining = gameInfo.minutesRemaining;
        // Today's game is included in nbaSchedule count AND handled via gameStatus.
        // Subtract 1 to avoid double-counting when gameStatus is live/final/upcoming.
        remainingGamesAfterToday = Math.max(0, remainingGamesAfterToday - 1);
      }
    }

    inputs.push({
      playerId, proTeamId,
      isActive: isActiveSlot(entry.lineupSlotId),
      isOnIR: IR_SLOTS.has(entry.lineupSlotId),
      todayFpts, rollingAvg15, matchupAvgPerGame,
      gameStatus, minutesRemaining, remainingGamesAfterToday,
    });

    names.set(playerId, {
      name: p.fullName,
      position: POSITION_MAP[p.defaultPositionId] ?? 'Unknown',
      nbaTeamAbbrev: nbaAbbrev,
    });
  }

  return { inputs, names };
}

/** Resolve owner name and basic team metadata. */
function resolveTeamMeta(
  teamId: number,
  team: EspnTeamRaw | undefined,
  memberById: Map<string, string>,
): { name: string; abbreviation: string; ownerName: string; logoUrl: string | null; playoffSeed: number | null } {
  let ownerName = 'Unknown Owner';
  if (team?.owners?.[0]) {
    ownerName = memberById.get(team.owners[0]) ?? 'Unknown Owner';
  }
  return {
    name: team?.name ?? `Team ${teamId}`,
    abbreviation: team?.abbrev ?? '???',
    ownerName,
    logoUrl: team?.logo ?? null,
    playoffSeed: team?.playoffSeed ?? null,
  };
}

// ─── Build Team (Scoreboard) ─────────────────────────────────────────────────

function buildTeam(
  side: EspnMatchupRaw['home'],
  teamById: Map<number, EspnTeamRaw>,
  memberById: Map<string, string>,
  maxGames: number,
  nbaScoreboard?: NbaScoreboardMap,
  nbaSchedule?: NbaScheduleMap,
  scoringItems: ScoringItemsList = [],
  isFutureMatchup = false,
): FantasyTeam {
  const team = teamById.get(side.teamId);
  const matchupEntries: EspnRosterEntry[] = side.rosterForMatchupPeriod?.entries ?? [];
  const currentEntries: EspnRosterEntry[] = side.rosterForCurrentScoringPeriod?.entries ?? [];
  const rosterEntries = matchupEntries.length > 0 ? matchupEntries : currentEntries;
  const rosterCount = rosterEntries.filter((e) => isActiveSlot(e.lineupSlotId)).length;
  const currentScore = side.totalPointsLive ?? side.totalPoints;
  let gamesPlayed = countGamesPlayed(side.rosterForMatchupPeriod);

  // Fallback: if score exists but GP=0 (past period with no stat data),
  // estimate GP from roster appliedStatTotal entries
  if (gamesPlayed === 0 && currentScore > 0) {
    gamesPlayed = estimateGamesPlayed(side.rosterForMatchupPeriod);
  }
  const avgPointsPerGame = gamesPlayed > 0 ? round1(currentScore / gamesPlayed) : 0;

  // Extract player averages from both matchup and roster data
  const playerMatchupAvgs = extractMatchupAvgs(matchupEntries);
  const { rolling15: playerRollingAvg15, season: playerSeasonAvg } = extractRosterAvgs(team?.roster?.entries, scoringItems);

  // Run projection engine
  let projectedScore: number;
  let projectionBreakdown: ProjectionBreakdown | null = null;

  if (nbaScoreboard && nbaSchedule) {
    // Per-player projection engine: pick entries based on matchup timing
    const allEntries = isFutureMatchup
      ? (team?.roster?.entries ?? matchupEntries)
      : (currentEntries.length > 0 ? currentEntries : matchupEntries);

    const { inputs, names } = buildProjectionInputs(
      allEntries, playerRollingAvg15, playerMatchupAvgs, playerSeasonAvg,
      nbaScoreboard, nbaSchedule, isFutureMatchup,
    );
    const projResult = computeTeamProjection(currentScore, gamesPlayed, maxGames, inputs, names);
    projectedScore = projResult.projectedScore;
    projectionBreakdown = projResult.breakdown;
  } else {
    // Fallback: pace-based projection with live game bonus
    projectedScore = computeProjectedScore(currentScore, gamesPlayed, maxGames);
    const liveBonus = estimateLiveGameProjection(currentEntries, playerMatchupAvgs);
    if (liveBonus > 0) {
      projectedScore = round1(Math.max(projectedScore, currentScore + liveBonus));
    }
  }

  const meta = resolveTeamMeta(side.teamId, team, memberById);

  return {
    id: side.teamId,
    ...meta,
    currentScore,
    avgPointsPerGame,
    gamesPlayed,
    maxGames,
    projectedScore,
    rosterCount,
    topPlayer: findTopPlayer(rosterEntries),
    projectionBreakdown,
  };
}

// ─── Matchup-Period Efficiency ───────────────────────────────────────────────

/**
 * Compute lineup efficiency for a matchup period: actual score vs optimal
 * lineup (top maxGames game-entries by per-game average).
 */
function computeMatchupEfficiency(
  rosterEntries: EspnRosterEntry[],
  scoringItems: ScoringItemsList,
  currentScore: number,
  maxGames: number,
): TeamEfficiency {
  const gameEntries: number[] = [];
  for (const entry of rosterEntries) {
    const playerStats = entry.playerPoolEntry.player.stats ?? [];
    const matchupStat = playerStats.find(
      (s: { statSplitTypeId: number; statSourceId: number; stats?: Record<string, number> }) =>
        s.statSplitTypeId === 5 && s.statSourceId === 0,
    );
    if (!matchupStat?.stats) continue;

    const totalFpts = computeFpts(matchupStat.stats, scoringItems);
    const playerGp = matchupStat.stats['42'] ?? 0;
    if (playerGp <= 0 || totalFpts <= 0) continue;

    const avgPerGame = totalFpts / playerGp;
    for (let g = 0; g < playerGp; g++) {
      gameEntries.push(avgPerGame);
    }
  }

  gameEntries.sort((a, b) => b - a);
  const maxPossibleScore = round1(gameEntries.slice(0, maxGames).reduce((sum, v) => sum + v, 0));
  const efficiencyPct = maxPossibleScore > 0
    ? round1((currentScore / maxPossibleScore) * 100)
    : 100;

  return {
    actualScore: currentScore,
    maxPossibleScore,
    efficiencyPct,
    missedPoints: round1(Math.max(0, maxPossibleScore - currentScore)),
  };
}

// ─── Matchup Detail ─────────────────────────────────────────────────────────

/**
 * Extract rolling averages from ESPN's pre-computed split types.
 * Split type 1 = last 7 days, 2 = last 15 days, 3 = last 30 days.
 *
 * Rolling split types from mRoster return TOTALS over the time window,
 * so we must divide by GP (stat 42) to get per-game averages.
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
    const fpts = computeFpts(stat.stats, scoringItems);
    const gp = stat.stats['42'] ?? 0;
    if (fpts > 0 && gp > 0) return round1(fpts / gp);
    return 0;
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
  // Find matchup by ID across ALL matchup periods (not just current).
  // Past playoff rounds (e.g., RD 1 when we're now in FINALS) must still be accessible.
  const matchup = raw.schedule.find((m) => m.id === matchupId);
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
    let gamesPlayed = countGamesPlayed(side.rosterForMatchupPeriod);
    // Fallback for completed past matchups where stat data is unavailable
    if (gamesPlayed === 0 && currentScore > 0) {
      gamesPlayed = estimateGamesPlayed(side.rosterForMatchupPeriod);
    }
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
        // Season split type 0 from mRoster is a TOTAL — divide by GP like rolling types
        const seasonFpts = computeFpts(seasonStats.stats, scoringItems);
        const seasonGp = seasonStats.stats['42'] ?? 0;
        if (seasonFpts > 0 && seasonGp > 0) {
          seasonFptsPerGame = round1(seasonFpts / seasonGp);
        }
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

    const meta = resolveTeamMeta(side.teamId, team, memberById);
    const efficiency = computeMatchupEfficiency(rosterEntries, scoringItems, currentScore, maxGames);

    return {
      id: side.teamId,
      ...meta,
      currentScore,
      avgPointsPerGame,
      gamesPlayed,
      maxGames,
      players,
      efficiency,
    };
  }

  return {
    matchupId: matchup.id,
    home: buildDetailTeam(matchup.home),
    away: buildDetailTeam(matchup.away),
    scoringPeriodId: raw.scoringPeriodId,
    matchupPeriodId: matchup.matchupPeriodId,
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
  // Find matchup by ID across ALL periods so past matchups are still viewable
  const matchup = raw.schedule.find((m) => m.id === matchupId);
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
