import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { useScoresWeek } from '../../hooks/useScores.js';
import { leagueDataset } from '../../lib/league/data.js';
import { castMatchesTeams, castPoints, sortCastPlays, type FantasyCast } from '../../lib/league/fantasyCast.js';
import { LEAGUE_SCORING } from '../../lib/league/partyScore.js';
import { localDateIso } from '../../lib/league/scores.js';
import './fantasyCast.css';

export default function FantasyCastPage() {
  const [params, setParams] = useSearchParams();
  const [visibleCount, setVisibleCount] = useState(100);
  const { identity } = useIdentity();
  const weekQuery = useScoresWeek(null, false);
  const week = weekQuery.data;
  const today = localDateIso(new Date());
  const requested = params.get('date') ?? today;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(`${requested}T12:00:00Z`)) && new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) === requested ? requested : today;
  const query = useQuery({ queryKey: ['fantasy-cast', date], queryFn: async () => (await axios.get<FantasyCast>('/api/league/fantasy-cast', { params: { date } })).data, staleTime: 15_000, refetchInterval: date === today ? 20_000 : false, retry: 1 });
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setVisibleCount(100); setParams(next, { replace: true }); };
  const mine = leagueDataset.teams.find(team => team.owner === identity?.owner)?.espnTeamId;
  const matchups = week?.matchups ?? [];
  const teams = matchups.flatMap(matchup => [matchup.home, matchup.away]);
  const myMatchup = matchups.find(matchup => matchup.home.teamId === mine || matchup.away.teamId === mine);
  const day = week?.days.find(day => day.date === date);
  const rosters = new Map(teams.flatMap(team => team.players.flatMap(player => {
    const entry = day ? player.days[String(day.scoringPeriodId)] : undefined;
    return entry ? [[String(player.id), { team, started: entry.started }] as const] : [];
  })));
  const scope = params.get('scope') ?? 'all';
  const selectedMatchup = scope === 'matchup' ? myMatchup : matchups.find(matchup => `matchup:${matchup.id}` === scope);
  const ids = scope === 'me' ? [mine] : selectedMatchup ? [selectedMatchup.home.teamId, selectedMatchup.away.teamId] : scope.startsWith('team:') ? [Number(scope.slice(5))] : [];
  const scoring = week?.scoringItems?.length ? week.scoringItems : LEAGUE_SCORING;
  const newest = params.get('order') !== 'oldest';
  const plays = sortCastPlays(query.data?.plays ?? [], newest).filter(play => scope === 'all' || castMatchesTeams(play, ids, rosters, scoring));
  return <main className="mock-page scores-page fantasy-cast-page">
    <Link to="/scores" className="score-back hub-heading">← FANTASY SCORES</Link>
    <div className="cast-heading"><div><span className="cast-eyebrow">{date === today ? 'LIVE PLAY FEED' : 'PLAY REPLAY'}</span><h1>Fantasy Cast</h1><p>Every play. Every point. Your players in the spotlight.</p></div><button className="tap-btn mock-mini-btn" disabled={query.isFetching} onClick={() => { void query.refetch(); void weekQuery.refetch(); }}>Refresh</button></div>
    <div className="cast-controls">
      <label>Date<input className="hub-input" type="date" value={date} onChange={event => { if (event.target.value) change('date', event.target.value); }} /></label>
      <label>Show<select className="hub-input" value={scope} onChange={event => change('scope', event.target.value)}>
        <option value="all">All plays · all games</option><option value="matchup" disabled={!myMatchup || !day}>My matchup · scoring plays</option><option value="me" disabled={mine === undefined || !day}>My team · scoring plays</option>
        {teams.map(team => <option key={team.teamId} value={`team:${team.teamId}`} disabled={!day}>{team.name}</option>)}
        {matchups.map(matchup => <option key={matchup.id} value={`matchup:${matchup.id}`} disabled={!day}>{matchup.home.name} vs {matchup.away.name}</option>)}
      </select></label>
      <label>Order<select className="hub-input" value={newest ? 'newest' : 'oldest'} onChange={event => change('order', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    </div>
    <p className="daily-scorers-note">Updates every 20 seconds today · Highlighted = your roster · Bench plays do not count toward matchups.</p>
    {!day && <p role="status">Roster and matchup filters require a date in the current fantasy week.</p>}
    {weekQuery.isError && <p role="alert">Roster data unavailable. Player highlights and matchup filters may be unavailable.</p>}
    {query.isLoading && <p role="status">Loading the play feed…</p>}
    {query.isError && <p role="alert">Could not load plays. Try Refresh.</p>}
    {query.data?.error && <p role="status">{query.data.error}</p>}
    {query.data && <p className="daily-scorers-note">{plays.length} plays · Updated {new Date(query.data.fetchedAt).toLocaleTimeString()}</p>}
    {query.data && !plays.length && <div className="panel cast-empty">{scope === 'all' ? 'No plays available for this date yet. The feed starts when games tip off.' : 'No scoring plays for this selection yet.'}</div>}
    <ol className="cast-feed">{plays.slice(0, visibleCount).map(play => {
      const own = play.changes.some(change => rosters.get(change.athleteId)?.team.teamId === mine && mine !== undefined);
      return <li key={play.id} className={`panel cast-play${own ? ' cast-mine' : ''}`}>
        <div className="cast-meta"><span>{play.timestamp ? new Date(play.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Time unavailable'} · {play.game}</span><span>Q{play.period} · {play.clock}</span></div>
        <p>{play.text}</p>
        {play.changes.map((change, index) => { const roster = rosters.get(change.athleteId); const points = castPoints(change.stats, scoring); const myPlayer = mine !== undefined && roster?.team.teamId === mine;
          return <div key={`${change.athleteId}:${index}`} className="cast-change"><div><strong>{change.name}</strong> <span>{change.team} · {change.stat}</span><small>{myPlayer ? 'YOUR PLAYER · ' : ''}{roster ? `${roster.team.name}${roster.started ? '' : ' · BENCH'}` : day ? 'Free agent' : 'Roster unavailable'}{Object.keys(change.stats).some(id => ['37', '38', '39'].includes(id)) ? ' · Milestone bonus' : ''}</small></div><strong className={points < 0 ? 'cast-negative' : 'cast-positive'}>{points > 0 ? '+' : ''}{points.toFixed(1)} <small>FPTS</small></strong></div>;
        })}
      </li>;
    })}</ol>
    {plays.length > visibleCount && <button className="tap-btn mock-mini-btn" onClick={() => setVisibleCount(count => count + 100)}>Show more plays ({plays.length - visibleCount} remaining)</button>}
    <p className="daily-scorers-note">Fantasy changes use league scoring. Events without timestamps are grouped by game in play order. Unrecognized stat descriptions remain visible without a points estimate. ESPN corrections and official matchup totals may differ.</p>
  </main>;
}
