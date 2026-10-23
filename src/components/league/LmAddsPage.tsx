import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useDraftData, useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, cancelLmClaim, fetchLmWeekend, queueLmClaim } from '../../lib/league/api.js';
import { pacific } from '../../lib/league/lmWeekend.js';
import { claimPriority } from '../../lib/league/lmClaims.js';
import type { DatasetPlayer } from '../../lib/keeper/types.js';
import PlayerCombobox from './PlayerCombobox.js';
import LmAddPanel from './LmAddPanel.js';

export default function LmAddsPage() {
  const { identity } = useIdentity();
  const { dataset } = useDraftData();
  const [params] = useSearchParams();
  const today = pacific(new Date()).date;
  const next = new Date(`${today}T12:00:00Z`);
  const day = next.getUTCDay();
  if (day !== 0 && day !== 6) next.setUTCDate(next.getUTCDate() + (6 - day + 7) % 7);
  const [date, setDate] = useState(params.get('date') ?? next.toISOString().slice(0, 10));
  const [player, setPlayer] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['lm-claims', identity?.owner ?? null, identity?.isCommissioner === true], queryFn: () => fetchLmWeekend(identity), staleTime: 20_000, refetchInterval: 30_000 });
  const claims = (query.data?.requests ?? []).filter(row => ['queued', 'processing'].includes(row.status)).sort(claimPriority);
  const submit = async () => {
    if (!identity || !player?.espnId) return;
    setBusy(true); setNotice('');
    try { await queueLmClaim(identity, player.espnId, date); setPlayer(null); setNotice('Claim queued. First submitted gets priority; normal waivers must clear.'); await query.refetch(); }
    catch (error) { setNotice(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (!identity) return;
    setBusy(true);
    try { await cancelLmClaim(identity, id); await query.refetch(); setNotice('Claim cancelled.'); }
    catch (error) { setNotice(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <main className="mock-page lm-adds-page">
    <Link className="score-back hub-heading" to="/league">← LEAGUE</Link>
    <h1>LM Adds</h1>
    <section className="panel lm-advance-panel">
      <h2>Advance LM Add claims</h2>
      <p>Submit ahead of an eligible Saturday or Sunday. Claims close 10 minutes before the earliest tip-off. First submitted gets priority. The player must be unrostered, have cleared normal waivers, and play that day. Make room on your ESPN roster before the claim runs.</p>
      {!identity && <p>Sign in to submit a claim.</p>}
      {identity && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="activity-control">LM Add date<input type="date" className="hub-input" aria-label="LM Add date" min={today} value={date} onChange={event => setDate(event.target.value)} required /></label>
        <PlayerCombobox players={dataset.players.filter(entry => entry.espnId !== null)} placeholder="Search for a player to claim…" onSelect={setPlayer} />
        {player && <p>Selected: <strong>{player.fullName ?? player.name}</strong></p>}
        <button type="submit" className="tap-btn mock-mini-btn" disabled={busy || !player?.espnId}>{busy ? 'Saving…' : 'Queue claim'}</button>
      </form>}
      {notice && <p role="status">{notice}</p>}
      {query.isError && <p role="alert">Could not load claims. <button className="tap-btn mock-mini-btn" onClick={() => void query.refetch()}>Retry</button></p>}
      <h3>{identity?.isCommissioner ? 'Commissioner claim queue' : 'Your advance claims'}</h3>
      <p>Advance claims are private to the submitting owner and commissioner. Completed adds are visible to the league.</p>
      {query.isLoading && <p role="status">Loading claims…</p>}
      {!query.isLoading && !claims.length && <p>No open advance claims.</p>}
      <ol className="lm-claim-queue">{claims.map((claim, index) => <li key={claim.id}>
        <div><strong>{index + 1}. {claim.playerName}</strong><span>{claim.owner} · {claim.forDate} · {claim.status}</span><small>Submitted {new Date(claim.requestedAt).toLocaleString()}</small><small>{claim.note}</small></div>
        {claim.status === 'queued' && identity && (identity.owner === claim.owner || identity.isCommissioner) && <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void cancel(claim.id)}>Cancel</button>}
      </li>)}</ol>
    </section>
    <LmAddPanel always />
  </main>;
}
