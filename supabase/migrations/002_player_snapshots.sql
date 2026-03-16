-- Player snapshots for trend tracking
-- Stores per-player stats each time a matchup detail is fetched

CREATE TABLE IF NOT EXISTS player_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  scoring_period_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  fpts NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stats JSONB,
  rolling_avg_7 NUMERIC(10, 2) DEFAULT 0,
  rolling_avg_15 NUMERIC(10, 2) DEFAULT 0,
  rolling_avg_30 NUMERIC(10, 2) DEFAULT 0,
  captured_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (league_id, season_id, scoring_period_id, player_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_player_snapshots_player
  ON player_snapshots (league_id, season_id, player_id, scoring_period_id);

CREATE INDEX IF NOT EXISTS idx_player_snapshots_team
  ON player_snapshots (league_id, season_id, team_id, scoring_period_id);
