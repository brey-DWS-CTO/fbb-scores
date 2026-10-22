import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, createGuestInvite, fetchGuestAccess, revokeGuestInvite } from '../../lib/league/api.js';
export default function GuestAccessAdmin() {
  const { identity } = useIdentity();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const query = useQuery({ queryKey: ['guest-access'], queryFn: () => fetchGuestAccess(identity!), enabled: identity?.isCommissioner === true });
  const create = async () => {
    if (!identity) return;
    setBusy(true); setMessage('');
    try { const next = await createGuestInvite(identity, name); setInvite(next); setName(''); await client.invalidateQueries({ queryKey: ['guest-access'] }); }
    catch (error) { setMessage(apiErrorMessage(error)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    if (!identity) return;
    setBusy(true); setMessage('');
    try { await revokeGuestInvite(identity, id); if (invite?.id === id) setInvite(null); await client.invalidateQueries({ queryKey: ['guest-access'] }); setMessage('Guest access revoked.'); }
    catch (error) { setMessage(apiErrorMessage(error)); } finally { setBusy(false); }
  };
  return <section className="panel guest-access-admin">
    <h2>Guest access</h2><p>Create a read-only link for a guest to watch scores, Cast, rosters, and history. Guest links never expire. Anyone with the link can use it until you revoke it.</p>
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <label>Guest name<input className="hub-input" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
      <button className="tap-btn mock-mini-btn" disabled={busy}>Create guest link</button>
    </form>
    {invite && <div><label>Invite link<input className="hub-input" readOnly value={invite.url} onFocus={event => event.currentTarget.select()} /></label><button type="button" className="tap-btn mock-mini-btn" onClick={() => { void navigator.clipboard.writeText(invite.url).then(() => setMessage('Link copied.')).catch(() => setMessage('Select the invite link above to copy it.')); }}>Copy link</button></div>}
    {message && <p role="status">{message}</p>}
    {query.isLoading && <p role="status">Loading guests…</p>}
    {query.isError && <p role="alert">Could not load guest links. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data?.length === 0 && <p>No active guest links.</p>}
    <ul>{query.data?.map(guest => <li key={guest.id}><span><strong>{guest.name}</strong> · {guest.expiresAt ? `expires ${new Date(guest.expiresAt).toLocaleDateString()}` : 'Never expires'}</span><button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void revoke(guest.id)}>Revoke</button></li>)}</ul>
  </section>;
}
