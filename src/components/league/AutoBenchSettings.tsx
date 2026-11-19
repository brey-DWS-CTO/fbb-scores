import { useState } from 'react';
import type { AutoBenchPreview } from '../../lib/league/autoBench.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, checkAutoBench, fetchAutoBench, saveAutoBench, sandboxActive } from '../../lib/league/api.js';

export default function AutoBenchSettings() {
  const { identity } = useIdentity();
  const client = useQueryClient();
  const [preview, setPreview] = useState<AutoBenchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['auto-bench', identity?.owner, identity?.session], queryFn: () => fetchAutoBench(identity!), enabled: !!identity && !identity.isGuest && !sandboxActive(), staleTime: 30_000 });
  if (!identity || identity.isGuest || sandboxActive()) return null;
  const change = async (enabled: boolean) => {
    setBusy(true); setError(''); setPreview(null);
    try { await saveAutoBench(identity, enabled); }
    catch (error) { setError(apiErrorMessage(error)); }
    finally { await query.refetch(); await client.invalidateQueries({ queryKey: ['my-team'] }); setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setError(''); setPreview(null);
    try { setPreview(await checkAutoBench(identity)); }
    catch (error) { setError(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel" style={{ padding: 14, marginBlock: 14 }} aria-label="Pickup auto-benching">
    <h2>Auto-bench pickups</h2>
    <p>ESPN may start pickups in any open eligible spot. Opt in to move your new pickups out of the starting lineup after waivers run. LM adds are excluded. Opting in also opens your My Team roster view. Off unless you turn it on.</p>
    <p>Runs once per day, 15 minutes after that day's waiver time, only if you opted in and a new non-LM pickup is starting. All eligible pickups are handled together. Requires room on your bench; later lineup choices are preserved.</p>
    {query.isLoading && <p role="status">Loading your preference...</p>}
    {query.isError && <p role="alert">Could not load your preference. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && <label><input type="checkbox" checked={query.data.enabled} disabled={busy || (!query.data.available && !query.data.enabled)} onChange={event => void change(event.target.checked)} /> Auto-bench my new pickups</label>}
    {query.data && !query.data.available && <p>ESPN automation is currently unavailable.</p>}
    <p><button type="button" className="tap-btn mock-mini-btn" disabled={busy || !query.data?.available || !query.data.enabled} onClick={() => void check()}>Check without making changes</button></p>
    {preview && <div role="status"><p>Read-only check · Today's scheduled run: {new Date(preview.runAt).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })} Pacific.</p>
      {preview.rows.length ? <ul>{preview.rows.map(row => <li key={row.playerId}><b>{row.name}</b>: {row.decision}</li>)}</ul> : <p>No pickups from today's waiver run to evaluate.</p>}
    </div>}
    {busy && <p role="status">Working...</p>}
    {error && <p role="alert">{error} {query.data?.enabled && <button type="button" disabled={busy} onClick={() => void change(true)}>Retry saving</button>}</p>}
    {query.data?.latest && <p role="status">Last check: {query.data.latest.status} — {query.data.latest.note}</p>}
  </section>;
}
