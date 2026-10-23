import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchWaiverCalendar } from '../../lib/league/api.js';
import { hourLabel, pacific } from '../../lib/league/lmWeekend.js';
import { SelectedWaiverCountdown } from './WaiverCountdowns.js';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
export default function WaiverCalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = pacific(new Date()).date;
  const requested = params.get('month') ?? today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7);
  const selectedDate = params.get('day') ?? (today.startsWith(month) ? today : `${month}-01`);
  const query = useQuery({ queryKey: ['waiver-calendar', month], queryFn: () => fetchWaiverCalendar(month), staleTime: 5 * 60_000, retry: 1 });
  const selected = query.data?.days.find(day => day.date === selectedDate);
  const changeMonth = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    setParams({ month: date.toISOString().slice(0, 7) });
  };
  const weekday = new Date(`${month}-01T12:00:00Z`).getUTCDay();
  return <main className="mock-page waiver-calendar-page">
    <Link className="score-back hub-heading" to="/lm-adds">← LM ADDS</Link>
    <h1>Waiver Calendar</h1>
    <p className="daily-scorers-note">All times Pacific. Highlighted waiver times differ from the normal 3 PM run. LM Adds close 10 minutes before the day’s earliest tip-off.</p>
    <div className="waiver-month-nav"><button className="tap-btn mock-mini-btn" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button><h2>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</h2><button className="tap-btn mock-mini-btn" onClick={() => changeMonth(1)} aria-label="Next month">›</button></div>
    <div className="waiver-calendar-legend"><span className="is-irregular">● Irregular waivers</span><span className="is-lm">● LM Add day</span></div>
    {query.isLoading && <p role="status">Loading the NBA schedule…</p>}
    {query.isError && <p role="alert">Could not load the schedule. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && <>
      <div className="waiver-calendar-grid" role="group" aria-label="Daily waiver schedule">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span className="waiver-weekday" key={day}>{day}</span>)}
        {Array.from({ length: weekday }, (_, index) => <span key={`empty${index}`} />)}
        {query.data.days.map(day => <button key={day.date} type="button" aria-pressed={day.date === selectedDate} aria-label={`${day.date}${day.waiver ? `, waivers ${hourLabel(day.waiver.hourPT)} Pacific${day.waiver.early ? ', irregular time' : ''}` : ', schedule unavailable'}${day.lmEligible ? ', LM Add eligible' : ''}`} className={`waiver-calendar-day${day.waiver?.early ? ' is-irregular' : ''}${day.lmEligible ? ' is-lm' : ''}${day.date === today ? ' is-today' : ''}`} onClick={() => setParams({ month, day: day.date }, { replace: true })}>
          <strong>{Number(day.date.slice(-2))}</strong><small>{day.waiver ? hourLabel(day.waiver.hourPT) : '?'}</small>{day.lmEligible && <span>LM</span>}
        </button>)}
      </div>
      {selected && <section className="panel waiver-day-detail"><h2>{new Date(`${selected.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })}</h2>
        {selected.games === null ? <p>NBA schedule unavailable. Eligibility and times cannot be confirmed.</p> : <>
          <p>Waivers: <strong>{selected.waiver && hourLabel(selected.waiver.hourPT)} Pacific</strong>{selected.waiver?.early ? ' · earlier than normal' : ''}</p>
          <SelectedWaiverCountdown day={selected} />
          <p>{selected.games} NBA game{selected.games === 1 ? '' : 's'}{selected.waiver?.firstTip ? ` · First tip ${clock(selected.waiver.firstTip)} PT` : ''}</p>
          <p>{selected.lmClosesAt ? `LM Add eligible · Claims close ${clock(selected.lmClosesAt)} PT` : 'No LM Adds on this day.'}</p>
          {selected.lmEligible && <Link className="tap-btn mock-mini-btn" to={`/lm-adds?date=${selected.date}`}>LM Adds →</Link>}
        </>}
      </section>}
    </>}
  </main>;
}
