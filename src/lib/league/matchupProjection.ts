import type { ScorePlayer, ScoresWeek } from './scores.js';
import type { ScoringItem } from './partyScore.js';
import { normalizeNbaTeamCode } from './schedule.js';

export const MATCHUP_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type MatchupPosition = typeof MATCHUP_POSITIONS[number];
export interface PositionDefense { games: number; stats: Record<string, number> }
export interface MatchupTeam { pace: number; defense: Record<MatchupPosition, PositionDefense> }
export interface MatchupEnvironment {
  season: number;
  fetchedAt: string;
  teams: Record<string, MatchupTeam>;
}
export interface MatchupFeed { environment: MatchupEnvironment | null; error: string | null }
export interface GameProjection {
  points: number;
  baseline: number;
  source: 'matchup' | 'espn-daily' | 'baseline';
  paceFactor: number;
  defenseFactor: number;
}
// Conservative first-version parameters, to be calibrated against held-out outcomes.
export const MATCHUP_PRIOR_GAMES = 15;
export const MATCHUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHARED_STATS = new Set([0, 6, 3, 17, 2, 1, 11]);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function defensePoints(row: PositionDefense, scoring: readonly ScoringItem[]): number {
  return scoring.reduce((sum, item) => sum + (SHARED_STATS.has(item.statId) ? (row.stats[String(item.statId)] ?? 0) * item.points : 0), 0);
}
function positions(value: string): MatchupPosition[] {
  const parts = value.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const expanded = parts.flatMap(p => p === 'G' ? ['PG', 'SG'] : p === 'F' ? ['SF', 'PF'] : [p]);
  return MATCHUP_POSITIONS.filter(p => expanded.includes(p));
}

/** Matchup signal on top of league-scored FPPG. ESPN daily estimates are already game-specific. */
export function matchupGameProjection(player: ScorePlayer, period: number, baseline: number, week: ScoresWeek | undefined,
  environment: MatchupEnvironment | null | undefined, scoring: readonly ScoringItem[], now = Date.now()): GameProjection {
  const base = Number.isFinite(baseline) ? Math.max(0, baseline) : 0;
  const result: GameProjection = { points: base, baseline: base, source: 'baseline', paceFactor: 1, defenseFactor: 1 };
  const daily = player.projByDay[String(period)];
  if (typeof daily === 'number' && Number.isFinite(daily)) return { ...result, source: 'espn-daily' };
  const day = week?.days.find(d => d.scoringPeriodId === period);
  const game = day?.games?.[player.proTeam];
  const captured = Date.parse(environment?.fetchedAt ?? '');
  if (!base || !week || !environment || week.season !== environment.season || !Number.isFinite(captured)
    || captured > now || now - captured > MATCHUP_MAX_AGE_MS || game?.status !== 'upcoming'
    || !game.tipoff || !Number.isFinite(Date.parse(game.tipoff)) || Date.parse(game.tipoff) <= now) return result;
  const own = environment.teams[normalizeNbaTeamCode(player.proTeam)];
  const opponent = environment.teams[normalizeNbaTeamCode(game.opponent)];
  const eligible = positions(player.position);
  if (!own || !opponent || !eligible.length) return result;
  const teams = Object.values(environment.teams);
  if (teams.length !== 30) return result;
  const leaguePace = teams.reduce((sum, team) => sum + team.pace, 0) / teams.length;
  if (!(leaguePace > 0) || !(own.pace > 0) || !(opponent.pace > 0)) return result;
  const signals = eligible.map(position => {
    const row = opponent.defense[position];
    if (!row || row.games <= 0) return null;
    let total = 0, games = 0;
    for (const team of teams) {
      const defense = team.defense[position];
      if (!defense || defense.games <= 0 || !(team.pace > 0)) return null;
      total += defensePoints(defense, scoring) / team.pace * defense.games;
      games += defense.games;
    }
    const average = total / games;
    const allowed = defensePoints(row, scoring) / opponent.pace;
    if (!(average > 0) || !(allowed > 0)) return null;
    return { ratio: allowed / average, reliability: row.games / (row.games + MATCHUP_PRIOR_GAMES) };
  });
  if (signals.some(signal => signal === null)) return result;
  const known = signals.filter(signal => signal !== null);
  const reliability = Math.min(...known.map(s => s.reliability));
  // DvP divided by opponent pace removes its tempo effect before adding expected game pace.
  const defenseFactor = clamp(1 + known.reduce((sum, s) => sum + (s.ratio - 1) * s.reliability, 0) / known.length, .9, 1.1);
  const paceFactor = clamp(1 + (((own.pace + opponent.pace) / 2) / own.pace - 1) * reliability, .95, 1.05);
  return { ...result, points: base * paceFactor * defenseFactor, source: 'matchup', paceFactor, defenseFactor };
}

export function projectionExplanation(value: GameProjection): string {
  if (value.source === 'espn-daily') return 'ESPN daily projection';
  if (value.source === 'baseline') return 'Baseline estimate; no matchup adjustment';
  const percent = (factor: number) => `${factor >= 1 ? '+' : ''}${((factor - 1) * 100).toFixed(1)}%`;
  return `Baseline ${value.baseline.toFixed(1)}; pace ${percent(value.paceFactor)}; position matchup ${percent(value.defenseFactor)}`;
}
