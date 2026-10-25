import type { NbaGame } from './houseParty.js';

/** Seconds left in the current regulation/overtime period plus later quarters. */
export function scoreboardTimeLeft(detail: string): number {
  if (/half\s*time/i.test(detail)) return 24 * 60;
  const overtime = detail.match(/(?:(\d+)\s*)?OT\b/i);
  const quarter = detail.match(/\b([1-4])(?:st|nd|rd|th)\b/i) ?? detail.match(/\bQ([1-4])\b/i);
  if (!overtime && !quarter) return Infinity;
  const clock = detail.match(/\b(\d{1,2}):(\d{2})(?:\.\d+)?\b/);
  const seconds = clock ? Number(clock[1]) * 60 + Number(clock[2]) : /\bend\b/i.test(detail) ? 0 : overtime ? 300 : 720;
  return (overtime ? 0 : (4 - Number(quarter![1])) * 720) + seconds;
}

/** Live closest to finishing, then upcoming earliest first, then completed. */
export function sortScoreboardGames(games: readonly NbaGame[]): NbaGame[] {
  const rank = { in: 0, pre: 1, post: 2 };
  return [...games].sort((a, b) => {
    const state = rank[a.state] - rank[b.state];
    if (state) return state;
    if (a.state === 'in') {
      const remaining = scoreboardTimeLeft(a.detail) - scoreboardTimeLeft(b.detail);
      if (remaining) return remaining;
    }
    return a.tipoff.localeCompare(b.tipoff) || a.id.localeCompare(b.id);
  });
}

/** The score to show for one team: the box score's when it has one, else the scoreboard's. */
export function teamScore(game: Pick<NbaGame, 'home' | 'homeScore' | 'awayScore'>, box: { homeScore: number | null; awayScore: number | null } | undefined, code: string): number | null {
  return code === game.home ? box?.homeScore ?? game.homeScore : box?.awayScore ?? game.awayScore;
}

/** The winning team's code once a game is final. Null while it runs, before it starts, or on a tie. */
export function gameWinner(game: Pick<NbaGame, 'home' | 'away' | 'state' | 'homeScore' | 'awayScore'>, box?: { homeScore: number | null; awayScore: number | null }): string | null {
  if (game.state !== 'post') return null;
  const home = teamScore(game, box, game.home), away = teamScore(game, box, game.away);
  if (home === null || away === null || home === away) return null;
  return home > away ? game.home : game.away;
}
