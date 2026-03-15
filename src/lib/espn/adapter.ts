import type {
  EspnLeagueResponse,
  EspnMatchupRaw,
  EspnRosterEntry,
  EspnTeamRaw,
  FantasyTeam,
  LeagueScoreboard,
  Matchup,
  PlayoffInfo,
  PlayoffTierType,
} from '../../types/index.js';
import { findTopPlayer, isActiveSlot } from './calculations.js';

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
