import { gamesCapStatus, lineupGames } from '../../lib/league/lineupGames.js';
import type { ScoreSide, ScoresWeek } from '../../lib/league/scores.js';

export default function LineupGamesSummary({ side, week }: { side: ScoreSide; week: ScoresWeek }) {
  const games = lineupGames(side, week);
  const tone = games.difference === null ? '' : games.difference > 0 ? ' is-over' : games.difference < 0 ? ' is-under' : ' is-at';
  return (
    <div className={`lineup-games${tone}`}>
      <span>{games.estimated ? 'Est.' : 'Projected'} games <b>{games.projected}</b>{games.cap !== null && ` / ${games.cap}`}</span>
      <strong>{gamesCapStatus(games)}</strong>
      <small>{games.played} played + {games.remaining} remaining</small>
    </div>
  );
}
