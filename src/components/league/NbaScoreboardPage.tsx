import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchDailyScorers } from '../../lib/league/api.js';
import { nbaGameHref } from '../../lib/league/dailyScorers.js';
import { teamFullName } from '../../lib/league/houseParty.js';
import { addDaysIso, localDateIso } from '../../lib/league/scores.js';
import { sortScoreboardGames } from '../../lib/league/scoreboardOrder.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

export default function NbaScoreboardPage() {
  const [params, setParams] = useSearchParams();
  const today = localDateIso(new Date());
  const requested = params.get('date') ?? today;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(`${requested}T12:00:00Z`))
    && new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) === requested;
  const date = valid ? requested : today;
  const query = useQuery({ queryKey: ['daily-scorers', date], queryFn: () => fetchDailyScorers(date), staleTime: 30_000, refetchInterval: 60_000, retry: 1 });
  const data = query.data;
  const setDate = (value: string) => { if (value) setParams({ date: value }); };
  return <main className="mock-page scores-page nba-scoreboard-page">
    <Link className="score-back hub-heading" to="/scores">← FANTASY SCORES</Link>
    <div className="daily-scorers-heading nba-scoreboard-heading"><div><h1>NBA Scoreboard</h1><p>Real game scores · Tap a game for player fantasy points.</p></div><button type="button" className="tap-btn mock-mini-btn" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button></div>
    <div className="nba-scoreboard-date" role="group" aria-label="Scoreboard date">
      <button type="button" className="tap-btn mock-mini-btn" aria-label="Previous day" onClick={() => setDate(addDaysIso(date, -1))}>‹</button>
      <input className="hub-input" type="date" aria-label="NBA scoreboard date" value={date} onChange={event => setDate(event.target.value)} />
      <button type="button" className="tap-btn mock-mini-btn" aria-label="Next day" onClick={() => setDate(addDaysIso(date, 1))}>›</button>
      {date !== today && <button type="button" className="tap-btn mock-mini-btn" onClick={() => setDate(today)}>Today</button>}
    </div>
    {query.isLoading && <p role="status">Loading NBA scores…</p>}
    {query.isError && <p role="alert">Could not load NBA scores. Try Refresh.</p>}
    {data?.error && <p className="daily-scorers-note" role="status">{data.error}</p>}
    {data && data.games.length === 0 && <p>No NBA games on this date.</p>}
    <div className="nba-scoreboard-games">{(data ? sortScoreboardGames(data.games) : []).map(game => {
      const box = data?.boxScores.find(entry => entry.gameId === game.id);
      return <Link key={game.id} className={`panel nba-scoreboard-card${game.state === 'in' ? ' is-live' : ''}`} state={{ returnTo: `/scores/nba-scoreboard?date=${date}` }} to={nbaGameHref(date, { gameId: game.id })} aria-label={`${game.away} at ${game.home}, ${game.state === 'pre' ? 'upcoming' : box?.detail || game.detail}. View player fantasy points`}>
        <div className="nba-scoreboard-status"><strong>{game.state === 'in' ? 'LIVE' : game.state === 'post' ? 'FINAL' : tipoffText(game.tipoff) ?? 'TBD'}</strong><span>{game.state === 'pre' ? game.tv : box?.detail || game.detail}</span></div>
        {[game.away, game.home].map(code => <div className="nba-scoreboard-team" key={code}><TeamLogo code={code} size={30} /><span>{teamFullName(code)}</span><strong>{game.state === 'pre' ? '—' : (code === game.home ? box?.homeScore ?? game.homeScore : box?.awayScore ?? game.awayScore) ?? '—'}</strong></div>)}
        <small className="nba-scoreboard-open">Player fantasy points →</small>
      </Link>;
    })}</div>
    <p className="daily-scorers-note">Updates every minute.</p>
  </main>;
}
