import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGamesCaps, apiErrorMessage } from '../../lib/league/api.js';
import { capForWeek } from '../../lib/league/gamesCap.js';
import { useScoresWeek, useExpectedPoints } from '../../hooks/useScores.js';
import type { LineupSnapshot } from '../../lib/league/lineup.js';
import { planWeeklyLineup } from '../../lib/league/weeklyLineup.js';
import { weeklyPlayerGames } from '../../lib/league/weeklySchedule.js';
import { WeekPicker } from './ScoresBits.js';

export default function WeeklyLineupPlanner({ snapshot }: { snapshot: LineupSnapshot }) {
  const [requested, setRequested] = useState<number | null>(null);
  const query = useScoresWeek(requested, false);
  const caps = useQuery({ queryKey: ['games-caps'], queryFn: fetchGamesCaps, staleTime: 60_000 });
  const expected = useExpectedPoints();
  const week = query.data;
  const side = week?.matchups.flatMap(m => [m.home, m.away]).find(s => s.teamId === snapshot.teamId);
  const cap = week && caps.data ? capForWeek(caps.data.caps.filter(row => row.season === week.season), week.matchupPeriodId, week.gamesCap) : null;
  const plan = useMemo(() => side && week && cap !== null ? planWeeklyLineup(snapshot, side, week, cap, expected) : null, [snapshot, side, week, cap, expected]);
  const rows = useMemo(() => snapshot.players.map(player => {
    const scoring = side?.players.find(p => p.id === player.id);
    return { player, scoring, games: scoring && week && plan ? weeklyPlayerGames(scoring, week, expected, plan.starts) : [] };
  }), [snapshot, side, week, expected, plan]);
  const gameColumns = Math.max(1, ...rows.map(row => row.games.length));
  return <section className="weekly-planner panel" aria-labelledby="weekly-planner-title">
    <h2 id="weekly-planner-title">{side?.name ?? 'Weekly projections'}</h2>
    <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requested} onChange={setRequested} />
    {(query.isPending || caps.isPending) && <p role="status">Loading schedule and weekly limit…</p>}
    {(query.isError || caps.isError) && <p role="alert">{apiErrorMessage(query.error ?? caps.error)} <button className="tap-btn" onClick={() => { void query.refetch(); void caps.refetch(); }}>Retry</button></p>}
    {week && !side && <p>No matchup found for your team this week.</p>}
    {plan && week && <>
      <div className="weekly-planner-totals"><div><strong>{plan.used + plan.starts.length}<small> / {cap}</small></strong><span>Games - {plan.used} started</span></div><div><strong>{plan.projectedTotal.toFixed(1)}</strong><span>Projected points</span></div></div>
      <details className="weekly-planner-help"><summary>How projections work</summary><p>Best remaining starts within daily slots and the weekly cap, using Scores estimates. Out and reserve players are excluded. Live games use the greater of current points and the pregame estimate. Full-week points include every scheduled game; suggested points cover remaining recommended starts. Recommendations do not change your roster.</p></details>
      {plan.warnings.map(w => <p role="status" key={w}>{w}</p>)}
      <div className="weekly-game-legend"><span className="weekly-start-badge">START</span><span>Recommended start</span><span className="weekly-swipe-hint">Swipe games horizontally</span></div>
      <div className="weekly-game-scroll" tabIndex={0} role="region" aria-label="Player game schedule; scroll horizontally for more games">
        <table className="weekly-game-table"><caption className="sr-only">Each player's scheduled games, projected fantasy points, and recommended starts. Games are packed chronologically without off-day gaps.</caption>
          <thead><tr><th scope="col" className="weekly-player-cell">Player</th>{Array.from({ length: gameColumns }, (_, i) => <th scope="col" key={i}>Game {i + 1}</th>)}</tr></thead>
          <tbody>{rows.map(({ player, scoring, games }) => {
            const total = games.reduce((sum, game) => sum + (game.projected ?? 0), 0);
            const selected = games.filter(game => game.recommended).length;
            return <tr key={player.id}>
              <th scope="row" className="weekly-player-cell"><span className="weekly-player-name">{player.name}</span><span className="weekly-player-meta">{scoring ? `${scoring.proTeam} ${scoring.position}` : 'Stats unavailable'}{scoring?.injuryStatus && !['ACTIVE', 'NORMAL', 'HEALTHY'].includes(scoring.injuryStatus) && <span className="weekly-injury"> {scoring.injuryStatus}</span>}</span><span className="weekly-player-total">{games.length} games / {games.length && games.every(game => game.projected !== null) ? total.toFixed(1) : '\u2014'} proj{selected > 0 ? ` / ${selected} starts` : ''}</span></th>
              {games.map(game => {
                const date = `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${game.date}T12:00:00Z`))} ${Number(game.date.slice(8))}`;
                const opponent = `${game.home ? 'vs' : '@'} ${game.opponent || 'TBD'}`;
                const state = game.status === 'final' ? game.actual !== null ? `${game.actual.toFixed(1)} actual` : game.played === false ? 'DNP' : 'Final' : game.status === 'live' ? 'Live' : game.recommended ? 'Recommended start' : 'Not selected';
                return <td key={game.period}><div className={`weekly-game-card${game.recommended ? ' is-recommended' : ''}${game.status !== 'upcoming' ? ' is-started' : ''}`} aria-label={`${player.name}, ${game.date}, ${opponent}, ${game.projected?.toFixed(1) ?? 'unavailable'} projected points, ${state}${game.recommended && game.slot ? ` at ${game.slot}` : ''}`}>
                  <span className="weekly-game-date">{date}</span><span className="weekly-game-opponent">{opponent}</span>
                  <strong className="weekly-game-points">{game.projected?.toFixed(1) ?? '\u2014'}<small> proj</small></strong>
                  <span className="weekly-game-state">{game.recommended ? <span className="weekly-start-badge">START</span> : game.status === 'final' ? game.actual !== null ? `${game.actual.toFixed(1)} final` : game.played === false ? 'DNP' : 'Final' : game.status === 'live' ? 'LIVE' : '\u00a0'}</span>
                </div></td>;
              })}
              {games.length < gameColumns && <td colSpan={gameColumns - games.length} className="weekly-no-games">{games.length === 0 ? scoring ? week.days.some(day => day.games === null) ? 'Schedule unavailable' : 'No games scheduled' : 'Player data unavailable' : null}</td>}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="my-team-footnote">Each row shows only that player’s games, in date order. START marks a recommended remaining game. Proj is fantasy points; final scores appear separately.</p>
    </>}
  </section>;
}
