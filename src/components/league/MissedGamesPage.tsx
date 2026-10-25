import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity, type Identity } from '../../hooks/useLeague.js';
import { apiErrorMessage, sandboxActive } from '../../lib/league/api.js';
import { fetchMissedGames, refreshMissedGames, approveMissedExemption } from '../../lib/league/missedGamesApi.js';
import './missedGames.css';
export default function MissedGamesPage() {
  const { identity } = useIdentity();
  return <main className="mock-page missed-games-page"><h1>Missed games report</h1>
    <p>Four matchups with missed games removes play-in eligibility. Top-four playoff qualification remains available.</p>
    {identity?.isCommissioner && !identity.isGuest && !sandboxActive() ? <Report key={[identity.owner, identity.session].join(':')} identity={identity} /> : <p>Sign in as a commissioner to view this report.</p>}
  </main>;
}
function Report({ identity }: { identity: Identity }) {
  const client = useQueryClient();
  const key = useMemo(() => ['missed-games', identity.owner, identity.session], [identity.owner, identity.session]);
  const autoRefreshed = useRef(false);
  const query = useQuery({ queryKey: key, queryFn: () => fetchMissedGames(identity) });
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState('');
  const [recheckWeek, setRecheckWeek] = useState('');
  const recheck = async () => {
    if (!recheckWeek || working.current) return;
    working.current = true; setBusy(true);
    try { client.setQueryData(key, await refreshMissedGames(identity, Number(recheckWeek))); setMessage('Refresh finished. Check the saved week status and timestamp below.'); }
    catch (error) { setMessage(apiErrorMessage(error)); }
    finally { working.current = false; setBusy(false); }
  };
  const refresh = useCallback(async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setMessage('Checking the current week…');
    try {
      let report = await refreshMissedGames(identity, null);
      client.setQueryData(key, report);
      for (const week of report.pendingWeeks) {
        setMessage(`Verifying Week ${week}…`);
        report = await refreshMissedGames(identity, week);
        client.setQueryData(key, report);
      }
      setMessage(report.pendingWeeks.length ? 'Some closed weeks could not be verified. They do not count toward penalties yet.' : 'Report refreshed. Open weeks remain provisional.');
    } catch (error) { setMessage(apiErrorMessage(error)); }
    finally { working.current = false; setBusy(false); }
  }, [client, identity, key]);
  useEffect(() => {
    if (!query.isSuccess || autoRefreshed.current) return;
    autoRefreshed.current = true;
    void refresh();
  }, [query.isSuccess, refresh]);
  const approve = async () => {
    if (!selected || working.current) return;
    working.current = true; setBusy(true);
    const [teamId, week] = selected.split(':').map(Number);
    try { client.setQueryData(key, await approveMissedExemption(identity, week, teamId, reason)); setMessage('Approval recorded. An exemption takes effect after both commissioners approve the same reason.'); }
    catch (error) { setMessage(apiErrorMessage(error)); }
    finally { working.current = false; setBusy(false); }
  };
  const report = query.data;
  return <>
    <button className="tap-btn" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh / backfill from ESPN'}</button>
    <p role="status" aria-live="polite">{message}</p>
    {query.isPending && <p>Loading saved report…</p>}
    {query.isError && <p role="alert">{apiErrorMessage(query.error)} <button className="tap-btn" onClick={() => void query.refetch()}>Retry</button></p>}
    {report && <>
      <p>Season {report.season} · Completed matchups only. Weekly limits match Scores. Open weeks show games still needed and never count as missed weeks.</p>
      {(!report.calendarKnown || report.pendingWeeks.length > 0) && <p role="status">Coverage incomplete. Refresh to verify {report.pendingWeeks.length ? `Week ${report.pendingWeeks.join(', ')}` : 'the season calendar'}. Eligibility is pending until closed weeks are verified.</p>}
      <div className="missed-games-scroll"><table><caption>Season missed-games totals</caption><thead><tr><th>Owner</th><th>Weeks missed</th><th>Games missed</th><th>Weeks counted</th><th>Play-in eligibility</th></tr></thead><tbody>
        {report.teams.map(team => <tr key={team.teamId}><th scope="row">{team.owner}</th><td>{team.missedWeeks}</td><td>{team.totalGamesMissed}</td><td>{team.countedWeeks} / {report.maxMissedWeeks}</td><td>{team.playInEligible === false ? 'Ineligible · Top 4 required' : team.playInEligible === null ? 'Pending verification' : team.countedWeeks === 3 ? 'Eligible · At limit' : 'Eligible so far'}</td></tr>)}
      </tbody></table></div>
      {report.teams.map(team => <details key={team.teamId}><summary>{team.owner} · Weekly detail</summary><div className="missed-games-scroll"><table><caption>{team.owner}: matchup audit</caption><thead><tr><th>Week</th><th>Status</th><th>Played / Limit</th><th>Missed / Needed</th><th>Exemption</th></tr></thead><tbody>
        {team.history.map(w => <tr key={w.week}><th scope="row">{w.label}</th><td>{w.status}</td><td>{w.played ?? '—'} / {w.cap}</td><td>{w.status === 'incomplete' ? 'Unverified' : `${w.missed ?? '—'}${w.status === 'provisional' ? ' still needed' : ' missed'}`}</td><td>{w.exemption ? `${w.exempt ? 'Approved' : 'Pending'}: ${w.exemption.reason} (${w.exemption.approvals.join(', ')})` : 'None'}</td></tr>)}
      </tbody></table></div></details>)}
      <details><summary>Commissioner exemptions</summary><p>Rule 6.7.1: both commissioners must approve the same reason. Actual missed-game totals stay visible; an approved week is removed from the eligibility count.</p>
        <form onSubmit={event => { event.preventDefault(); void approve(); }}>
          <label>Team and week<select required value={selected} onChange={event => { setSelected(event.target.value); const [id, week] = event.target.value.split(':').map(Number); setReason(report.teams.find(t => t.teamId === id)?.history.find(w => w.week === week)?.exemption?.reason ?? ''); }}><option value="">Choose…</option>{report.teams.flatMap(t => t.history.filter(w => w.status === 'final' && (w.missed ?? 0) > 0).map(w => <option key={`${t.teamId}:${w.week}`} value={`${t.teamId}:${w.week}`}>{t.owner} · {w.label}</option>))}</select></label>
          <label>Reason<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <button className="tap-btn" disabled={busy || !selected || !reason.trim()}>Record my approval</button>
        </form>
      </details>
      <form onSubmit={event => { event.preventDefault(); void recheck(); }}><label>Recheck a saved week<select required value={recheckWeek} onChange={event => setRecheckWeek(event.target.value)}><option value="">Choose…</option>{report.weeks.map(w => <option key={w.matchupPeriodId} value={w.matchupPeriodId}>{w.label}</option>)}</select></label><button className="tap-btn" disabled={busy || !recheckWeek}>Recheck week</button></form>
      <p>Saved checks: {report.weeks.map(w => `${w.label}: ${new Date(w.fetchedAt).toLocaleString()}`).join(' · ') || 'None yet.'} Automatic catch-up runs daily at 8 AM Pacific.</p>
    </>}
  </>;
}
