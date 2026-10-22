import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useTopPerformers } from '../../hooks/useTopPerformers.js';
import { filterScorers, matchesPlayerName, nbaGameHref } from '../../lib/league/dailyScorers.js';
import { localDateIso, seasonStartDate } from '../../lib/league/scores.js';
import { fetchPerformerDates, fetchPlayerPool } from '../../lib/league/api.js';
import { leagueDataset } from '../../lib/league/data.js';
import { playerPoolFromDataset } from '../../lib/league/playerPool.js';
import { normalizeTeam } from '../../lib/league/houseParty.js';
import { statLine } from '../../lib/league/partyScore.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

const FALLBACK_SEARCH_PLAYERS = playerPoolFromDataset(leagueDataset.players);

export default function TopPerformersPage() {
  const [params, setParams] = useSearchParams();
  const weekly = params.get('period') === 'week';
  const today = localDateIso(new Date());
  const calendar = useQuery({ queryKey: ['performer-dates', today], queryFn: fetchPerformerDates, staleTime: 60 * 60_000, retry: 1 });
  const gameDays = calendar.data ?? [today];
  const requestedDate = params.get('date') ?? today;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= seasonStartDate() && requestedDate <= today
    && (!calendar.data || gameDays.includes(requestedDate));
  const selectedDate = validDate ? requestedDate : today;
  const { query, rows, rosters, teams, rosterQuery, date, dates, gameDates } = useTopPerformers(weekly, selectedDate);
  const previousDay = gameDays.filter(day => day < date).at(-1);
  const nextDay = gameDays.find(day => day > date);
  const [expanded, setExpanded] = useState(false);
  const status = params.get('roster') ?? 'all';
  const team = params.get('fantasyTeam') ?? 'all';
  const search = params.get('search') ?? '';
  const searching = search.trim().length > 0;
  const poolQuery = useQuery({ queryKey: ['performer-player-pool'], queryFn: () => fetchPlayerPool(), enabled: searching, staleTime: 5 * 60_000 });
  const shown = filterScorers(rows, rosters ? status : 'all', rosters ? team : 'all').filter(row => matchesPlayerName(row.name, search));
  const changeFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === 'fantasyTeam' && value !== 'all') next.set('roster', 'rostered');
    if (key === 'roster' && value === 'free') next.delete('fantasyTeam');
    setExpanded(false);
    setParams(next, { replace: true });
  };
  const data = query.data;
  const pool = poolQuery.data?.snapshot.players ?? FALLBACK_SEARCH_PLAYERS;
  const scoredIds = new Set(rows.map(row => row.athleteId));
  const otherMatches = searching ? pool.filter(player => {
    if (scoredIds.has(String(player.espnId)) || !matchesPlayerName(player.fullName, search)) return false;
    const roster = rosters?.get(String(player.espnId));
    return (!rosters || (status === 'rostered' ? !!roster : status === 'free' ? !roster : true))
      && (!rosters || team === 'all' || String(roster?.teamId) === team);
  }).sort((a, b) => a.fullName.localeCompare(b.fullName)) : [];
  return <div className="mock-page scores-page top-performers-page">
    <Link className="score-back hub-heading" to="/scores">← SCORES</Link>
    <section id="top-performers" className="panel daily-scorers" aria-labelledby="top-performers-title">
    <div className="daily-scorers-heading"><div><h1 id="top-performers-title">Top Performers</h1><p>Fantasy points · {weekly ? `${dates[0]} – ${date}` : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div>
      <button type="button" className="tap-btn mock-mini-btn" disabled={query.isFetching} onClick={() => { void query.refetch(); void rosterQuery.refetch(); }}>Refresh</button></div>
    <div className="top-performers-period" role="group" aria-label="Performance period">
      <button type="button" className="tap-btn mock-mini-btn" aria-pressed={!weekly} onClick={() => changeFilter('period', 'today')}>Daily</button>
      <button type="button" className="tap-btn mock-mini-btn" aria-pressed={weekly} onClick={() => changeFilter('period', 'week')}>Weekly</button>
    </div>
    <div className="nba-scoreboard-date" role="group" aria-label="Performance date">
      <button type="button" className="tap-btn mock-mini-btn" aria-label="Previous game day" disabled={!previousDay} onClick={() => previousDay && changeFilter('date', previousDay)}>‹</button>
      <select className="hub-input" aria-label="Performance date" value={date} disabled={calendar.isPending} onChange={event => changeFilter('date', event.target.value)}>
        {[...gameDays].reverse().map(day => <option key={day} value={day}>{day === today ? 'Today' : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
      </select>
      <button type="button" className="tap-btn mock-mini-btn" aria-label="Next game day" disabled={!nextDay} onClick={() => nextDay && changeFilter('date', nextDay)}>›</button>
      {date !== today && <button type="button" className="tap-btn mock-mini-btn" onClick={() => changeFilter('date', today)}>Today</button>}
    </div>
    {calendar.isError && <p role="status" className="daily-scorers-note">Game-day calendar unavailable. <button type="button" className="tap-btn mock-mini-btn" onClick={() => void calendar.refetch()}>Retry</button></p>}
    {weekly && <p className="daily-scorers-note">Week through the selected day. Tap a player to open their latest game.</p>}
    <div className="top-performers-search"><label htmlFor="performer-search">Search players</label>
      <div><input id="performer-search" className="hub-input" type="search" aria-label="Search players" placeholder="Search any player…" value={search} onChange={event => changeFilter('search', event.target.value)} autoComplete="off" />
      {search && <button type="button" className="tap-btn mock-mini-btn" onClick={() => changeFilter('search', '')}>Clear</button>}</div>
    </div>
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
          <span className="daily-scorer-info"><strong>{row.name}</strong><small>{rosters ? row.roster?.name ?? 'Not rostered' : 'Roster unknown'}</small><small>{weekly && `${row.gamesPlayed} GP · Latest: `}{game ? `${game.away} @ ${game.home} · ${game.state === 'in' ? 'LIVE · ' : ''}${game.detail}` : row.team}</small>{searching && <small>{statLine(row.stats)}</small>}</span>
          <span className="daily-scorer-total"><strong>{row.fpts.toFixed(1)}</strong><small>{row.stats['0'] ?? 0} PTS</small></span>
        </Link></li>;
      })}</ol>
      {shown.length > 10 && <button type="button" className="tap-btn mock-mini-btn daily-scorers-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show top 10' : `Show all ${shown.length} players`}</button>}
    </>}
    {searching && poolQuery.isFetching && <p role="status" className="daily-scorers-note">Searching the player list…</p>}
    {searching && poolQuery.isError && <p className="daily-scorers-note">Live player list unavailable. Searching the saved player list.</p>}
    {data && otherMatches.length > 0 && <div className="performer-search-matches"><h2>Other matching players</h2><ul className="daily-scorer-list">{otherMatches.slice(0, 30).map(player => {
      const code = normalizeTeam(player.proTeam);
      const game = [...data.games].reverse().find(entry => entry.home === code || entry.away === code);
      const id = String(player.espnId);
      const line = data.boxScores.find(box => box.gameId === game?.id)?.lines.find(entry => entry.athleteId === id);
      const description = query.isLoading ? 'Loading game status…' : !game && data.error ? 'Game status unavailable' : !game ? (weekly ? 'No games played this week' : 'No game today') : game.state === 'pre' ? `Tip-off ${tipoffText(game.tipoff) ?? 'TBD'}` : game.state === 'post' && line && !line.played ? 'Did not play' : game.state === 'in' && line && !line.played ? 'Has not played yet' : 'Player stats not available yet';
      const content = <><TeamLogo code={code} size={22} /><span className="daily-scorer-info"><strong>{player.fullName}</strong><small>{rosters ? rosters.get(id)?.name ?? 'Not rostered' : 'Roster unknown'}</small><small>{description}{game && ` · ${game.away} @ ${game.home}`}</small></span></>;
      return <li key={id}>{game ? <Link className="daily-scorer-row" state={{ returnTo: `/scores/performers?${params}` }} to={nbaGameHref(gameDates.get(game.id) ?? date, { gameId: game.id, player: id })}>{content}</Link> : <div className="daily-scorer-row">{content}</div>}</li>;
    })}</ul>{otherMatches.length > 30 && <p className="daily-scorers-note">Keep typing to narrow {otherMatches.length} matching players.</p>}</div>}
    {data && shown.length === 0 && otherMatches.length === 0 && !query.isError && <p role="status" className="daily-scorers-note">{searching ? 'No players match this search and the selected filters.' : rows.length > 0 ? 'No scorers match these filters.' : data.games.length === 0 ? 'No NBA games in this period.' : data.games.every(game => game.state === 'pre') ? 'Scores appear once games begin.' : 'Waiting for player stats from ESPN.'}</p>}
    {data && !searching && rows.length === 0 && data.games.length > 0 && <div className="daily-game-links">{data.games.map(game => <Link key={game.id} state={{ returnTo: `/scores/performers?${params}` }} to={nbaGameHref(gameDates.get(game.id) ?? date, { gameId: game.id })}>{game.away} @ {game.home}<small>{game.state === 'pre' ? tipoffText(game.tipoff) : game.detail}</small></Link>)}</div>}
  </section></div>;
}
