import type { EspnRosterEntry, PlayerGameStats, TopPlayer } from '../../types/index.js';

const BENCH_IR_SLOTS = new Set([20, 21, 23]);

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
): { homeWinPct: number; awayWinPct: number } {
  const homeRemaining = Math.max(0, homeMaxGames - homeGamesPlayed);
  const awayRemaining = Math.max(0, awayMaxGames - awayGamesPlayed);

  // If all games are played for both teams, return deterministic result
  if (homeRemaining === 0 && awayRemaining === 0) {
    if (homeScore > awayScore) return { homeWinPct: 100, awayWinPct: 0 };
    if (awayScore > homeScore) return { homeWinPct: 0, awayWinPct: 100 };
    return { homeWinPct: 50, awayWinPct: 50 };
  }

  // Project remaining points
  const homeProjectedRemaining = homeAvgPpg * homeRemaining;
  const awayProjectedRemaining = awayAvgPpg * awayRemaining;

  const homeProjectedTotal = homeScore + homeProjectedRemaining;
  const awayProjectedTotal = awayScore + awayProjectedRemaining;

  // Standard deviation based on volatility factor
  const homeStdDev = homeAvgPpg * Math.sqrt(homeRemaining) * 0.15;
  const awayStdDev = awayAvgPpg * Math.sqrt(awayRemaining) * 0.15;
  const combinedStdDev = Math.sqrt(homeStdDev * homeStdDev + awayStdDev * awayStdDev);

  // If no variance (e.g. both have 0 avg), fall back to current score comparison
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
