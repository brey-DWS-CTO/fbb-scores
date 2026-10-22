import type { NbaGame } from './houseParty.js';
import { scoreLine, type BoxLine, type BoxScore, type ScoringItem } from './partyScore.js';
import { addDaysIso, type ScoresWeek } from './scores.js';
import { round1 } from '../espn/calculations.js';

export interface DailyNbaScores {
  date: string;
  fetchedAt: string;
  games: NbaGame[];
  boxScores: BoxScore[];
  error: string | null;
}

export interface ScorerRoster { teamId: number; name: string }
export interface DailyScorer extends BoxLine {
  gameId: string;
  fpts: number;
  roster: ScorerRoster | null;
}

export interface TopPerformer extends DailyScorer { date: string; gamesPlayed: number }

/** Weekly means the current fantasy week, through today; Monday is the fallback without league dates. */
export function performerDates(today: string, weekly: boolean, week?: ScoresWeek): string[] {
  if (!weekly) return [today];
  if (week?.days.some(day => day.date === today)) {
    return [...new Set(week.days.map(day => day.date).filter(date => date <= today))].sort();
  }
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const elapsed = (weekday + 6) % 7;
  return Array.from({ length: elapsed + 1 }, (_, index) => addDaysIso(today, index - elapsed));
}

/** Sum each game's fantasy score, preserving per-game bonuses and the most recent game link. */
export function topPerformers(days: readonly DailyNbaScores[], scoring: readonly ScoringItem[], rosters: ReadonlyMap<string, ScorerRoster> | null): TopPerformer[] {
  const players = new Map<string, TopPerformer>();
  const seen = new Set<string>();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const row of dailyScorers(day.boxScores, scoring, rosters)) {
      const key = `${row.gameId}:${row.athleteId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const previous = players.get(row.athleteId);
      const stats = { ...previous?.stats };
      for (const [id, value] of Object.entries(row.stats)) stats[id] = (stats[id] ?? 0) + value;
      players.set(row.athleteId, { ...row, stats, date: day.date, gamesPlayed: (previous?.gamesPlayed ?? 0) + 1, fpts: round1((previous?.fpts ?? 0) + row.fpts) });
    }
  }
  return [...players.values()].sort((a, b) => b.fpts - a.fpts || (b.stats['0'] ?? 0) - (a.stats['0'] ?? 0) || a.name.localeCompare(b.name));
}

/** Only today's roster entries count; a player dropped earlier in the week is not rostered. */
export function scorerRosters(week: ScoresWeek, date: string): Map<string, ScorerRoster> | null {
  const day = week.days.find(entry => entry.date === date);
  if (!day || week.matchups.length === 0) return null;
  const rosters = new Map<string, ScorerRoster>();
  for (const matchup of week.matchups) for (const side of [matchup.home, matchup.away]) {
    for (const player of side.players) {
      if (player.days[String(day.scoringPeriodId)]) {
        rosters.set(String(player.id), { teamId: side.teamId, name: side.name });
      }
    }
  }
  return rosters.size > 0 ? rosters : null;
}

export function dailyScorers(boxes: readonly BoxScore[], scoring: readonly ScoringItem[], rosters: ReadonlyMap<string, ScorerRoster> | null): DailyScorer[] {
  return boxes.flatMap(box => {
    const seen = new Set<string>();
    return box.lines.filter(line => {
      if (!line.played || seen.has(line.athleteId)) return false;
      seen.add(line.athleteId);
      return true;
    }).map(line => ({ ...line, gameId: box.gameId, fpts: scoreLine(line, scoring), roster: rosters?.get(line.athleteId) ?? null }));
  }).sort((a, b) => b.fpts - a.fpts || (b.stats['0'] ?? 0) - (a.stats['0'] ?? 0) || a.name.localeCompare(b.name));
}

export function filterScorers<T extends DailyScorer>(rows: readonly T[], status: string, team: string): T[] {
  return rows.filter(row => (status === 'rostered' ? row.roster !== null : status === 'free' ? row.roster === null : true)
    && (team === 'all' || String(row.roster?.teamId) === team));
}

export function nbaGameHref(date: string, input: { gameId?: string; team?: string; player?: string }): string {
  const query = new URLSearchParams({ date });
  if (input.team) query.set('team', input.team);
  if (input.player) query.set('player', input.player);
  return `/scores/nba${input.gameId ? `/${input.gameId}` : ''}?${query}`;
}
