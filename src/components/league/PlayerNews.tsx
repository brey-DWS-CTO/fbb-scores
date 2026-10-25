import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { playerNewsUrl, readPlayerNews, rotowireUrl } from '../../lib/league/playerCard.js';
import { gameFantasyPoints, gameLogUrl, logAverages, logLine, readGameLog, resultText, todayGame } from '../../lib/league/gameLog.js';
import { fetchDailyScorers } from '../../lib/league/api.js';
import { LEAGUE_SCORING, type ScoringItem } from '../../lib/league/partyScore.js';
import { injuryBadge, localDateIso, shortName, type ScorePlayer } from '../../lib/league/scores.js';
import { tipoffText } from './scoresUi.js';
import { PointsBreakdown } from './ScoreBreakdown.js';
import TeamLogo from './TeamLogo.js';

const newsDate = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const gameDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
const WINDOWS = [3, 7, 15] as const;

async function fetchPlayerNews(playerId: number) {
  const response = await fetch(playerNewsUrl(playerId));
  if (!response.ok) throw new Error(`ESPN news returned ${response.status}`);
  return readPlayerNews(await response.json());
}

async function fetchGameLog(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESPN game log returned ${response.status}`);
  return readGameLog(await response.json());
}

/**
 * Season average and his last 3, 7 or 15 games in league points, this
 * season only. A window he has not played enough games for stays off.
 * Past three games the list scrolls inside itself until opened in full.
 */
function PlayerGameLog({ playerId, name, proTeam, scoring }: { playerId: number; name: string; proTeam: string; scoring: readonly ScoringItem[] }) {
  const [count, setCount] = useState<(typeof WINDOWS)[number]>(3);
  const [expanded, setExpanded] = useState(false);
  const current = useQuery({ queryKey: ['game-log', playerId, 'current'], queryFn: () => fetchGameLog(gameLogUrl(playerId)), staleTime: 10 * 60_000, retry: 1 });
  // Today's game comes from our daily scores: ESPN's log lists a game only once it ends.
  const date = localDateIso(new Date());
  const day = useQuery({ queryKey: ['daily-scorers', date], queryFn: () => fetchDailyScorers(date), staleTime: 30_000, refetchInterval: 60_000, retry: 1 });
  const thisSeason = current.data?.games ?? [];
  const today = todayGame(day.data, proTeam, playerId, thisSeason);
  const todayLabel = today ? `Today ${today.home ? 'vs' : '@'} ${today.opp}` : '';
  const games = thisSeason.slice(0, count);
  const season = logAverages(thisSeason, scoring);
  const recent = logAverages(games, scoring);
  if (current.isLoading) return <p role="status">Loading games…</p>;
  if (current.isError) return <p role="alert">Could not load his games. <button type="button" className="tap-btn mock-mini-btn" onClick={() => void current.refetch()}>Try again</button></p>;
  return <>
    <dl className="player-log-strip">
      <div><dt>Season avg</dt><dd>{season ? season.fpts.toFixed(1) : '—'}</dd></div>
      <div><dt>Last {count} avg</dt><dd>{recent ? recent.fpts.toFixed(1) : '—'}</dd></div>
      <div><dt>Min</dt><dd>{season ? season.min.toFixed(1) : '—'}</dd></div>
      <div><dt>GP</dt><dd>{thisSeason.length}</dd></div>
    </dl>
    <div className="player-log-head">
      <h3>Game log</h3>
      <div className="performer-segment" role="group" aria-label="Games shown">
        {WINDOWS.map(n => <button key={n} type="button" aria-pressed={count === n} disabled={n > 3 && thisSeason.length < n} title={n > 3 && thisSeason.length < n ? `After ${n} games` : undefined} onClick={() => { setCount(n); setExpanded(false); }}>Last {n}</button>)}
      </div>
    </div>
    {today && <div className={`player-log-game is-today${today.state === 'in' ? ' is-live' : ''}`}>
      <span className="player-log-top">
        <span>{todayLabel}</span>
        <span className="player-log-status">{today.status || tipoffText(today.tipoff)}</span>
        <strong>{today.stats ? <PointsBreakdown name={name} label={todayLabel} days={[{ rawStats: today.stats, stats: null }]} scoring={scoring} total={gameFantasyPoints({ stats: today.stats }, scoring)} /> : '—'}</strong>
      </span>
      <small>{today.stats ? logLine(today.stats) : today.state === 'pre' ? 'Not started' : 'Has not played yet'}</small>
    </div>}
    {games.length === 0 ? (!today && <p>No games this season yet.</p>) : <ol className={`player-log-list${games.length > 3 && !expanded ? ' is-collapsed' : ''}`}>
      {games.map(game => <li key={game.eventId} className="player-log-game">
        <span className="player-log-top">
          <span>{gameDate(game.date)} {game.home ? 'vs' : '@'} {game.opp}</span>
          <span className={game.result === 'W' ? 'is-win' : game.result === 'L' ? 'is-loss' : undefined}>{resultText(game)}</span>
          <strong><PointsBreakdown name={name} label={`${gameDate(game.date)} ${game.home ? 'vs' : '@'} ${game.opp}`} days={[{ rawStats: game.stats, stats: null }]} scoring={scoring} total={gameFantasyPoints(game, scoring)} /></strong>
        </span>
        <small>{logLine(game.stats)}</small>
      </li>)}
    </ol>}
    {games.length > 3 && <button type="button" className="tap-btn mock-mini-btn player-log-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse' : `Show all ${games.length}`}</button>}
  </>;
}

/** Who the card is about. Lists outside a fantasy roster, like Top Performers, have no injury status. */
export type CardPlayer = Pick<ScorePlayer, 'id' | 'name' | 'proTeam' | 'position'> & { injuryStatus?: string | null };

/** His name as a button. It opens a card with his status, recent games and latest RotoWire notes. */
export default function PlayerNews({ player, scoring = LEAGUE_SCORING }: { player: CardPlayer; scoring?: readonly ScoringItem[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const news = useQuery({
    queryKey: ['player-news', player.id],
    queryFn: () => fetchPlayerNews(player.id),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const badge = injuryBadge(player.injuryStatus);
  const close = () => { dialog.current?.close(); setOpen(false); };
  return <>
    <button type="button" className="score-player-name-text player-news-trigger" aria-label={`${player.name}: games and news`} onClick={() => { setOpen(true); dialog.current?.showModal(); }}>{shortName(player.name)}</button>
    <dialog ref={dialog} aria-label={`${player.name} card`} className="score-detail player-news" onClose={event => { if (event.target === event.currentTarget) setOpen(false); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <button type="button" className="tap-btn score-detail-close" aria-label="Close player card" onClick={close}>×</button>
      <h2><TeamLogo code={player.proTeam || null} size={20} /> {player.name}</h2>
      <p>{[player.position, player.proTeam].filter(Boolean).join(' · ')}{badge ? <> · <span className={`score-badge is-${badge.tone}`}>{badge.text}</span></> : player.injuryStatus === undefined ? '' : ' · Healthy'}</p>
      {open && <section className="player-card-section" aria-label="Games"><PlayerGameLog playerId={player.id} name={player.name} proTeam={player.proTeam} scoring={scoring.length ? scoring : LEAGUE_SCORING} /></section>}
      <section className="player-card-section" aria-label="News">
      <h3 className="player-news-heading">Recent news</h3>
      {open && news.isLoading && <p role="status">Loading news…</p>}
      {news.isError && <p role="alert">Could not load news. <button type="button" className="tap-btn mock-mini-btn" onClick={() => void news.refetch()}>Try again</button></p>}
      {news.data?.length === 0 && <p>No recent news.</p>}
      {news.data && news.data.length > 0 && <ol className="player-news-list">{news.data.map(item => <li key={item.id}>
        <span className="player-news-meta"><time dateTime={item.published}>{newsDate(item.published)}</time><a href={rotowireUrl(player.name)} target="_blank" rel="noreferrer">RotoWire</a></span>
        <strong>{item.headline}</strong>
        {item.story && <span>{item.story}</span>}
      </li>)}</ol>}
      </section>
      <p className="player-news-source">Notes from RotoWire via ESPN. <a href={rotowireUrl(player.name)} target="_blank" rel="noreferrer">All notes on RotoWire</a> · <a href={`https://www.espn.com/nba/player/_/id/${player.id}`} target="_blank" rel="noreferrer">ESPN page</a></p>
    </dialog>
  </>;
}
