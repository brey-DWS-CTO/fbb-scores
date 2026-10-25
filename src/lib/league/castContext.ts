import { normalizeTeam } from './houseParty.js';
import { sortCastPlays, type CastPlay } from './fantasyCast.js';

/** The mini feed follows the scoreboard the viewer is actually reading. */
export function castPageScope(pathname: string, params: URLSearchParams): string {
  const matchup = /^\/scores\/(\d+)$/.exec(pathname)?.[1];
  if (matchup) return `matchup:${matchup}`;
  // One NBA game's box score shows only that game's plays.
  const game = /^\/scores\/nba\/([^/]+)$/.exec(pathname)?.[1];
  if (game) return `game:${game}`;
  const team = pathname === '/scores/nba' ? normalizeTeam(params.get('team')) : null;
  return team ? `nba:${team}` : 'all';
}

/**
 * The latest play in one NBA game, by wall clock. ESPN appends late sub
 * fixes to the end of its feed, so its play order alone can point back
 * into the 4th quarter. The box score corrections row is not a play.
 */
export function lastGamePlay(plays: readonly CastPlay[], gameId: string): CastPlay | null {
  return sortCastPlays(plays.filter(play => play.gameId === gameId && !play.id.endsWith(':corrections')), true)[0] ?? null;
}

/** "Q3 5:32", "OT1 0:41". */
export function castClockText(play: Pick<CastPlay, 'period' | 'clock'>): string {
  return `${play.period > 4 ? `OT${play.period - 4}` : `Q${play.period}`}${play.clock ? ` ${play.clock}` : ''}`;
}

/** "MIA 98 @ CHA 101": the game with the score right after the play. Just the teams when no score was kept. */
export function castGameScore(play: Pick<CastPlay, 'game' | 'awayScore' | 'homeScore'>): string {
  const [away, home] = play.game.split(' @ ');
  if (!home || play.awayScore === undefined || play.homeScore === undefined) return play.game;
  return `${away} ${play.awayScore} @ ${home} ${play.homeScore}`;
}

export function castMatchesGame(play: CastPlay, scope: string): boolean {
  if (scope.startsWith('game:')) return play.gameId === scope.slice(5);
  if (scope.startsWith('nba:')) return play.game.split(' @ ').some(code => normalizeTeam(code) === normalizeTeam(scope.slice(4)));
  return true;
}
