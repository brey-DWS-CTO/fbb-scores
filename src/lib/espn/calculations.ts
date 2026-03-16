import type { EspnRosterEntry, PlayerGameStats, PlayerProjectionInput, PlayerProjectionBreakdown, ProjectionBreakdown, TopPlayer } from '../../types/index.js';

// ESPN lineup slot IDs for non-active (bench/IR) positions
// 12 = Bench, 13 = IR, 20 = Bench (alt), 21 = IR (alt), 23 = IR+ (alt)
const BENCH_IR_SLOTS = new Set([12, 13, 20, 21, 23]);

export const POSITION_MAP: Record<number, string> = {
  1: 'PG',
  2: 'SG',
  3: 'SF',
  4: 'PF',
  5: 'C',
  6: 'SG',
  7: 'SF/PF',
};

/**
 * Returns true if the lineup slot is an active (non-bench, non-IR) slot.
 */
export function isActiveSlot(lineupSlotId: number): boolean {
  return !BENCH_IR_SLOTS.has(lineupSlotId);
}

/** Round to 1 decimal place. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Compute projected score by extrapolating current pace to max games. */
export function computeProjectedScore(score: number, gamesPlayed: number, maxGames: number): number {
  if (gamesPlayed === 0) return 0;
  return round1((score / gamesPlayed) * maxGames);
}

/**
 * Find the active roster entry with the highest appliedStatTotal
 * and return a normalized TopPlayer, or null if no active entries exist.
 */
export function findTopPlayer(entries: EspnRosterEntry[]): TopPlayer | null {
  const activeEntries = entries.filter((e) => isActiveSlot(e.lineupSlotId));
  if (activeEntries.length === 0) return null;

  let best = activeEntries[0];
  for (let i = 1; i < activeEntries.length; i++) {
    if (activeEntries[i].playerPoolEntry.appliedStatTotal > best.playerPoolEntry.appliedStatTotal) {
      best = activeEntries[i];
    }
  }

  const player = best.playerPoolEntry.player;
  return {
    name: player.fullName,
    position: POSITION_MAP[player.defaultPositionId] ?? 'Unknown',
    points: best.playerPoolEntry.appliedStatTotal,
    nbaTeamAbbrev: String(player.proTeamId),
    playerId: best.playerPoolEntry.id,
  };
}

// ─── NBA Team Abbreviations ─────────────────────────────────────────────────

export const NBA_TEAM_ABBREV: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'NOP', 4: 'CHI', 5: 'CLE',
  6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GSW', 10: 'HOU',
  11: 'IND', 12: 'LAC', 13: 'LAL', 14: 'MIA', 15: 'MIL',
  16: 'MIN', 17: 'BKN', 18: 'NYK', 19: 'ORL', 20: 'PHI',
  21: 'PHX', 22: 'POR', 23: 'SAC', 24: 'SAS', 25: 'OKC',
  26: 'UTA', 27: 'WAS', 28: 'TOR', 29: 'MEM', 30: 'CHA',
};

export function getNbaTeamAbbrev(proTeamId: number): string {
  return NBA_TEAM_ABBREV[proTeamId] ?? String(proTeamId);
}

// ─── Fantasy Points Computation ─────────────────────────────────────────────

export function computeFpts(
  stats: Record<string, number>,
  scoringItems: Array<{ statId: number; points: number; pointsOverrides?: Record<string, number> }>,
): number {
  let total = 0;
  for (const item of scoringItems) {
    const value = stats[String(item.statId)] ?? 0;
    total += value * item.points;
  }
  return round1(total);
}

// ─── Player Stats Extraction ────────────────────────────────────────────────

// ─── Win Probability ─────────────────────────────────────────────────────────

/** Approximate the standard normal CDF. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p = d * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

/**
 * Compute win probability for a matchup based on current scores,
 * games played, max games, and average PPG.
 */
export function computeWinProbability(
  homeScore: number, homeGamesPlayed: number, homeMaxGames: number, homeAvgPpg: number,
  awayScore: number, awayGamesPlayed: number, awayMaxGames: number, awayAvgPpg: number,
  homeProjectedScore?: number, awayProjectedScore?: number,
): { homeWinPct: number; awayWinPct: number } {
  const homeRemaining = Math.max(0, homeMaxGames - homeGamesPlayed);
  const awayRemaining = Math.max(0, awayMaxGames - awayGamesPlayed);

  // Use provided projected scores (which include live game estimates) or calculate from pace
  const homeProjectedTotal = homeProjectedScore && homeProjectedScore > homeScore
    ? homeProjectedScore
    : homeScore + homeAvgPpg * homeRemaining;
  const awayProjectedTotal = awayProjectedScore && awayProjectedScore > awayScore
    ? awayProjectedScore
    : awayScore + awayAvgPpg * awayRemaining;

  // Check if there are truly no more points to come (all games done AND no live bonus)
  const homeHasLiveBonus = homeProjectedTotal > homeScore;
  const awayHasLiveBonus = awayProjectedTotal > awayScore;
  const noMoreGames = homeRemaining === 0 && awayRemaining === 0 && !homeHasLiveBonus && !awayHasLiveBonus;

  // If all games are truly finished (no in-progress games), return deterministic result
  if (noMoreGames) {
    if (homeScore > awayScore) return { homeWinPct: 100, awayWinPct: 0 };
    if (awayScore > homeScore) return { homeWinPct: 0, awayWinPct: 100 };
    return { homeWinPct: 50, awayWinPct: 50 };
  }

  // Standard deviation: account for remaining games AND in-progress game volatility
  // For in-progress games, use the projected bonus as a proxy for remaining variance
  const homeLiveVariance = homeHasLiveBonus && homeRemaining === 0
    ? (homeProjectedTotal - homeScore) * 0.3  // ~30% uncertainty on live game extrapolation
    : homeAvgPpg * Math.sqrt(homeRemaining) * 0.15;
  const awayLiveVariance = awayHasLiveBonus && awayRemaining === 0
    ? (awayProjectedTotal - awayScore) * 0.3
    : awayAvgPpg * Math.sqrt(awayRemaining) * 0.15;
  const combinedStdDev = Math.sqrt(homeLiveVariance * homeLiveVariance + awayLiveVariance * awayLiveVariance);

  // If no variance, fall back to projected score comparison
  if (combinedStdDev === 0) {
    if (homeProjectedTotal > awayProjectedTotal) return { homeWinPct: 99, awayWinPct: 1 };
    if (awayProjectedTotal > homeProjectedTotal) return { homeWinPct: 1, awayWinPct: 99 };
    return { homeWinPct: 50, awayWinPct: 50 };
  }

  const zScore = (homeProjectedTotal - awayProjectedTotal) / combinedStdDev;
  let homeWinPct = Math.round(normalCdf(zScore) * 100);

  // Clamp between 1% and 99%
  homeWinPct = Math.max(1, Math.min(99, homeWinPct));
  const awayWinPct = 100 - homeWinPct;

  return { homeWinPct, awayWinPct };
}

// ─── Live Game Projection ────────────────────────────────────────────────────

/**
 * Estimate projected remaining fantasy points from in-progress games.
 *
 * Strategy: compare each active player's today FPTS against their rolling
 * average. If they have scored some points today but less than ~75% of their
 * average, their game is likely still in progress. Estimate remaining =
 * max(0, rollingAvg - todayFpts).
 *
 * When the ESPN API doesn't provide box-score minutes (common for live data),
 * this heuristic-based approach provides a reasonable estimate.
 *
 * @param currentPeriodEntries  entries from rosterForCurrentScoringPeriod
 * @param playerRollingAvgs    map of playerId → 7-day rolling average FPTS per game
 * @returns projected additional points from in-progress games
 */
export function estimateLiveGameProjection(
  currentPeriodEntries: EspnRosterEntry[],
  playerRollingAvgs: Map<number, number>,
): number {
  let projectedRemaining = 0;

  for (const entry of currentPeriodEntries) {
    // Only consider active (started) players
    if (!isActiveSlot(entry.lineupSlotId)) continue;

    const playerId = entry.playerPoolEntry.id;
    const todayFpts = entry.playerPoolEntry.appliedStatTotal ?? 0;
    const rollingAvg = playerRollingAvgs.get(playerId) ?? 0;

    // Skip players with no scoring today or no rolling average
    if (todayFpts <= 0 || rollingAvg <= 0) continue;

    // If they've scored > 0 but less than 75% of their typical game,
    // their game is likely still in progress
    if (todayFpts < rollingAvg * 0.75) {
      const estimatedRemaining = Math.max(0, rollingAvg - todayFpts);
      projectedRemaining += estimatedRemaining;
    }
    // If they've scored between 75-100% of their average, game might be
    // nearly over — project a small remaining amount
    else if (todayFpts < rollingAvg) {
      projectedRemaining += (rollingAvg - todayFpts) * 0.5;
    }
    // If they've scored above their average, game is likely over — no bonus
  }

  return round1(projectedRemaining);
}

// ─── Per-Player Game Projection ──────────────────────────────────────────────

/**
 * Compute the projected fantasy points for a single player's current/upcoming game.
 *
 * | Game State   | Formula                                                    |
 * |--------------|------------------------------------------------------------|
 * | In-progress  | todayFpts + (rollingAvg15 × minutesRemaining / 48)         |
 * | Final        | todayFpts (actual, no projection needed)                   |
 * | Upcoming     | rollingAvg15 (fallback: matchupAvgPerGame)                 |
 * | No game      | 0                                                          |
 *
 * OT: minutesRemaining naturally includes OT time from the scoreboard.
 * The overrideProjection hook allows future enhancements (vegas/pace) to
 * replace the rollingAvg15 baseline per game.
 */
export function computePlayerGameProjection(player: PlayerProjectionInput): number {
  if (!player.isActive) return 0;

  const baseline = player.overrideProjection ?? (player.rollingAvg15 || player.matchupAvgPerGame);

  switch (player.gameStatus) {
    case 'live': {
      // In-progress: actual scored + projected remaining based on minutes left
      const remainingFraction = Math.max(0, player.minutesRemaining / 48);
      return round1(player.todayFpts + baseline * remainingFraction);
    }
    case 'final':
      // Game is done — return actual points scored today
      return round1(player.todayFpts);
    case 'upcoming':
      // Future game today — project full game at baseline
      return round1(baseline);
    case 'none':
    default:
      // No game today
      return 0;
  }
}

export interface TeamProjectionResult {
  projectedScore: number;
  breakdown: ProjectionBreakdown;
}

/**
 * Compute the projected total score for a fantasy team for the matchup period.
 *
 * Strategy: "Started + smart fill"
 * 1. For each started player, project their remaining contribution:
 *    - Today's game (live/final/upcoming via computePlayerGameProjection)
 *    - Future games in the matchup period (remainingGamesAfterToday × baseline)
 * 2. Count how many game slots are left after started players are accounted for
 * 3. Fill remaining slots with the best bench players' future game projections
 *
 * @param currentScore    Team's total matchup score so far
 * @param gamesPlayed     Games played so far in the matchup
 * @param maxGames        Max games allowed for the matchup period
 * @param players         Projection input for each player on the roster
 * @param playerNames     Optional map of playerId → { name, position, nbaTeamAbbrev } for breakdown
 */
export function computeTeamProjection(
  currentScore: number,
  gamesPlayed: number,
  maxGames: number,
  players: PlayerProjectionInput[],
  playerNames?: Map<number, { name: string; position: string; nbaTeamAbbrev: string }>,
): TeamProjectionResult {
  // Separate starters from bench
  const starters = players.filter((p) => p.isActive);
  const bench = players.filter((p) => !p.isActive);

  let projectedAdditional = 0;
  let gameSlotsFilled = gamesPlayed;
  const breakdownPlayers: PlayerProjectionBreakdown[] = [];

  // Step 1: Project remaining points from starters
  for (const player of starters) {
    const baseline = player.overrideProjection ?? (player.rollingAvg15 || player.matchupAvgPerGame);
    let playerProjectedFpts = 0;
    let playerRemainingGames = 0;

    // Today's game projection (incremental over what's already in currentScore)
    if (player.gameStatus === 'live') {
      const remainingFraction = Math.max(0, player.minutesRemaining / 48);
      const liveProjection = baseline * remainingFraction;
      projectedAdditional += liveProjection;
      playerProjectedFpts += liveProjection;
    } else if (player.gameStatus === 'upcoming') {
      projectedAdditional += baseline;
      playerProjectedFpts += baseline;
      gameSlotsFilled++;
      playerRemainingGames++;
    }

    // Future games after today
    const futureGames = player.remainingGamesAfterToday;
    if (futureGames > 0 && gameSlotsFilled < maxGames) {
      const slotsToFill = Math.min(futureGames, maxGames - gameSlotsFilled);
      projectedAdditional += baseline * slotsToFill;
      playerProjectedFpts += baseline * slotsToFill;
      gameSlotsFilled += slotsToFill;
      playerRemainingGames += slotsToFill;
    }

    const info = playerNames?.get(player.playerId);
    breakdownPlayers.push({
      playerId: player.playerId,
      name: info?.name ?? `Player ${player.playerId}`,
      position: info?.position ?? '',
      nbaTeamAbbrev: info?.nbaTeamAbbrev ?? getNbaTeamAbbrev(player.proTeamId),
      isStarter: true,
      rollingAvg15: round1(baseline),
      remainingGames: playerRemainingGames,
      projectedFpts: round1(playerProjectedFpts),
      isSmartFilled: false,
      imageUrl: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${player.playerId}.png&w=96&h=70&cb=1`,
    });
  }

  // Step 2: Smart fill — if there are still empty game slots, fill with best bench players
  if (gameSlotsFilled < maxGames) {
    const benchProjections: Array<{ player: PlayerProjectionInput; baseline: number; futureGames: number }> = [];
    for (const player of bench) {
      const baseline = player.overrideProjection ?? (player.rollingAvg15 || player.matchupAvgPerGame);
      if (baseline <= 0) continue;

      let futureGames = player.remainingGamesAfterToday;
      if (player.gameStatus === 'upcoming') futureGames++;

      if (futureGames > 0) {
        benchProjections.push({ player, baseline, futureGames });
      }
    }

    benchProjections.sort((a, b) => b.baseline - a.baseline);

    for (const bp of benchProjections) {
      if (gameSlotsFilled >= maxGames) break;
      const slotsToFill = Math.min(bp.futureGames, maxGames - gameSlotsFilled);
      const projFpts = bp.baseline * slotsToFill;
      projectedAdditional += projFpts;
      gameSlotsFilled += slotsToFill;

      const info = playerNames?.get(bp.player.playerId);
      breakdownPlayers.push({
        playerId: bp.player.playerId,
        name: info?.name ?? `Player ${bp.player.playerId}`,
        position: info?.position ?? '',
        nbaTeamAbbrev: info?.nbaTeamAbbrev ?? getNbaTeamAbbrev(bp.player.proTeamId),
        isStarter: false,
        rollingAvg15: round1(bp.baseline),
        remainingGames: slotsToFill,
        projectedFpts: round1(projFpts),
        isSmartFilled: true,
        imageUrl: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${bp.player.playerId}.png&w=96&h=70&cb=1`,
      });
    }
  }

  // Also add bench players that were NOT smart-filled (0 projected contribution)
  for (const player of bench) {
    if (breakdownPlayers.some((bp) => bp.playerId === player.playerId)) continue;
    const baseline = player.overrideProjection ?? (player.rollingAvg15 || player.matchupAvgPerGame);
    const info = playerNames?.get(player.playerId);
    breakdownPlayers.push({
      playerId: player.playerId,
      name: info?.name ?? `Player ${player.playerId}`,
      position: info?.position ?? '',
      nbaTeamAbbrev: info?.nbaTeamAbbrev ?? getNbaTeamAbbrev(player.proTeamId),
      isStarter: false,
      rollingAvg15: round1(baseline),
      remainingGames: player.remainingGamesAfterToday + (player.gameStatus === 'upcoming' ? 1 : 0),
      projectedFpts: 0,
      isSmartFilled: false,
      imageUrl: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${player.playerId}.png&w=96&h=70&cb=1`,
    });
  }

  // Sort breakdown: starters first by projected descending, then bench by projected descending
  breakdownPlayers.sort((a, b) => {
    if (a.isStarter && !b.isStarter) return -1;
    if (!a.isStarter && b.isStarter) return 1;
    return b.projectedFpts - a.projectedFpts;
  });

  const projectedScore = round1(currentScore + projectedAdditional);

  return {
    projectedScore,
    breakdown: {
      players: breakdownPlayers,
      projectedTotal: projectedScore,
      gameSlotsFilled,
      maxGames,
    },
  };
}

export function extractPlayerStats(stats: Record<string, number>): PlayerGameStats {
  return {
    pts: stats['0'] ?? 0,
    reb: stats['6'] ?? 0,
    ast: stats['3'] ?? 0,
    stl: stats['2'] ?? 0,
    blk: stats['1'] ?? 0,
    fgm: stats['13'] ?? 0,
    fga: stats['14'] ?? 0,
    ftm: stats['15'] ?? 0,
    fta: stats['16'] ?? 0,
    threepm: stats['17'] ?? 0,
    to: stats['19'] ?? 0,
    pf: stats['27'] ?? 0,
    min: stats['40'] ?? 0,
    gp: stats['42'] ?? 0,
  };
}
