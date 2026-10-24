import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useDailyScorers } from '../../hooks/useDailyScorers.js';
import { teamFullName, normalizeTeam } from '../../lib/league/houseParty.js';
import { shortName } from '../../lib/league/format.js';
import { localDateIso, ownerByEspnTeamId } from '../../lib/league/scores.js';
import { leagueDataset } from '../../lib/league/data.js';
import { PointsBreakdown } from './ScoreBreakdown.js';
import { castClockText, lastGamePlay } from '../../lib/league/castContext.js';
import { CAST_LIVE_MS } from '../../lib/league/castPolling.js';
import type { FantasyCast } from '../../lib/league/fantasyCast.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

// Rows name the owner, not the fantasy team.
const OWNERS = ownerByEspnTeamId(leagueDataset.teams);

/** Points, rebounds and assists: what fits under a name in a half-width column. */
function shortLine(stats: Readonly<Record<string, number>>): string {
  return [['0', 'pts'], ['6', 'reb'], ['3', 'ast']].map(([id, label]) => `${stats[id] ?? 0} ${label}`).join(' · ');
}

/** The game's latest play, read from the Cast feed. It polls only while the game is live. */
function LastPlay({ date, gameId, live }: { date: string; gameId: string; live: boolean }) {
  const query = useQuery({
    queryKey: ['fantasy-cast', date],
    queryFn: async ({ signal }) => (await axios.get<FantasyCast>('/api/league/fantasy-cast', { params: { date }, signal })).data,
    staleTime: live ? 15_000 : 5 * 60_000,
    refetchInterval: live ? CAST_LIVE_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const play = lastGamePlay(query.data?.plays ?? [], gameId);
  if (!play) return null;
  return <p className="panel nba-last-play" aria-live="polite"><span className="nba-last-play-label">{live ? 'LAST PLAY' : 'FINAL PLAY'} · {castClockText(play)}</span>{play.text}</p>;
}

export default function NbaGameScoresPage() {
  const { gameId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const performersReturn = returnTo?.startsWith('/scores/performers?') === true;
  const scoreboardReturn = returnTo?.startsWith('/scores/nba-scoreboard?') === true;
  const matchupReturn = /^\/scores\/\d+(\?|$)/.test(returnTo ?? '');
  const date = params.get('date') ?? localDateIso(new Date());
  const team = normalizeTeam(params.get('team'));
  const selected = params.get('player');
  const { query, rows, rosters, scoring } = useDailyScorers(date);
  const data = query.data;
  const game = data?.games.find(entry => gameId ? entry.id === gameId : entry.home === team || entry.away === team);
  const box = data?.boxScores.find(entry => entry.gameId === game?.id);
  const gameRows = rows.filter(row => row.gameId === game?.id);
  return <div className="mock-page scores-page nba-game-page">
    <Link className="score-back hub-heading" to={(performersReturn || scoreboardReturn || matchupReturn || returnTo?.startsWith('/scores?')) && returnTo ? returnTo : '/scores'}>{performersReturn ? '← TOP PERFORMERS' : scoreboardReturn ? '← NBA SCOREBOARD' : matchupReturn ? '← MATCHUP' : '← SCORES'}</Link>
    {query.isLoading && <p role="status">Loading NBA game…</p>}
    {query.isError && <p role="alert">Could not load this game. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Try again</button></p>}
    {data?.error && <p role="status">{data.error}</p>}
    {data && !game && <p>No NBA game found for this player on this date.</p>}
    {game && <>
      {game.state !== 'pre' && <LastPlay date={date} gameId={game.id} live={game.state === 'in'} />}
      <section className="panel nba-game-header">
        <p>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {game.state === 'in' ? 'LIVE · ' : ''}{box?.detail || (game.state === 'pre' ? tipoffText(game.tipoff) : game.detail)}</p>
        <h1 className="nba-game-title">{game.away} at {game.home}</h1>
        <div className="nba-game-scoreboard">{[game.away, game.home].map(code => <div key={code}><TeamLogo code={code} size={40} /><span>{teamFullName(code)}</span><strong>{(code === game.home ? box?.homeScore ?? game.homeScore : box?.awayScore ?? game.awayScore) ?? '—'}</strong></div>)}</div>
      </section>
      {gameRows.length === 0 && <p>{game.state === 'pre' ? 'Player scores appear after tip-off.' : 'Player stats are not available yet. This page updates automatically.'}</p>}
      <div className="nba-game-teams">{[game.away, game.home].map(code => <section className="panel" key={code} aria-label={`${teamFullName(code)} scorers`}>
        <h3 title={teamFullName(code)}><TeamLogo code={code} size={22} />{code}</h3>
        <div className="daily-scorer-columns"><span>Player</span><span>FPTS</span></div>
        <ol className="daily-scorer-list">{gameRows.filter(row => row.team === code).map(row => <li key={row.athleteId} className={`nba-game-player${row.athleteId === selected ? ' is-selected' : ''}`}>
          <span className="nba-game-player-info">
            <strong title={row.name}>{shortName(row.name)}</strong>
            <small>{!rosters ? '' : row.roster ? <span className="nba-game-owner">{OWNERS.get(row.roster.teamId) ?? row.roster.name}</span> : <span className="unowned-badge" aria-label="Waivers" title="Waivers">W</span>}<span>{shortLine(row.stats)}</span></small>
          </span>
          <span className="daily-scorer-total"><strong><PointsBreakdown name={row.name} label={date} days={[{ rawStats: row.stats, stats: null }]} scoring={scoring} total={row.fpts} /></strong></span>
        </li>)}</ol>
        {gameRows.length > 0 && !gameRows.some(row => row.team === code) && <p>No player stats available.</p>}
      </section>)}</div>
      <p className="daily-scorers-note">Fantasy points use league scoring. Includes every player who has played, regardless of fantasy roster or lineup. Updates every minute.</p>
    </>}
  </div>;
}
