import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWaiverOffers } from '../../lib/league/api.js';

export default function WaiverOffersReport() {
  const [period, setPeriod] = useState<number>();
  const current = useQuery({queryKey:['waiver-offers','current'], queryFn: () => fetchWaiverOffers(), staleTime: 5 * 60_000, retry: 1});
  const selected = useQuery({queryKey:['waiver-offers',period ?? 'current'], queryFn: () => fetchWaiverOffers(period), enabled: period !== undefined, staleTime: 5 * 60_000, retry: 1});
  const query = period === undefined ? current : selected;
  const day = period ?? current.data?.scoringPeriodId;
  return <section className="waiver-offers" aria-label="ESPN offers report">
    <h2>ESPN offers report</h2><p className="daily-scorers-note">Processed waiver claims and bids returned by ESPN. Pending claims stay private.</p>
    <div className="waiver-offers-nav"><button className="tap-btn mock-mini-btn" disabled={!day || day <= 1} onClick={() => day && setPeriod(day - 1)}>← Previous day</button><span>{day ? `Scoring day ${day}` : 'Current scoring day'}</span><button className="tap-btn mock-mini-btn" disabled={period === undefined || !current.data || period >= current.data.scoringPeriodId} onClick={() => period && setPeriod(period + 1)}>Next day →</button><button className="tap-btn mock-mini-btn" onClick={() => setPeriod(undefined)}>Today</button></div>
    {query.isLoading && <p role="status">Loading ESPN’s offers report…</p>}
    {query.isError && <p role="alert">Could not load the offers report from ESPN. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && !query.data.rows.length && <p className="lm-empty">ESPN returned no processed offers for this scoring day. Try a previous day after waivers have run.</p>}
    <ol className="league-activity">{query.data?.rows.map(row => <li key={row.id}><div className="league-activity-head"><span className={`activity-kind ${row.outcome === 'successful' ? 'is-add' : 'is-drop'}`}>{row.outcome === 'successful' ? 'SUCCESSFUL' : 'UNSUCCESSFUL'}</span><strong>{row.playerName}</strong><span>{row.bid === null ? 'Bid unavailable' : `$${row.bid}`}</span></div><div className="league-activity-line">{row.owner} · {new Date(row.at).toLocaleString('en-US', {timeZone:'America/Los_Angeles'})} PT</div></li>)}</ol>
    {query.data && <p className="daily-scorers-note">ESPN checked {new Date(query.data.fetchedAt).toLocaleTimeString()}. Only records ESPN identifies as processed are included.</p>}
  </section>;
}
