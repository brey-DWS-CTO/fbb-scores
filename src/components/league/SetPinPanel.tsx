import { useState, type FormEvent } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, changePin } from '../../lib/league/api.js';

/**
 * Set or replace your own PIN, once you are already signed in.
 *
 * Signing in by link is the normal way now, but a PIN still gets you in with
 * no inbox and no signal, which is worth having on draft day. The server
 * takes the owner from the session, so this can only ever change your own.
 */
export default function SetPinPanel() {
  const { identity } = useIdentity();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!identity) return null;

  const ready = /^\d{4,8}$/.test(pin);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await changePin(identity, pin);
      setPin('');
      setDone(true);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="account-pin-toggle" type="button" onClick={() => setOpen(true)}>
        {done ? 'PIN saved. Change it again' : 'Set a PIN for this team'}
      </button>
    );
  }

  return (
    <form className="account-pin" onSubmit={(event) => void submit(event)}>
      <div className="identity-label">SET A PIN</div>
      <p className="account-pin-note">
        A backup way in when you cannot get to your email. Four to eight digits.
      </p>
      <div className="account-pin-row">
        <input
          className="identity-email-input"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          placeholder="4 to 8 digits"
          aria-label="New PIN"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
        <button className="tap-btn identity-submit" type="submit" disabled={!ready || busy}>
          {busy ? '…' : 'SAVE'}
        </button>
      </div>
      {done && <p className="account-pin-done">PIN saved.</p>}
      {error && <p className="account-pin-error">{error}</p>}
    </form>
  );
}
