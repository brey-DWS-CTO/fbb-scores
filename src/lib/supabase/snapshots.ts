import { supabaseServer } from './server-client.js'
import type { LeagueScoreboard, Matchup } from '../../types/index.js'

const SNAPSHOT_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Persist a full LeagueScoreboard as individual per-matchup rows (upsert).
 * The unique constraint on (league_id, season_id, scoring_period_id, matchup_id)
 * means re-runs within the same scoring period overwrite the previous snapshot.
 */
export async function saveMatchupSnapshot(data: LeagueScoreboard): Promise<void> {
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
    throw new Error(`Failed to save matchup snapshot: ${error.message}`)
  }
}

/**
 * Retrieve the most recently captured snapshot for a given scoring period.
 * Returns null when no snapshot exists yet.
 */
export async function getLatestSnapshot(
  leagueId: string,
  seasonId: number,
  scoringPeriodId: number,
): Promise<LeagueScoreboard | null> {
  const { data, error } = await supabaseServer
    .from('matchup_snapshots')
    .select('data, captured_at')
    .eq('league_id', leagueId)
    .eq('season_id', seasonId)
    .eq('scoring_period_id', scoringPeriodId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch snapshot: ${error.message}`)
  }

  if (!data) return null

  return data.data as LeagueScoreboard
}

/**
 * Returns true if the snapshot was captured within the last 5 minutes.
 */
export function isSnapshotFresh(snapshot: { captured_at: string }): boolean {
  const age = Date.now() - new Date(snapshot.captured_at).getTime()
  return age < SNAPSHOT_TTL_MS
}
