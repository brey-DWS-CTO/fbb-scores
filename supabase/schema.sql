-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── matchup_snapshots ────────────────────────────────────────────────────────
-- One row per matchup per scoring period. The `data` column holds the full
-- LeagueScoreboard JSON so the server can reconstruct the UI without hitting ESPN.

create table if not exists matchup_snapshots (
  id                 uuid        primary key default gen_random_uuid(),
  league_id          text        not null,
  season_id          integer     not null,
  scoring_period_id  integer     not null,
  matchup_id         integer     not null,
  home_team_id       integer     not null,
  away_team_id       integer     not null,
  home_score         numeric     not null,
  away_score         numeric     not null,
  data               jsonb       not null,
  captured_at        timestamptz not null default now(),

  constraint uq_matchup_snapshot
    unique (league_id, season_id, scoring_period_id, matchup_id)
);

-- Speed up the most common server-side query (fetch by league + period)
create index if not exists idx_matchup_snapshots_league_period
  on matchup_snapshots (league_id, season_id, scoring_period_id);

-- ─── league_settings ──────────────────────────────────────────────────────────

create table if not exists league_settings (
  id           uuid        primary key default gen_random_uuid(),
  league_id    text        unique not null,
  league_name  text,
  season_id    integer     not null,
  team_count   integer,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- RLS is enabled on both tables. In v1 we allow anonymous reads; all writes
-- must come from the server using the service-role key (bypasses RLS).

alter table matchup_snapshots enable row level security;
alter table league_settings    enable row level security;

create policy "Allow public read"
  on matchup_snapshots for select using (true);

create policy "Allow public read"
  on league_settings for select using (true);
