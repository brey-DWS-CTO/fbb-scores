import { supabaseServer } from './server-client.js'
import type { LeagueScoreboard, Matchup } from '../../types/index.js'

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
