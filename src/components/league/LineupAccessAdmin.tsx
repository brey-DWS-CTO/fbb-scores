import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, sandboxActive } from '../../lib/league/api.js';
import { fetchLineupAccess, saveLineupAccess, type LineupGrant } from '../../lib/league/lineupApi.js';
import './myTeam.css';

export default function LineupAccessAdmin() {
  const { identity } = useIdentity();
  const client = useQueryClient();
  const [owner, setOwner] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sandbox = sandboxActive();
  const key = ['lineup-access', identity?.owner, identity?.session];
  const access = useQuery({ queryKey: key, queryFn: () => fetchLineupAccess(identity!), enabled: identity?.isCommissioner === true && !sandbox });
  const save = async (grant: LineupGrant) => {
    if (!identity || busy || sandbox) return;
    setBusy(true); setMessage('');
    try {
      await saveLineupAccess(identity, grant);
      await client.invalidateQueries({ queryKey: key });
      setMessage(grant.enabled ? 'Access saved. ESPN execution remains subject to verification.' : 'Access revoked.');
    } catch (error) { setMessage(apiErrorMessage(error)); }
    finally { setBusy(false); }
  };
  if (!identity?.isCommissioner) return null;
  return <section className="panel lineup-access-admin">
    <h2>Lineup access</h2>
    <p>Access is off by default. Map an owner to their verified ESPN league and team. Initial access is restricted to your own team.</p>
    <p>Granting access does not enable unverified ESPN writes.</p>
    {sandbox ? <p>Lineup access cannot be changed in test mode.</p> : <>
      {access.isLoading && <p role="status">Loading access…</p>}
      {access.isError && <p role="alert">{apiErrorMessage(access.error)} <button type="button" onClick={() => void access.refetch()}>Retry</button></p>}
      {access.data && <>
        <form onSubmit={event => {
          event.preventDefault();
          void save({ owner, enabled: true, leagueId: leagueId.trim(), teamId: Number(teamId) });
        }}>
          <label>Owner<select className="hub-input" required value={owner} onChange={event => {
            const nextOwner = event.target.value;
            setOwner(nextOwner);
            const grant = access.data.grants.find(row => row.owner === nextOwner);
            setLeagueId(grant?.leagueId ?? ''); setTeamId(grant ? String(grant.teamId) : '');
          }}><option value="">Choose owner</option>{access.data.owners.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>ESPN league ID<input className="hub-input" required inputMode="numeric" pattern="[0-9]+" value={leagueId} onChange={event => setLeagueId(event.target.value)} /></label>
          <label>ESPN team ID<input className="hub-input" required type="number" min="1" step="1" value={teamId} onChange={event => setTeamId(event.target.value)} /></label>
          <button type="submit" className="tap-btn" disabled={busy || !owner}>Grant access</button>
        </form>
        <ul>{access.data.grants.map(grant => <li key={grant.owner}>
          <span><strong>{grant.owner}</strong> · League {grant.leagueId}, team {grant.teamId} · {grant.enabled ? 'Enabled' : 'Revoked'}</span>
          {grant.enabled && <button type="button" className="tap-btn" disabled={busy} onClick={() => void save({ ...grant, enabled: false })}>Revoke</button>}
        </li>)}</ul>
        {access.data.grants.length === 0 && <p>No lineup access has been granted.</p>}
      </>}
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
