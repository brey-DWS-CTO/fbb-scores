import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchAutoBench, saveAutoBench, sandboxActive } from '../../lib/league/api.js';

export default function AutoBenchSettings() {
  const { identity } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['auto-bench', identity?.owner, identity?.session], queryFn: () => fetchAutoBench(identity!), enabled: !!identity && !identity.isGuest && !sandboxActive(), staleTime: 30_000 });
  if (!identity || identity.isGuest || sandboxActive()) return null;
  const change = async (enabled: boolean) => {
    setBusy(true); setError('');
    try { await saveAutoBench(identity, enabled); await query.refetch(); }
    catch (error) { setError(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel" style={{ padding: 14, marginBlock: 14 }} aria-label="Pickup auto-benching">
    <h2>Auto-bench pickups</h2>
    <p>ESPN may start pickups in any open eligible spot. Opt in to move your new waiver and free-agent pickups to the bench after they process. Off unless you turn it on.</p>
    <p>Checks every 15 minutes for pickups from the last 45 minutes, until 10 minutes before the day's first game. Requires room on your bench. Older pickups and later lineup choices are left alone. Check your ESPN lineup before tip-off.</p>
    {query.isLoading && <p role="status">Loading your preference...</p>}
    {query.isError && <p role="alert">Could not load your preference. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && <label><input type="checkbox" checked={query.data.enabled} disabled={busy || (!query.data.available && !query.data.enabled)} onChange={event => void change(event.target.checked)} /> Auto-bench my new pickups</label>}
    {query.data && !query.data.available && <p>ESPN automation is currently unavailable.</p>}
    {busy && <p role="status">Saving...</p>}
    {error && <p role="alert">{error}</p>}
    {query.data?.latest && <p role="status">Last check: {query.data.latest.status} — {query.data.latest.note}</p>}
  </section>;
}
