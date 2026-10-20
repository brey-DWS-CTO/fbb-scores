import { gamesCapStatus, lineupGames } from '../../lib/league/lineupGames.js';
import type { ScoreSide, ScoresWeek } from '../../lib/league/scores.js';

export default function LineupGamesSummary({ side, week }: { side: ScoreSide; week: ScoresWeek }) {
  const games = lineupGames(side, week);
  const tone = games.difference === null ? '' : games.difference > 0 ? ' is-over' : games.difference < 0 ? ' is-under' : ' is-at';
  return (
    <div className={`lineup-games${tone}`} aria-label={`${games.estimated ? 'Estimated' : 'Projected'} games: ${games.projected} of ${games.cap ?? 'unknown'}. ${gamesCapStatus(games)}. ${games.played} played, ${games.remaining} to go.`}>
      <span className="lineup-games-top"><b>{games.estimated ? '~' : ''}{games.projected}{games.cap !== null && `/${games.cap}`}</b><strong>{games.difference === 0 ? 'at cap' : gamesCapStatus(games).replace(' cap', '')}</strong></span>
      <small>{games.played} played · {games.remaining} to go</small>
    </div>
  );
}
