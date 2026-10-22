import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTopPerformers } from '../../hooks/useTopPerformers.js';
import { filterScorers, nbaGameHref } from '../../lib/league/dailyScorers.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

export default function TopPerformersPage() {
  const [params, setParams] = useSearchParams();
  const weekly = params.get('period') === 'week';
  const { query, rows, rosters, teams, rosterQuery, today: date, dates, gameDates } = useTopPerformers(weekly);
  const [expanded, setExpanded] = useState(false);
  const status = params.get('roster') ?? 'all';
  const team = params.get('fantasyTeam') ?? 'all';
  const shown = filterScorers(rows, rosters ? status : 'all', rosters ? team : 'all');
  const changeFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === 'fantasyTeam' && value !== 'all') next.set('roster', 'rostered');
    if (key === 'roster' && value === 'free') next.delete('fantasyTeam');
    setExpanded(false);
    setParams(next, { replace: true });
  };
  const data = query.data;
  return <div className="mock-page scores-page top-performers-page">
    <Link className="score-back hub-heading" to="/scores">← SCORES</Link>
    <section id="top-performers" className="panel daily-scorers" aria-labelledby="top-performers-title">
    <div className="daily-scorers-heading"><div><h1 id="top-performers-title">Top Performers</h1><p>Fantasy points · {weekly ? `${dates[0]} – ${date}` : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div>
      <button type="button" className="tap-btn mock-mini-btn" disabled={query.isFetching} onClick={() => { void query.refetch(); void rosterQuery.refetch(); }}>Refresh</button></div>
    <div className="top-performers-period" role="group" aria-label="Performance period">
      <button type="button" className="tap-btn mock-mini-btn" aria-pressed={!weekly} onClick={() => changeFilter('period', 'today')}>Today</button>
      <button type="button" className="tap-btn mock-mini-btn" aria-pressed={weekly} onClick={() => changeFilter('period', 'week')}>Weekly</button>
    </div>
    {weekly && <p className="daily-scorers-note">Week-to-date totals. Tap a player to open their latest game.</p>}
    <div className="daily-scorers-filters">
      <label>Roster status<select className="hub-input" value={status} disabled={!rosters} onChange={event => changeFilter('roster', event.target.value)}>
        <option value="all">All players</option><option value="rostered">Rostered</option><option value="free">Not rostered</option>
      </select></label>
      <label>Fantasy team<select className="hub-input" value={team} disabled={!rosters} onChange={event => changeFilter('fantasyTeam', event.target.value)}>
        <option value="all">All fantasy teams</option>{teams.map(side => <option key={side.teamId} value={String(side.teamId)}>{side.name}</option>)}
      </select></label>
    </div>
    {!rosters && <p className="daily-scorers-note">{rosterQuery.isLoading ? 'Loading current fantasy rosters…' : 'Current fantasy rosters unavailable. Showing all NBA players.'}</p>}
    {query.isLoading && <p role="status">Loading performances…</p>}
    {query.isError && <p role="alert">Could not load NBA scores. Try Refresh.</p>}
    {data?.error && <p role="status" className="daily-scorers-note">{data.error}</p>}
    {data && shown.length > 0 && <>
      <div className="daily-scorer-columns"><span>{weekly ? 'Player / games' : 'Player / game'}</span><span>FPTS</span></div>
      <ol className="daily-scorer-list">{(expanded ? shown : shown.slice(0, 10)).map((row, index) => {
        const game = data.games.find(entry => entry.id === row.gameId);
        return <li key={`${row.gameId}:${row.athleteId}`}><Link className="daily-scorer-row" state={{ returnTo: `/scores/performers?${params}` }} to={nbaGameHref(row.date, { gameId: row.gameId, player: row.athleteId })}>
          <span className="daily-scorer-rank">{index + 1}</span><TeamLogo code={row.team} size={22} />
          <span className="daily-scorer-info"><strong>{row.name}</strong><small>{rosters ? row.roster?.name ?? 'Not rostered' : 'Roster unknown'}</small><small>{weekly && `${row.gamesPlayed} GP · Latest: `}{game ? `${game.away} @ ${game.home} · ${game.state === 'in' ? 'LIVE · ' : ''}${game.detail}` : row.team}</small></span>
          <span className="daily-scorer-total"><strong>{row.fpts.toFixed(1)}</strong><small>{row.stats['0'] ?? 0} PTS</small></span>
        </Link></li>;
      })}</ol>
      {shown.length > 10 && <button type="button" className="tap-btn mock-mini-btn daily-scorers-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show top 10' : `Show all ${shown.length} players`}</button>}
    </>}
    {data && shown.length === 0 && !query.isError && <p className="daily-scorers-note">{rows.length > 0 ? 'No scorers match these filters.' : data.games.length === 0 ? 'No NBA games in this period.' : data.games.every(game => game.state === 'pre') ? 'Scores appear once games begin.' : 'Waiting for player stats from ESPN.'}</p>}
    {data && rows.length === 0 && data.games.length > 0 && <div className="daily-game-links">{data.games.map(game => <Link key={game.id} state={{ returnTo: `/scores/performers?${params}` }} to={nbaGameHref(gameDates.get(game.id) ?? date, { gameId: game.id })}>{game.away} @ {game.home}<small>{game.state === 'pre' ? tipoffText(game.tipoff) : game.detail}</small></Link>)}</div>}
  </section></div>;
}
