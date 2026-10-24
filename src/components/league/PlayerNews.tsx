import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { playerNewsUrl, readPlayerNews, rotowireUrl } from '../../lib/league/playerCard.js';
import { injuryBadge, shortName, type ScorePlayer } from '../../lib/league/scores.js';
import TeamLogo from './TeamLogo.js';

const newsDate = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function fetchPlayerNews(playerId: number) {
  const response = await fetch(playerNewsUrl(playerId));
  if (!response.ok) throw new Error(`ESPN news returned ${response.status}`);
  return readPlayerNews(await response.json());
}

/** His name as a button. It opens a card with his injury status and latest RotoWire notes. */
export default function PlayerNews({ player }: { player: ScorePlayer }) {
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
    <button type="button" className="score-player-name-text player-news-trigger" aria-label={`${player.name}: latest news`} onClick={() => { setOpen(true); dialog.current?.showModal(); }}>{shortName(player.name)}</button>
    <dialog ref={dialog} aria-label={`${player.name} news`} className="score-detail player-news" onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <button type="button" className="tap-btn score-detail-close" aria-label="Close news" onClick={close}>×</button>
      <h2><TeamLogo code={player.proTeam || null} size={20} /> {player.name}</h2>
      <p>{player.position}{player.proTeam ? ` · ${player.proTeam}` : ''}{badge ? <> · <span className={`score-badge is-${badge.tone}`}>{badge.text}</span></> : ' · Healthy'}</p>
      {open && news.isLoading && <p role="status">Loading news…</p>}
      {news.isError && <p role="alert">Could not load news. <button type="button" className="tap-btn mock-mini-btn" onClick={() => void news.refetch()}>Try again</button></p>}
      {news.data?.length === 0 && <p>No recent news.</p>}
      {news.data && news.data.length > 0 && <ol className="player-news-list">{news.data.map(item => <li key={item.id}>
        <span className="player-news-meta"><time dateTime={item.published}>{newsDate(item.published)}</time><a href={rotowireUrl(player.name)} target="_blank" rel="noreferrer">RotoWire</a></span>
        <strong>{item.headline}</strong>
        {item.story && <span>{item.story}</span>}
      </li>)}</ol>}
      <p className="player-news-source">Notes from RotoWire via ESPN. <a href={rotowireUrl(player.name)} target="_blank" rel="noreferrer">All notes on RotoWire</a> · <a href={`https://www.espn.com/nba/player/_/id/${player.id}`} target="_blank" rel="noreferrer">ESPN page</a></p>
    </dialog>
  </>;
}
