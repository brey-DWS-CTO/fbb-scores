import { normalizeTeam } from './houseParty.js';
import type { CastPlay } from './fantasyCast.js';

/** The mini feed follows the scoreboard the viewer is actually reading. */
export function castPageScope(pathname: string, params: URLSearchParams): string {
  const matchup = /^\/scores\/(\d+)$/.exec(pathname)?.[1];
  if (matchup) return `matchup:${matchup}`;
  void params;
  return 'all';
}

export function castMatchesGame(play: CastPlay, scope: string): boolean {
  if (scope.startsWith('game:')) return play.gameId === scope.slice(5);
  if (scope.startsWith('nba:')) return play.game.split(' @ ').some(code => normalizeTeam(code) === normalizeTeam(scope.slice(4)));
  return true;
}
