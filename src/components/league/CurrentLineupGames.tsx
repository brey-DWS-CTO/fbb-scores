import { useGamesCaps, useScoresWeek } from '../../hooks/useScores.js';
import { leagueDataset } from '../../lib/league/data.js';
import { todayIso } from '../../lib/league/navSections.js';
import { beforeSeason, ownerByEspnTeamId } from '../../lib/league/scores.js';
import LineupGamesSummary from './LineupGamesSummary.js';

/** The same weekly lineup forecast shown on the score cards. */
export default function CurrentLineupGames() {
  const query = useScoresWeek(null, false, !beforeSeason(todayIso()));
  const { capFor } = useGamesCaps();
  const loaded = query.data;
  if (query.isLoading) return <p className="mock-intro">Loading this week’s lineup games...</p>;
  if (query.isError) return <p className="mock-intro">This week’s lineup games are unavailable. <button type="button" className="tap-btn" onClick={() => { void query.refetch(); }}>Retry</button></p>;
  if (!loaded || loaded.matchups.length === 0) return null;
  const week = { ...loaded, gamesCap: capFor(loaded.matchupPeriodId, loaded.gamesCap) };
  const owners = ownerByEspnTeamId(leagueDataset.teams);
  return (
    <section className="panel lineup-games-panel" aria-label="Current lineup games this week">
      <h2 className="hub-heading">THIS WEEK’S LINEUP GAMES</h2>
      <p>Games played plus games left in the current lineup, before the cap. Bench and IR do not count. Out and suspended players have no projected games.</p>
      <div className="lineup-games-teams">
        {week.matchups.flatMap((matchup) => [matchup.home, matchup.away]).map((side) => (
          <div key={side.teamId}><b>{owners.get(side.teamId) ?? side.name}</b><LineupGamesSummary side={side} week={week} /></div>
        ))}
      </div>
    </section>
  );
}
