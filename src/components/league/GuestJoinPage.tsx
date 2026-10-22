import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { consumeGuestInvite, apiErrorMessage } from '../../lib/league/api.js';
export default function GuestJoinPage() {
  const { token } = useParams();
  const { identity, signInWithSession } = useIdentity();
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const member = identity && !identity.isGuest;
  useEffect(() => {
    if (started.current || member || !token) return;
    started.current = true;
    consumeGuestInvite(token).then(result => { signInWithSession(result); setReady(true); }).catch(caught => setError(apiErrorMessage(caught)));
  }, [token, member, signInWithSession]);
  if (ready) return <Navigate to="/scores" replace />;
  return <main className="splash-page"><section className="panel splash-login-card">
    <h1>Watch The Nerds</h1>
    {member ? <><p>You’re already signed in as a league owner.</p><Link to="/scores">Continue to scores</Link></> : error ? <p role="alert">{error}</p> : <p role="status">Opening your guest access…</p>}
    <p>Guest access includes scores, Fantasy Cast, rosters, and history. It is read-only.</p>
  </section></main>;
}
