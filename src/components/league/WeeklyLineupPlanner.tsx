import ProjectionEvaluation from './ProjectionEvaluation.js';
import { useExpectedPoints } from '../../hooks/useScores.js';
import MatchupTables from './MatchupTables.js';
import { useMatchupProjection } from '../../hooks/useMatchupProjection.js';
import { projectionExplanation } from '../../lib/league/matchupProjection.js';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGamesCaps, apiErrorMessage } from '../../lib/league/api.js';
import { capForWeek } from '../../lib/league/gamesCap.js';
import { useScoresWeek } from '../../hooks/useScores.js';
import type { LineupSnapshot } from '../../lib/league/lineup.js';
import { planWeeklyLineup } from '../../lib/league/weeklyLineup.js';
import { weeklyPlayerGames } from '../../lib/league/weeklySchedule.js';
import { shortName } from '../../lib/league/scores.js';
import TeamLogo from './TeamLogo.js';
import NavIcon from './NavIcon.js';
import { WeekPicker } from './ScoresBits.js';

export default function WeeklyLineupPlanner({ snapshot }: { snapshot: LineupSnapshot }) {
  const [requested, setRequested] = useState<number | null>(null);
  const query = useScoresWeek(requested, false);
  const caps = useQuery({ queryKey: ['games-caps'], queryFn: fetchGamesCaps, staleTime: 60_000 });
  const week = query.data;
  const matchup = useMatchupProjection(week);
  const baseline = useExpectedPoints();
  const [experimental, setExperimental] = useState(false);
  const expected = experimental ? matchup.expected : baseline;
  const { project } = matchup;
  const side = week?.matchups.flatMap(m => [m.home, m.away]).find(s => s.teamId === snapshot.teamId);
  const cap = week && caps.data ? capForWeek(caps.data.caps.filter(row => row.season === week.season), week.matchupPeriodId, week.gamesCap) : null;
  const plan = useMemo(() => side && week && cap !== null ? planWeeklyLineup(snapshot, side, week, cap, expected) : null, [snapshot, side, week, cap, expected]);
  const rows = useMemo(() => snapshot.players.map(player => {
    const scoring = side?.players.find(p => p.id === player.id);
    return { player, scoring, games: scoring && week && plan ? weeklyPlayerGames(scoring, week, expected, plan.starts).map(game => ({ ...game, projection: project(scoring, game.period) })) : [] };
  }), [snapshot, side, week, expected, plan, project]);
  const upcoming = rows.flatMap(row => row.games).filter(game => !game.locked);
  const adjusted = upcoming.filter(game => game.projection.source === 'matchup').length;
  const gameColumns = Math.max(1, ...rows.map(row => row.games.length));
  return <section className="weekly-planner panel" aria-labelledby="weekly-planner-title">
    <h2 id="weekly-planner-title">{side?.name ?? 'Weekly projections'}</h2>
    <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requested} onChange={setRequested} />
    {(query.isPending || caps.isPending) && <p role="status">Loading schedule and weekly limit…</p>}
    {(query.isError || caps.isError) && <p role="alert">{apiErrorMessage(query.error ?? caps.error)} <button className="tap-btn" onClick={() => { void query.refetch(); void caps.refetch(); }}>Retry</button></p>}
    {week && !side && <p>No matchup found for your team this week.</p>}
    <label className="my-team-model-choice"><input type="checkbox" checked={experimental} onChange={event => setExperimental(event.target.checked)} /> Use matchup model (experimental)</label>
    {plan && week && <>
      <p className="weekly-compact-total"><span><strong>{plan.used + plan.starts.length} / {cap}</strong> planned</span><span>{plan.projectedTotal.toFixed(1)} projected points</span></p>
      {plan.warnings.map(w => <p role="status" key={w}>{w}</p>)}
      <p className="weekly-compact-key"><strong className="weekly-start-key">Teal + bold = start</strong><span>Muted = bench</span><span><NavIcon name="lock" size={10} /> Locked / completed</span></p>
      <div className="weekly-game-scroll" tabIndex={0} role="region" aria-label="Player game schedule; scroll horizontally for more games">
        <table className="weekly-game-table"><caption className="sr-only">Each player's scheduled games, projected fantasy points, and recommended starts. Games are packed chronologically without off-day gaps.</caption>
          <thead><tr><th scope="col" className="weekly-player-cell">Player</th>{Array.from({ length: gameColumns }, (_, i) => <th scope="col" key={i}>Game {i + 1}</th>)}</tr></thead>
          <tbody>{rows.map(({ player, scoring, games }) => {
            return <tr key={player.id}>
              <th scope="row" className="weekly-player-cell" title={player.name}><span className="weekly-player-label"><TeamLogo code={scoring?.proTeam ?? null} size={14} /><span className="weekly-player-name">{shortName(player.name)}</span></span></th>
              {games.map(game => {
                const date = `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${game.date}T12:00:00Z`))} ${Number(game.date.slice(8))}`;
                const opponent = `${game.home ? 'vs' : '@'} ${game.opponent || 'TBD'}`;
                const state = game.status === 'final' ? game.actual !== null ? `${game.actual.toFixed(1)} actual` : game.played === false ? 'DNP' : 'Final' : game.status === 'live' ? 'Live' : game.locked ? 'Locked' : game.recommended ? 'Recommended start' : 'Bench';
                return <td key={game.period}><div className={`weekly-game-card${game.recommended ? ' is-recommended' : ''}${game.locked ? ' is-locked' : game.recommended ? '' : ' is-benched'}`} title={`${date}, ${opponent}, ${state}. ${projectionExplanation(!experimental && game.projection.source === 'matchup' ? { ...game.projection, source: 'baseline' } : game.projection)}`} aria-label={`${player.name}, ${game.date}, ${opponent}, ${game.projected?.toFixed(1) ?? 'unavailable'} projected points, ${state}, ${projectionExplanation(!experimental && game.projection.source === 'matchup' ? { ...game.projection, source: 'baseline' } : game.projection)}${game.recommended && game.slot ? ` at ${game.slot}` : ''}`}>
                  <span className="weekly-game-opponent">{game.locked && <NavIcon name="lock" size={9} />}{opponent}</span>
                  <strong className="weekly-game-points">{game.projected?.toFixed(1) ?? '\u2014'}</strong>
                </div></td>;
              })}
              {games.length < gameColumns && <td colSpan={gameColumns - games.length} className="weekly-no-games">{games.length === 0 ? scoring ? week.days.some(day => day.games === null) ? 'Schedule unavailable' : 'No games scheduled' : 'Player data unavailable' : null}</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="my-team-footnote">{matchup.loading ? 'Loading matchup estimates...' : experimental && adjusted > 0 ? `Pace + position estimates: ${adjusted}/${upcoming.length} upcoming games.` : 'ESPN daily / baseline estimates; no matchup adjustments.'} Opponent / projected points. Swipe for more games.</p>
    </>}
    <ProjectionEvaluation />
    {week && <MatchupTables season={week.season} scoring={week.scoringItems} />}
  </section>;
}
