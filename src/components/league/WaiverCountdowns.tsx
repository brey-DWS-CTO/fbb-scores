import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWaiverCalendar } from '../../lib/league/api.js';
import { hourLabel, pacific, waiverCountdown, waiverRunAt } from '../../lib/league/lmWeekend.js';
import type { WaiverCalendarDay } from '../../lib/league/waiverCalendar.js';

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return now;
}

function DayClock({ day, now, label }: { day?: WaiverCalendarDay; now: number; label: string }) {
  return <div className="waiver-clock-card"><span>{label}</span>
    {day?.waiver ? <><strong className="waiver-ticking">{waiverCountdown(waiverRunAt(day.date, day.waiver.hourPT), now)}</strong><small>{hourLabel(day.waiver.hourPT)} PT{day.waiver.early ? ' · early run' : ''}</small></>
      : <><strong>Time unavailable</strong><small>Waiting for the NBA schedule</small></>}
  </div>;
}

export function SelectedWaiverCountdown({ day }: { day: WaiverCalendarDay }) {
  const now = useClock();
  return <DayClock day={day} now={now} label="Scheduled waivers" />;
}

/** Planned times come from each day's schedule, never ESPN's mutable current setting. */
export default function WaiverCountdowns() {
  const now = useClock();
  const today = pacific(new Date(now)).date;
  const dates = Array.from({length: 7}, (_, index) => { const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + index); return day.toISOString().slice(0, 10); });
  const month = today.slice(0, 7);
  const nextMonth = dates[6].slice(0, 7);
  const current = useQuery({queryKey: ['waiver-calendar', month], queryFn: () => fetchWaiverCalendar(month), staleTime: 5 * 60_000});
  const next = useQuery({queryKey: ['waiver-calendar', nextMonth], queryFn: () => fetchWaiverCalendar(nextMonth), staleTime: 5 * 60_000, enabled: nextMonth !== month});
  const days = [...(current.data?.days ?? []), ...(nextMonth !== month ? next.data?.days ?? [] : [])];
  const card = (date: string, index: number) => <DayClock key={date} day={days.find(day => day.date === date)} now={now} label={index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {timeZone:'UTC',weekday:'short',month:'short',day:'numeric'})} />;
  return <section className="panel waiver-countdowns" aria-label="Scheduled waiver countdowns"><h2>Waiver clock</h2><p>Planned from each day’s NBA schedule · Pacific time. A passed timer does not confirm ESPN has processed waivers.</p>
    <div className="waiver-clock-grid">{dates.slice(0, 2).map(card)}</div>
    <details><summary>Next five days</summary><div className="waiver-clock-grid">{dates.slice(2).map((date, index) => card(date, index + 2))}</div></details>
    {(current.isError || next.isError) && <p role="alert">Some scheduled times could not load. <button type="button" onClick={() => { void current.refetch(); if (nextMonth !== month) void next.refetch(); }}>Retry</button></p>}
  </section>;
}
