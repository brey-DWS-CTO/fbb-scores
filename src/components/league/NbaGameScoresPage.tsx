import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useDailyScorers } from '../../hooks/useDailyScorers.js';
import { teamFullName, normalizeTeam } from '../../lib/league/houseParty.js';
import { localDateIso, ownerByEspnTeamId } from '../../lib/league/scores.js';
import { leagueDataset } from '../../lib/league/data.js';
import { PointsBreakdown } from './ScoreBreakdown.js';
import PlayerNews from './PlayerNews.js';
import { castClockText, lastGamePlay } from '../../lib/league/castContext.js';
import { CAST_LIVE_MS } from '../../lib/league/castPolling.js';
import type { FantasyCast } from '../../lib/league/fantasyCast.js';
import { gameWinner, sortScoreboardGames, teamScore } from '../../lib/league/scoreboardOrder.js';
import { liveClock, nbaGameHref, type DailyNbaScores } from '../../lib/league/dailyScorers.js';
import type { NbaGame } from '../../lib/league/houseParty.js';
import TeamLogo from './TeamLogo.js';
import { tipoffText } from './scoresUi.js';

// Rows name the owner, not the fantasy team.
const OWNERS = ownerByEspnTeamId(leagueDataset.teams);

/** "19pt 13r 1a 2s 3to": short labels so it fits under a name in a half-width column. Steals, blocks and turnovers only when he has some. */
function shortLine(stats: Readonly<Record<string, number>>): string {
  const always = [['0', 'pt'], ['6', 'r'], ['3', 'a']].map(([id, label]) => `${stats[id] ?? 0}${label}`);
  const some = [['2', 's'], ['1', 'b'], ['11', 'to']].filter(([id]) => (stats[id] ?? 0) > 0).map(([id, label]) => `${stats[id]}${label}`);
  return [...always, ...some].join(' ');
}

/** "LIVE · Q4 2:10", "Final" or the tip-off time. */
function gameStatus(game: NbaGame, detail: string | undefined): string {
  if (game.state === 'in') return `LIVE · ${liveClock(detail || game.detail)}`;
  return game.state === 'post' ? 'Final' : tipoffText(game.tipoff) ?? game.detail;
}

/** The winner's score is bold with an arrow once final; the loser's is dimmed. */
const resultClass = (winner: string | null, code: string) => winner === null ? '' : winner === code ? ' is-winner' : ' is-loser';

/** The day's games in a swipeable strip, like the matchup strip on Scores. Tap one to open it. */
function NbaGameStrip({ data, date, selectedId, returnTo }: { data: DailyNbaScores; date: string; selectedId: string; returnTo: string | undefined }) {
  const strip = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [selectedId]);
  return <nav className="matchup-strip nba-game-strip" aria-label="The day's NBA games">
    <button type="button" className="tap-btn matchup-strip-arrow" aria-label="Scroll games left" onClick={() => strip.current?.scrollBy({ left: -240, behavior: 'smooth' })}>‹</button>
    <div className="matchup-strip-track" ref={strip}>
      {sortScoreboardGames(data.games).map(game => {
        const box = data.boxScores.find(entry => entry.gameId === game.id);
        const winner = gameWinner(game, box);
        return <Link key={game.id} ref={game.id === selectedId ? active : undefined} replace state={returnTo ? { returnTo } : undefined} className={`matchup-strip-card${game.id === selectedId ? ' is-selected' : ''}${game.state === 'in' ? ' is-live' : ''}`} aria-current={game.id === selectedId ? 'page' : undefined} aria-label={`${game.away} at ${game.home}, ${gameStatus(game, box?.detail)}`} to={nbaGameHref(date, { gameId: game.id })}>
          {[game.away, game.home].map(code => <span className={`matchup-strip-side${resultClass(winner, code)}`} key={code}><TeamLogo code={code} size={17} /><span>{code}</span><b>{game.state === 'pre' ? '' : teamScore(game, box, code) ?? ''}</b></span>)}
          <span className="nba-strip-status">{gameStatus(game, box?.detail)}</span>
        </Link>;
      })}
    </div>
    <button type="button" className="tap-btn matchup-strip-arrow" aria-label="Scroll games right" onClick={() => strip.current?.scrollBy({ left: 240, behavior: 'smooth' })}>›</button>
  </nav>;
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
  const winner = game ? gameWinner(game, box) : null;
  // Keep both teams and the score in view once the score panel scrolls away, like the matchup page.
  const header = useRef<HTMLElement>(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const panel = header.current;
    if (!panel) return;
    const observer = new IntersectionObserver(([entry]) => setShowSticky(entry.boundingClientRect.bottom <= 0));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [game?.id]);
  return <div className="mock-page scores-page nba-game-page">
    <Link className="score-back hub-heading" to={(performersReturn || scoreboardReturn || matchupReturn || returnTo?.startsWith('/scores?')) && returnTo ? returnTo : '/scores'}>{performersReturn ? '← TOP PERFORMERS' : scoreboardReturn ? '← NBA SCOREBOARD' : matchupReturn ? '← MATCHUP' : '← SCORES'}</Link>
    {query.isLoading && <p role="status">Loading NBA game…</p>}
    {query.isError && <p role="alert">Could not load this game. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Try again</button></p>}
    {data?.error && <p role="status">{data.error}</p>}
    {data && !game && <p>No NBA game found for this player on this date.</p>}
    {data && game && data.games.length > 1 && <NbaGameStrip data={data} date={date} selectedId={game.id} returnTo={returnTo} />}
    {game && <>
      <section ref={header} className="panel nba-game-header">
        <p>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {game.state === 'in' ? 'LIVE · ' : ''}{box?.detail || (game.state === 'pre' ? tipoffText(game.tipoff) : game.detail)}</p>
        <h1 className="nba-game-title">{game.away} at {game.home}</h1>
        <div className="nba-game-scoreboard">{[game.away, game.home].map(code => <div key={code} className={resultClass(winner, code).trim() || undefined}><TeamLogo code={code} size={40} /><span>{teamFullName(code)}</span><strong>{teamScore(game, box, code) ?? '—'}</strong></div>)}</div>
      </section>
      {game.state !== 'pre' && <LastPlay date={date} gameId={game.id} live={game.state === 'in'} />}
      <div className={`score-sticky-summary nba-game-sticky${showSticky ? ' is-visible' : ''}`} aria-hidden={!showSticky}>
        {[game.away, game.home].map((code, index) => <div key={code} className={`score-sticky-side${index === 1 ? ' is-right' : ''}${resultClass(winner, code)}`} style={{ order: index * 2 }}>
          <TeamLogo code={code} size={26} />
          <span className="score-sticky-name">{code}</span>
          <span className="score-sticky-numbers"><strong>{teamScore(game, box, code) ?? '—'}</strong></span>
        </div>)}
        <span className="nba-sticky-status">{gameStatus(game, box?.detail)}</span>
      </div>
      {gameRows.length === 0 && <p>{game.state === 'pre' ? 'Player scores appear after tip-off.' : 'Player stats are not available yet. This page updates automatically.'}</p>}
      <div className="nba-game-teams">{[game.away, game.home].map(code => <section className="panel" key={code} aria-label={`${teamFullName(code)} scorers`}>
        <h3 title={teamFullName(code)}><TeamLogo code={code} size={22} />{code}</h3>
        <div className="daily-scorer-columns"><span>Player</span><span>FPTS</span></div>
        <ol className="daily-scorer-list">{gameRows.filter(row => row.team === code).map(row => <li key={row.athleteId} className={`nba-game-player${row.athleteId === selected ? ' is-selected' : ''}`}>
          <span className="nba-game-player-info">
            <strong><PlayerNews player={{ id: Number(row.athleteId), name: row.name, proTeam: row.team, position: row.position ?? '' }} scoring={scoring} /></strong>
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
