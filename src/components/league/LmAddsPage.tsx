import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useDraftData, useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, cancelLmClaim, fetchLmWeekend, fetchWaiverCalendar, queueLmClaim } from '../../lib/league/api.js';
import { pacific } from '../../lib/league/lmWeekend.js';
import { claimPriority } from '../../lib/league/lmClaims.js';
import type { DatasetPlayer } from '../../lib/keeper/types.js';
import PlayerCombobox from './PlayerCombobox.js';
import LmAddPanel from './LmAddPanel.js';
import NavIcon from './NavIcon.js';
import WaiverCountdowns from './WaiverCountdowns.js';

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

export default function LmAddsPage() {
  const { identity } = useIdentity();
  const { dataset } = useDraftData();
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const today = pacific(new Date(now)).date;
  const next = new Date(`${today}T12:00:00Z`);
  const day = next.getUTCDay();
  if (day !== 0 && day !== 6) next.setUTCDate(next.getUTCDate() + (6 - day + 7) % 7);
  const requested = params.get('date');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(`${requested}T12:00:00Z`)) && new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) === requested ? requested : next.toISOString().slice(0, 10);
  const setDate = (value: string) => { setParams({ date: value }, { replace: true }); setNotice(''); };
  const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 35);
  const weekend = Array.from({ length: 8 }, (_, index) => {
    const candidate = new Date(`${today}T12:00:00Z`); candidate.setUTCDate(candidate.getUTCDate() + index);
    return candidate;
  }).filter(candidate => [0, 6].includes(candidate.getUTCDay())).slice(0, 2).map(candidate => candidate.toISOString().slice(0, 10));
  const [player, setPlayer] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const query = useQuery({ queryKey: ['lm-claims', identity?.owner ?? null, identity?.isCommissioner === true], queryFn: () => fetchLmWeekend(identity), staleTime: 20_000, refetchInterval: 30_000 });
  const calendar = useQuery({ queryKey: ['waiver-calendar', date.slice(0, 7)], queryFn: () => fetchWaiverCalendar(date.slice(0, 7)), staleTime: 5 * 60_000, retry: 1 });
  const selectedDay = calendar.data?.days.find(day => day.date === date);
  const dateProblem = date < today || date > last.toISOString().slice(0, 10) ? 'Choose a date within the next 35 days.'
    : ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 'LM Adds are available on Saturdays and Sundays.'
    : selectedDay?.games === 0 ? 'No NBA games on this date. Choose another weekend day.'
    : selectedDay?.lmClosesAt && now >= Date.parse(selectedDay.lmClosesAt) ? 'Claims have closed for this date. Choose the next eligible day.' : null;
  const claims = (query.data?.requests ?? []).filter(row => ['queued', 'processing'].includes(row.status)).sort(claimPriority);
  const submit = async () => {
    if (!identity || !player?.espnId) return;
    if (dateProblem) return;
    setBusy(true); setNotice(''); setFailed(false);
    try { await queueLmClaim(identity, player.espnId, date); setPlayer(null); setPickerKey(key => key + 1); setNotice(`Claim queued for ${dayLabel(date)}. It is not added yet—watch its status below.`); await query.refetch(); }
    catch (error) { setFailed(true); setNotice(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (!identity) return;
    setBusy(true); setFailed(false);
    try { await cancelLmClaim(identity, id); await query.refetch(); setNotice('Claim cancelled.'); }
    catch (error) { setFailed(true); setNotice(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <main className="mock-page lm-adds-page">
    <header className="waivers-hero"><span className="waivers-eyebrow"><NavIcon name="calendar" size={15} /> WEEKEND PICKUPS</span>
      <h1>LM Adds</h1><p>Pick your day. Pick your player. We’ll handle the add when eligible.</p>
      <span className="lm-private-note"><NavIcon name="lock" size={14} /> Pending claims are private to you and the commissioner.</span>
    </header>
    <WaiverCountdowns />
    <section className="panel lm-advance-panel">
      <h2>Queue an LM Add</h2>
      {!identity && <p>Sign in to submit a claim.</p>}
      {identity && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset className="lm-date-choice"><legend>1 · Choose your day</legend><div className="lm-weekend-options">{weekend.map(option => <button key={option} type="button" aria-pressed={date === option} disabled={busy} onClick={() => setDate(option)}>{dayLabel(option)}</button>)}</div>
          {!weekend.includes(date) && <p className="daily-scorers-note">Selected from calendar: {dayLabel(date)}</p>}
        </fieldset>
        <div className="lm-deadline" aria-live="polite">{dateProblem ? <strong>{dateProblem}</strong> : selectedDay?.lmClosesAt ? <><strong>Claims close {clock(selectedDay.lmClosesAt)} PT · {dayLabel(date)}</strong><span>Waivers must clear first · 10 minutes before the first tip</span></> : <span>{calendar.isLoading ? 'Checking the NBA schedule…' : 'Deadline: 10 minutes before the earliest tip. The server checks eligibility when you submit.'} <Link to={`/waivers?month=${date.slice(0, 7)}&day=${date}`}>Calendar</Link></span>}</div>
        <div><div className="lm-step-label">2 · Choose your player</div><PlayerCombobox key={pickerKey} ariaLabel="Player to claim" disabled={busy} players={dataset.players.filter(entry => entry.espnId !== null)} placeholder="Search for a player to claim…" onSelect={setPlayer} /></div>
        {player && <div className="lm-selected-player"><NavIcon name="jersey" size={22} /><div><strong>{player.fullName ?? player.name}</strong><span>{player.proTeam} · {dayLabel(date)}</span></div><button type="button" onClick={() => { setPlayer(null); setPickerKey(key => key + 1); }} aria-label="Clear selected player">Change</button></div>}
        <p className="lm-roster-reminder"><strong>3 · Make room in ESPN.</strong> If your roster is full, drop a player before this runs. The app never drops players for you.</p>
        <button type="submit" className="tap-btn lm-submit" disabled={busy || !player?.espnId || !!dateProblem}>{busy ? 'Saving claim…' : 'Queue claim'}</button>
        <small>First submitted gets priority. The player must be available, clear normal waivers, and have a game that day.</small>
      </form>}
      {notice && <p className={`lm-notice${failed ? ' is-error' : ''}`} role={failed ? 'alert' : 'status'}>{notice}</p>}
      {query.isError && <p role="alert">Could not load claims. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Retry</button></p>}
      <div className="lm-queue-heading"><h3>{identity?.isCommissioner ? 'Commissioner claim queue' : 'Your advance claims'}</h3><span>{claims.length} open</span></div>
      {query.isLoading && <p role="status">Loading claims…</p>}
      {!query.isLoading && !query.isError && !claims.length && <p className="lm-empty">No claims queued yet. Choose a day and player above to get started.</p>}
      <ol className="lm-claim-queue">{claims.map(claim => <li key={claim.id}>
        <div><strong>{claim.playerName}</strong><span>{claim.owner} · {dayLabel(claim.forDate)} · <b>{claim.status === 'processing' ? 'Checking with ESPN' : 'Queued'}</b></span><small>Submitted {new Date(claim.requestedAt).toLocaleString()}</small><small>{claim.note}</small></div>
        {claim.status === 'queued' && identity && (identity.owner === claim.owner || identity.isCommissioner) && <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void cancel(claim.id)}>Cancel</button>}
      </li>)}</ol>
    </section>
    <LmAddPanel always historyOnly />
  </main>;
}
