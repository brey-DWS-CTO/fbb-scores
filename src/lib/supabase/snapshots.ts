import { supabaseServer } from './server-client.js'
import type {
  LeagueScoreboard,
  Matchup,
  MatchupDetail,
  MatchupPlayer,
  PlayerTrend,
  TeamTrend,
} from '../../types/index.js'

/**
 * Persist a full LeagueScoreboard as individual per-matchup rows (upsert).
 * No-op if Supabase is not configured.
 */
export async function saveMatchupSnapshot(data: LeagueScoreboard): Promise<void> {
  if (!supabaseServer) return

  const rows = data.matchups.map((matchup: Matchup) => ({
    league_id: data.leagueId,
    season_id: data.seasonId,
    scoring_period_id: data.scoringPeriodId,
    matchup_id: matchup.id,
    home_team_id: matchup.home.id,
    away_team_id: matchup.away.id,
    home_score: matchup.home.currentScore,
    away_score: matchup.away.currentScore,
    data,
  }))

  const { error } = await supabaseServer
    .from('matchup_snapshots')
    .upsert(rows, {
      onConflict: 'league_id,season_id,scoring_period_id,matchup_id',
    })

  if (error) {
    console.error(`[Supabase] Failed to save snapshot: ${error.message}`)
  }
}

/**
 * Retrieve the most recently captured snapshot for a given scoring period.
 * Returns null when no snapshot exists or Supabase is not configured.
 */
export async function getLatestSnapshot(
  leagueId: string,
  seasonId: number,
  scoringPeriodId?: number,
): Promise<LeagueScoreboard | null> {
  if (!supabaseServer) return null

  let query = supabaseServer
    .from('matchup_snapshots')
    .select('data, captured_at')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)

  if (scoringPeriodId !== undefined) {
    query = query.eq('scoring_period_id', scoringPeriodId)
  }

  const { data, error } = await query
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(`[Supabase] Failed to fetch snapshot: ${error.message}`)
    return null
  }

  if (!data) return null
  return data.data as LeagueScoreboard
}

/**
 * Persist player-level stats from a MatchupDetail as individual rows (upsert).
 * No-op if Supabase is not configured.
 */
export async function savePlayerSnapshots(
  leagueId: string,
  seasonId: number,
  detail: MatchupDetail,
): Promise<void> {
  if (!supabaseServer) return

  const buildRows = (players: MatchupPlayer[], teamId: number) =>
    players.map((p) => ({
      league_id: leagueId,
      season_id: seasonId,
      scoring_period_id: detail.scoringPeriodId,
      player_id: p.playerId,
      team_id: teamId,
      player_name: p.name,
      fpts: p.fpts,
      stats: p.stats,
      rolling_avg_7: p.averages.last7,
      rolling_avg_15: p.averages.last15,
      rolling_avg_30: p.averages.last30,
    }))

  const rows = [
    ...buildRows(detail.home.players, detail.home.id),
    ...buildRows(detail.away.players, detail.away.id),
  ]

  const { error } = await supabaseServer
    .from('player_snapshots')
    .upsert(rows, {
      onConflict: 'league_id,season_id,scoring_period_id,player_id',
    })

  if (error) {
    console.error(`[Supabase] Failed to save player snapshots: ${error.message}`)
  }
}

/**
 * Retrieve trend data for a single player over time.
 * Returns null when no data exists or Supabase is not configured.
 */
export async function getPlayerTrend(
  leagueId: string,
  seasonId: number,
  playerId: number,
): Promise<PlayerTrend | null> {
  if (!supabaseServer) return null

  const { data, error } = await supabaseServer
    .from('player_snapshots')
    .select('scoring_period_id, player_name, fpts, rolling_avg_7, rolling_avg_15, rolling_avg_30, captured_at')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .order('scoring_period_id', { ascending: true })
    .limit(30)

  if (error) {
    console.error(`[Supabase] Failed to fetch player trend: ${error.message}`)
    return null
  }

  if (!data || data.length === 0) return null

  return {
    playerId,
    playerName: data[0].player_name,
    dataPoints: data.map((row) => ({
      scoringPeriodId: row.scoring_period_id,
      fpts: row.fpts,
      rollingAvg7: row.rolling_avg_7,
      rollingAvg15: row.rolling_avg_15,
      rollingAvg30: row.rolling_avg_30,
      capturedAt: row.captured_at,
    })),
  }
}

/**
 * Retrieve trend data for a team over time from matchup_snapshots.
 * Returns null when no data exists or Supabase is not configured.
 */
export async function getTeamTrend(
  leagueId: string,
  seasonId: number,
  teamId: number,
): Promise<TeamTrend | null> {
  if (!supabaseServer) return null

  const { data, error } = await supabaseServer
    .from('matchup_snapshots')
    .select('scoring_period_id, home_team_id, away_team_id, home_score, away_score, data, captured_at')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('scoring_period_id', { ascending: true })
    .limit(30)

  if (error) {
    console.error(`[Supabase] Failed to fetch team trend: ${error.message}`)
    return null
  }

  if (!data || data.length === 0) return null

  // Resolve team name from the first snapshot's embedded scoreboard data
  let teamName = `Team ${teamId}`
  const firstSnapshot = data[0].data as LeagueScoreboard | null
  if (firstSnapshot) {
    for (const matchup of firstSnapshot.matchups) {
      if (matchup.home.id === teamId) { teamName = matchup.home.name; break }
      if (matchup.away.id === teamId) { teamName = matchup.away.name; break }
    }
  }

  return {
    teamId,
    teamName,
    dataPoints: data.map((row) => {
      const isHome = row.home_team_id === teamId
      const score = isHome ? row.home_score : row.away_score

      // Extract games played / avg from the embedded scoreboard data
      let gamesPlayed = 0
      let avgPointsPerGame = 0
      const snapshot = row.data as LeagueScoreboard | null
      if (snapshot) {
        for (const matchup of snapshot.matchups) {
          const team = matchup.home.id === teamId ? matchup.home : matchup.away.id === teamId ? matchup.away : null
          if (team) {
            gamesPlayed = team.gamesPlayed
            avgPointsPerGame = team.avgPointsPerGame
            break
          }
        }
      }

      return {
        scoringPeriodId: row.scoring_period_id,
        totalScore: score,
        avgPointsPerGame,
        gamesPlayed,
        capturedAt: row.captured_at,
      }
    }),
  }
}
