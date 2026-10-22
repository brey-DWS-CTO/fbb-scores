import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useDailyScorers } from '../../hooks/useDailyScorers.js';
import { teamFullName, normalizeTeam } from '../../lib/league/houseParty.js';
import { statLine } from '../../lib/league/partyScore.js';
import { localDateIso } from '../../lib/league/scores.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

export default function NbaGameScoresPage() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const performersReturn = returnTo?.startsWith('/scores/performers?') === true;
  const date = params.get('date') ?? localDateIso(new Date());
  const team = normalizeTeam(params.get('team'));
  const selected = params.get('player');
  const { query, rows, rosters } = useDailyScorers(date);
  const [sort, setSort] = useState('fantasy');
  const data = query.data;
  const game = data?.games.find(entry => gameId ? entry.id === gameId : entry.home === team || entry.away === team);
  const box = data?.boxScores.find(entry => entry.gameId === game?.id);
  const gameRows = rows.filter(row => row.gameId === game?.id);
  if (sort === 'nba') gameRows.sort((a, b) => (b.stats['0'] ?? 0) - (a.stats['0'] ?? 0) || b.fpts - a.fpts);
  return <div className="mock-page scores-page nba-game-page">
    <Link className="score-back hub-heading" to={(performersReturn || returnTo?.startsWith('/scores?')) && returnTo ? returnTo : '/scores'}>{performersReturn ? '← TOP PERFORMERS' : '← SCORES'}</Link>
    {query.isLoading && <p role="status">Loading NBA game…</p>}
    {query.isError && <p role="alert">Could not load this game. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Try again</button></p>}
    {data?.error && <p role="status">{data.error}</p>}
    {data && !game && <p>No NBA game found for this player on this date.</p>}
    {game && <>
      <section className="panel nba-game-header">
        <p>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {game.state === 'in' ? 'LIVE · ' : ''}{box?.detail || (game.state === 'pre' ? tipoffText(game.tipoff) : game.detail)}</p>
        <h1 className="nba-game-title">{game.away} at {game.home}</h1>
        <div className="nba-game-scoreboard">{[game.away, game.home].map(code => <div key={code}><TeamLogo code={code} size={40} /><span>{teamFullName(code)}</span><strong>{(code === game.home ? box?.homeScore ?? game.homeScore : box?.awayScore ?? game.awayScore) ?? '—'}</strong></div>)}</div>
      </section>
      <div className="nba-game-sort"><h2>Game scorers</h2><label>Rank by <select className="hub-input" value={sort} onChange={event => setSort(event.target.value)}><option value="fantasy">Fantasy points</option><option value="nba">NBA points</option></select></label></div>
      {gameRows.length === 0 && <p>{game.state === 'pre' ? 'Player scores appear after tip-off.' : 'Player stats are not available yet. This page updates automatically.'}</p>}
      <div className="nba-game-teams">{[game.away, game.home].map(code => <section className="panel" key={code} aria-label={`${teamFullName(code)} scorers`}>
        <h3><TeamLogo code={code} size={24} />{teamFullName(code)}</h3>
        <div className="daily-scorer-columns"><span>Player</span><span>FPTS / PTS</span></div>
        <ol className="daily-scorer-list">{gameRows.filter(row => row.team === code).map(row => <li key={row.athleteId} className={`nba-game-player${row.athleteId === selected ? ' is-selected' : ''}`}>
          <span className="daily-scorer-info"><strong>{row.name}{row.athleteId === selected && <span className="nba-selected-label">Selected</span>}</strong><small>{rosters ? row.roster?.name ?? 'Not rostered' : 'Roster unknown'}</small><small>{statLine(row.stats) || 'No counting stats yet'}</small></span>
          <span className="daily-scorer-total"><strong>{row.fpts.toFixed(1)}</strong><small>{row.stats['0'] ?? 0} PTS</small></span>
        </li>)}</ol>
        {gameRows.length > 0 && !gameRows.some(row => row.team === code) && <p>No player stats available.</p>}
      </section>)}</div>
      <p className="daily-scorers-note">Fantasy points use league scoring. Includes every player who has played, regardless of fantasy roster or lineup. Updates every minute.</p>
    </>}
  </div>;
}
