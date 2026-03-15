// Auto-maintained by hand — mirrors the Supabase schema in supabase/schema.sql

export interface Database {
  public: {
    Tables: {
      matchup_snapshots: {
        Row: {
          id: string
          league_id: string
          season_id: number
          scoring_period_id: number
          matchup_id: number
          home_team_id: number
          away_team_id: number
          home_score: number
          away_score: number
          /** Full LeagueScoreboard snapshot stored as JSON */
          data: unknown
          captured_at: string
        }
        Insert: {
          id?: string
          league_id: string
          season_id: number
          scoring_period_id: number
          matchup_id: number
          home_team_id: number
          away_team_id: number
          home_score: number
          away_score: number
          data: unknown
          captured_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          season_id?: number
          scoring_period_id?: number
          matchup_id?: number
          home_team_id?: number
          away_team_id?: number
          home_score?: number
          away_score?: number
          data?: unknown
          captured_at?: string
        }
      }
      league_settings: {
        Row: {
          id: string
          league_id: string
          league_name: string | null
          season_id: number
          team_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          league_id: string
          league_name?: string | null
          season_id: number
          team_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          league_id?: string
          league_name?: string | null
          season_id?: number
          team_count?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
    }
  }
}
