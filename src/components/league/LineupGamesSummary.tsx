import { gamesCapStatus, lineupGames, lineupGamesThrough } from '../../lib/league/lineupGames.js';
import type { ScoreSide, ScoresWeek } from '../../lib/league/scores.js';

/** With `onOver`, an over-cap status is a button that jumps to the overage day; `overDay` names that day for screen readers. `brief` drops the played/to go line. */
export default function LineupGamesSummary({ side, week, onOver, overDay, brief, through }: { side: ScoreSide; week: ScoresWeek; onOver?: () => void; overDay?: string; brief?: boolean; through?: number }) {
  const games = lineupGames(side, week);
  const selectedDay = week.days.find(day => day.scoringPeriodId === through);
  const throughDate = selectedDay ? new Date(`${selectedDay.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  const tone = games.difference === null ? '' : games.difference > 0 ? ' is-over' : games.difference < 0 ? ' is-under' : ' is-at';
  return (
    <div className={`lineup-games${tone}`} aria-label={`${games.estimated ? 'Estimated' : 'Projected'} games: ${games.projected} of ${games.cap ?? 'unknown'}. ${gamesCapStatus(games)}. ${games.played} played, ${games.remaining} to go.`}>
      <span className="lineup-games-top"><b>{games.estimated ? '~' : ''}{games.projected} projected games</b>{onOver && (games.difference ?? 0) > 0
        ? <button type="button" className="lineup-games-over" aria-label={`${gamesCapStatus(games)}. Show the overage${overDay ? ` on ${overDay}` : ''}`} onClick={onOver}>{gamesCapStatus(games)}</button>
        : <strong>{gamesCapStatus(games)}</strong>}</span>
      <small className="lineup-games-cap">Weekly cap: {games.cap === null ? 'unavailable' : `${games.cap} games`}</small>
      {!brief && <small><b>{games.played}</b> played so far · <b>{games.remaining}</b> remaining</small>}
      {through !== undefined && throughDate && <small className="lineup-games-through">By {throughDate}: <b>{lineupGamesThrough(side, week, through)}</b> {through >= week.currentScoringPeriodId ? 'expected games' : 'games played'}</small>}
    </div>
  );
}
