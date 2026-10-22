import type { NbaGame } from './houseParty.js';
import { scoreLine, type BoxLine, type BoxScore, type ScoringItem } from './partyScore.js';
import type { ScoresWeek } from './scores.js';

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

export function filterScorers(rows: readonly DailyScorer[], status: string, team: string): DailyScorer[] {
  return rows.filter(row => (status === 'rostered' ? row.roster !== null : status === 'free' ? row.roster === null : true)
    && (team === 'all' || String(row.roster?.teamId) === team));
}

export function nbaGameHref(date: string, input: { gameId?: string; team?: string; player?: string }): string {
  const query = new URLSearchParams({ date });
  if (input.team) query.set('team', input.team);
  if (input.player) query.set('player', input.player);
  return `/scores/nba${input.gameId ? `/${input.gameId}` : ''}?${query}`;
}
