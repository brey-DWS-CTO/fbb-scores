import { normalizeTeam } from './houseParty.js';
import type { CastPlay } from './fantasyCast.js';

/** The mini feed follows the scoreboard the viewer is actually reading. */
export function castPageScope(pathname: string, params: URLSearchParams): string {
  const matchup = /^\/scores\/(\d+)$/.exec(pathname)?.[1];
  if (matchup) return `matchup:${matchup}`;
  const game = /^\/scores\/nba\/(\d+)$/.exec(pathname)?.[1];
  if (game) return `game:${game}`;
  if (pathname === '/scores/nba') {
    const team = normalizeTeam(params.get('team'));
    if (team) return `nba:${team}`;
  }
  const team = pathname === '/scores/performers' ? params.get('fantasyTeam') : pathname === '/scores' ? params.get('team') : null;
  return team && /^\d+$/.test(team) ? `team:${team}` : 'all';
}

export function castMatchesGame(play: CastPlay, scope: string): boolean {
  if (scope.startsWith('game:')) return play.gameId === scope.slice(5);
  if (scope.startsWith('nba:')) return play.game.split(' @ ').some(code => normalizeTeam(code) === normalizeTeam(scope.slice(4)));
  return true;
}
