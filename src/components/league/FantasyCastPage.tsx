import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { useScoresWeek } from '../../hooks/useScores.js';
import { leagueDataset } from '../../lib/league/data.js';
import { castMatchesTeams, castPoints, sortCastPlays, type FantasyCast } from '../../lib/league/fantasyCast.js';
import { LEAGUE_SCORING } from '../../lib/league/partyScore.js';
import { defaultDay, localDateIso } from '../../lib/league/scores.js';
import { castMatchesGame } from '../../lib/league/castContext.js';
import { numberParam } from './scoresUi.js';
import './fantasyCast.css';
import TeamLogo from './TeamLogo.js';
import CastHoop from './CastHoop.js';
import { castAction, castOwnership, castRunningTotals, castShortName } from '../../lib/league/castPresentation.js';
import { castPollDelay } from '../../lib/league/castPolling.js';

export default function FantasyCastPage({ embedded = false, initialScope = 'all', peek = false }: { embedded?: boolean; initialScope?: string; peek?: boolean }) {
  const [today, setToday] = useState(() => localDateIso(new Date()));
  useEffect(() => {
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const updateDate = () => setToday(localDateIso(new Date()));
    const timer = window.setTimeout(updateDate, midnight.getTime() - Date.now() + 100);
    document.addEventListener('visibilitychange', updateDate);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', updateDate); };
  }, [today]);
  const [routeParams, setRouteParams] = useSearchParams();
  const params = routeParams;
  const [visibleCount, setVisibleCount] = useState(100);
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const weekQuery = useScoresWeek(numberParam(routeParams.get('week')), routeParams.get('demo') === '1', true,
    () => queryClient.getQueryData<FantasyCast>(['fantasy-cast', localDateIso(new Date())])?.schedule?.phase === 'live');
  const week = weekQuery.data;
  const contextualDay = embedded && initialScope.startsWith('matchup:') && week
    ? week.days.find(day => day.scoringPeriodId === (numberParam(routeParams.get('day')) ?? defaultDay(week)))?.date : null;
  const requested = params.get('date') ?? contextualDay ?? today;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(`${requested}T12:00:00Z`)) && new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) === requested ? requested : today;
  const query = useQuery({ queryKey: ['fantasy-cast', date], queryFn: async ({ signal }) => (await axios.get<FantasyCast>('/api/league/fantasy-cast', { params: { date }, signal })).data,
    staleTime: current => {
      const schedule = current.state.data?.schedule;
      if (schedule?.phase === 'complete' || schedule?.phase === 'idle') return schedule.nextPollAt ? 15_000 : Infinity;
      return schedule?.phase === 'waiting' ? Math.max(0, Date.parse(schedule.nextPollAt ?? '') - current.state.dataUpdatedAt) : 15_000;
    },
    refetchInterval: current => date !== today ? false : current.state.data?.schedule ? castPollDelay(current.state.data.schedule, Date.now()) : 30_000,
    refetchIntervalInBackground: false, retry: 1 });
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); if (key === 'game' && /^(game|nba):/.test(params.get('scope') ?? initialScope)) next.set('scope', 'all'); setVisibleCount(100); setRouteParams(next, { replace: true }); };
  const mine = leagueDataset.teams.find(team => team.owner === identity?.owner)?.espnTeamId;
  const matchups = useMemo(() => week?.matchups ?? [], [week?.matchups]);
  const teams = useMemo(() => matchups.flatMap(matchup => [matchup.home, matchup.away]), [matchups]);
  const myMatchup = matchups.find(matchup => matchup.home.teamId === mine || matchup.away.teamId === mine);
  const opponentId = myMatchup ? (myMatchup.home.teamId === mine ? myMatchup.away.teamId : myMatchup.home.teamId) : undefined;
  const day = week?.days.find(day => day.date === date);
  const rosters = useMemo(() => new Map(teams.flatMap(team => team.players.flatMap(player => {
    const entry = day ? player.days[String(day.scoringPeriodId)] : undefined;
    return entry ? [[String(player.id), { team, started: entry.started }] as const] : [];
  }))), [teams, day]);
  const scope = embedded ? initialScope : params.get('scope') ?? initialScope;
  const selectedMatchup = scope === 'matchup' ? myMatchup : matchups.find(matchup => `matchup:${matchup.id}` === scope);
  const idsKey = (scope === 'me' ? [mine] : selectedMatchup ? [selectedMatchup.home.teamId, selectedMatchup.away.teamId] : scope.startsWith('team:') ? [Number(scope.slice(5))] : []).filter(id => id !== undefined).join(',');
  const scoring = week?.scoringItems?.length ? week.scoringItems : LEAGUE_SCORING;
  const newest = embedded || params.get('order') !== 'oldest';
  const gameScope = scope.startsWith('game:') || scope.startsWith('nba:');
  const selectedGame = embedded ? 'all' : params.get('game') ?? 'all';
  const nbaGames = useMemo(() => [...new Map((query.data?.plays ?? []).map(play => [play.gameId, play.game])).entries()], [query.data?.plays]);
  const sorted = useMemo(() => sortCastPlays(query.data?.plays ?? [], newest), [query.data?.plays, newest]);
  const runningTotals = useMemo(() => castRunningTotals(newest ? [...sorted].reverse() : sorted, scoring), [sorted, newest, scoring]);
  const plays = useMemo(() => {
    const teamIds = idsKey ? idsKey.split(',').map(Number) : [];
    return sorted.filter(play => (gameScope ? castMatchesGame(play, scope) : scope === 'all' || castMatchesTeams(play, teamIds, rosters, scoring)) && (selectedGame === 'all' || play.gameId === selectedGame) && (!peek || play.changes.length > 0));
  }, [sorted, gameScope, scope, idsKey, rosters, scoring, selectedGame, peek]);
  const Container = embedded ? 'section' : 'main';
  return <Container className={`mock-page scores-page fantasy-cast-page${embedded ? ' cast-embedded' : ''}${peek ? ' cast-peek' : ''}`} aria-label={embedded ? 'Fantasy Cast feed' : undefined}>
    {!embedded && <Link to="/scores" className="score-back hub-heading">← FANTASY SCORES</Link>}
    <div className="cast-heading"><div><span className="cast-eyebrow">{date === today ? 'LIVE PLAY FEED' : 'PLAY REPLAY'}</span><h1>Fantasy Cast</h1></div><button className="tap-btn mock-mini-btn" disabled={query.isFetching} onClick={() => { void query.refetch(); void weekQuery.refetch(); }}>Refresh</button></div>
    {!embedded && <div className="cast-controls">
      <label>Date<input className="hub-input" type="date" value={date} onChange={event => { if (event.target.value) change('date', event.target.value); }} /></label>
      <label>Show<select className="hub-input" value={scope} onChange={event => change('scope', event.target.value)}>
        <option value="all">All plays · all games</option><option value="matchup" disabled={!myMatchup || !day}>My matchup · scoring plays</option><option value="me" disabled={mine === undefined || !day}>My team · scoring plays</option>
        {initialScope.startsWith('game:') && <option value={initialScope}>This NBA game · {query.data?.plays.find(play => play.gameId === initialScope.slice(5))?.game ?? initialScope.slice(5)}</option>}
        {initialScope.startsWith('nba:') && <option value={initialScope}>{initialScope.slice(4)} game · both teams</option>}
        {initialScope.startsWith('matchup:') && !matchups.some(matchup => `matchup:${matchup.id}` === initialScope) && <option value={initialScope}>Viewed matchup · scoring plays</option>}
        {teams.map(team => <option key={team.teamId} value={`team:${team.teamId}`} disabled={!day}>{team.name}</option>)}
        {matchups.map(matchup => <option key={matchup.id} value={`matchup:${matchup.id}`} disabled={!day}>{matchup.home.name} vs {matchup.away.name}</option>)}
      </select></label>
      <label>NBA game<select className="hub-input" value={selectedGame} onChange={event => change('game', event.target.value)}><option value="all">All NBA games</option>{nbaGames.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Order<select className="hub-input" value={newest ? 'newest' : 'oldest'} onChange={event => change('order', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    </div>}
    {!embedded && <p className="daily-scorers-note"><span className="cast-legend-own">Green = your players</span> · <span className="cast-legend-opponent">Red = your opponent</span> · Neutral = everyone else · +/− shows the point change.</p>}
    {!embedded && !day && weekQuery.isSuccess && <p role="status">Roster and matchup filters require a date in the current fantasy week.</p>}
    {weekQuery.isError && <p role="alert">{embedded ? scope === 'all' || gameScope ? 'Rosters unavailable · Showing NBA plays.' : 'Rosters unavailable · Waiting for fantasy scoring.' : 'Roster data unavailable. Player highlights and matchup filters may be unavailable.'}</p>}
    {query.isLoading && <p role="status">Loading the play feed…</p>}
    {query.isError && <p role="alert">Could not load plays. Try Refresh.</p>}
    {query.data?.error && <p role="status">{query.data.error}</p>}
    {query.data?.schedule?.phase === 'waiting' && <p role="status">Updates start at tip-off{query.data.schedule.nextPollAt ? ` · ${new Date(query.data.schedule.nextPollAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.</p>}
    {query.data?.schedule?.phase === 'complete' && !query.data.schedule.nextPollAt && <p role="status">All games final · Automatic updates paused.</p>}
    {query.data && <p className="daily-scorers-note">{plays.length} plays · Updated {new Date(query.data.fetchedAt).toLocaleTimeString()}</p>}
    {query.data && !plays.length && <div className="panel cast-empty">{scope === 'all' ? 'No plays available for this date yet. The feed starts when games tip off.' : 'No scoring plays for this selection yet.'}</div>}
    <ol className="cast-feed">{plays.slice(0, peek ? 3 : visibleCount).map(play => {
      return <li key={play.id} className="panel cast-play">
        <div className="cast-meta"><span>{play.timestamp ? new Date(play.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Time unavailable'} · {play.game}</span><span>{play.period > 4 ? `OT${play.period - 4}` : `Q${play.period}`} · {play.clock}</span></div>
        <div className="cast-play-body">
        {!play.changes.length && <p className="cast-no-impact">{play.text}</p>}
        {play.changes.map((change, index) => { const roster = rosters.get(change.athleteId); const points = castPoints(change.stats, scoring); const myPlayer = mine !== undefined && roster?.team.teamId === mine;
          const ownership = castOwnership(roster?.team.teamId, mine, opponentId);
          return <div key={`${change.athleteId}:${index}`} className={`cast-change cast-owner-${ownership}`}>
            <TeamLogo code={change.team} size={22} />
            <div className="cast-player"><div className="cast-player-line"><strong title={change.name}>{castShortName(change.name)}</strong><span className="cast-inline-team" title={roster?.team.name}>{change.team} · {roster ? roster.team.name : day ? 'Free agent' : 'Roster unavailable'}{roster && !roster.started ? ' · BENCH' : ''}</span>{myPlayer && <span className="cast-you">YOU</span>}{ownership === 'opponent' && <span className="cast-you">OPP</span>}</div><div className="cast-action"><span>{castAction(play, change)}</span>{['Field goal made', '3-pointer made', 'Free throw made'].includes(change.stat) && <CastHoop />}{Object.keys(change.stats).some(id => ['37', '38', '39'].includes(id)) ? ' · Milestone bonus' : ''}</div></div>
            <div className="cast-impact"><strong key={points} className="cast-points" aria-label={`${points > 0 ? 'plus ' : ''}${points.toFixed(1)} fantasy points`}>{points > 0 ? '+' : ''}{points.toFixed(1)}</strong><span className="cast-game-total" title="Running fantasy points in this NBA game" aria-label={`${(runningTotals.get(change) ?? 0).toFixed(1)} game total`}>{(runningTotals.get(change) ?? 0).toFixed(1)} total</span></div>
          </div>;
        })}
        </div>
      </li>;
    })}</ol>
    {!peek && plays.length > visibleCount && <button className="tap-btn mock-mini-btn" onClick={() => setVisibleCount(count => count + 100)}>Show more plays ({plays.length - visibleCount} remaining)</button>}
    {!embedded && <details className="cast-scoring-note"><summary>Scoring &amp; feed notes</summary><p>Fantasy changes use league scoring. Events without timestamps are grouped by game in play order. Unrecognized stat descriptions remain visible without a points estimate. ESPN corrections and official matchup totals may differ.</p></details>}
  </Container>;
}
