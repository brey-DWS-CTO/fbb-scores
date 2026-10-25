import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWaiverCalendar } from '../../lib/league/api.js';
import { pacific, waiverCountdown } from '../../lib/league/lmWeekend.js';
import { lmWindowCards } from '../../lib/league/lmWindowClock.js';

/** The LM Adds page clock: when the LM window opens and closes, nothing else. */
export default function LmWindowClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const month = pacific(new Date(now)).date.slice(0, 7);
  const after = new Date(`${month}-15T12:00:00Z`); after.setUTCMonth(after.getUTCMonth() + 1);
  const nextMonth = after.toISOString().slice(0, 7);
  const current = useQuery({ queryKey: ['waiver-calendar', month], queryFn: () => fetchWaiverCalendar(month), staleTime: 5 * 60_000 });
  const next = useQuery({ queryKey: ['waiver-calendar', nextMonth], queryFn: () => fetchWaiverCalendar(nextMonth), staleTime: 5 * 60_000 });
  const cards = lmWindowCards(now, [...(current.data?.days ?? []), ...(next.data?.days ?? [])]);
  return <section className="panel waiver-countdowns" aria-label="LM add window">
    <h2>LM add window</h2>
    <p>Opens five minutes after that day's waivers run. Closes 10 minutes before the first tip. Pacific time.</p>
    <div className="waiver-clock-grid">
      {cards.map(card => <div key={card.label} className="waiver-clock-card"><span>{card.label}</span>
        <strong className={card.countdownTo ? 'waiver-ticking' : undefined}>{card.countdownTo ? waiverCountdown(card.countdownTo, now) : card.headline}</strong>
        <small>{card.detail}</small></div>)}
      {!cards.length && <div className="waiver-clock-card"><span>LM adds</span><strong>{current.isLoading ? 'Loading…' : 'Time unavailable'}</strong><small>Waiting for the NBA schedule</small></div>}
    </div>
    {(current.isError || next.isError) && <p role="alert">Some times could not load. <button type="button" onClick={() => { void current.refetch(); void next.refetch(); }}>Retry</button></p>}
  </section>;
}
