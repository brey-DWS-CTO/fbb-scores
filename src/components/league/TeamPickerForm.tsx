import { useEffect, useState, type FormEvent } from 'react';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  changePin,
  claimPin,
  fetchPinStatus,
  requestLoginLink,
  retryAfterSeconds,
  apiErrorMessage,
} from '../../lib/league/api.js';

/**
 * Sign in. The email link is the front door: type your address, tap the link
 * we send, you're in. The old owner-and-PIN path sits underneath so anyone who
 * hasn't used a link yet is never locked out.
 */
export default function TeamPickerForm({ onDone }: { onDone: () => void }) {
  const { signIn } = useIdentity();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [pinMode, setPinMode] = useState(false);
  const [owner, setOwner] = useState('');
  const [claimed, setClaimed] = useState<Record<string, boolean> | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPin, setTempPin] = useState<string | null>(null);

  useEffect(() => {
    // Only the PIN path needs this, so don't spend the call until it's open.
    if (!pinMode) return;
    fetchPinStatus()
      .then((rows) => setClaimed(Object.fromEntries(rows.map((row) => [row.owner, row.claimed]))))
      .catch(() => setClaimed(null));
  }, [pinMode]);

  const team = owner ? teamByOwner.get(owner) : null;
  const isFirstTime = owner !== '' && claimed !== null && claimed[owner] === false;
  const changing = tempPin !== null;
  const needsRepeat = isFirstTime || changing;
  const ready = owner !== '' && pin.length >= 4 && (!needsRepeat || pin2.length >= 4);
  const emailReady = email.trim().length > 3 && email.includes('@');

  const sendLink = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!emailReady || linkBusy) return;
    const address = email.trim();
    setLinkBusy(true);
    setLinkError(null);
    try {
      await requestLoginLink(address);
      setSentTo(address);
    } catch (caught) {
      const wait = retryAfterSeconds(caught);
      setLinkError(
        wait === null
          ? apiErrorMessage(caught)
          : `Too many tries. Wait ${wait} seconds, then ask again.`,
      );
    } finally {
      setLinkBusy(false);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (needsRepeat && pin !== pin2) {
        setError("PINs don't match. Type the same PIN twice.");
        return;
      }
      if (changing) {
        await changePin({ owner, pin: tempPin }, pin);
        const result = await signIn(owner, pin);
        if (result.ok) onDone();
        else setError(result.error ?? 'Sign-in failed');
        return;
      }
      if (isFirstTime) await claimPin(owner, pin);
      const result = await signIn(owner, pin);
      if (result.ok) onDone();
      else if (result.mustChangePin) {
        setTempPin(pin);
        setPin('');
        setPin2('');
      } else {
        setError(result.error ?? 'Sign-in failed');
      }
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const chooseOwner = (nextOwner: string) => {
    setOwner(nextOwner);
    setPin('');
    setPin2('');
    setError(null);
    setTempPin(null);
  };

  return (
    <div className="identity-form">
      {sentTo === null ? (
        <form onSubmit={sendLink}>
          <label className="identity-label" htmlFor="identity-email">YOUR EMAIL</label>
          <input
            id="identity-email"
            className="identity-email-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className="tap-btn identity-submit" type="submit" disabled={!emailReady || linkBusy}>
            {linkBusy ? 'SENDING…' : 'SEND ME A LINK'}
          </button>
          {linkError && <div className="identity-error" role="alert">{linkError}</div>}
          <p className="identity-help">
            We send you a link. Tap it on this phone and you're in. No PIN to remember.
          </p>
        </form>
      ) : (
        <div className="identity-notice identity-notice-ok" role="status">
          <strong>Check your email.</strong>
          <br />
          We sent a link to {sentTo}. It works for 15 minutes.
          <br />
          <button
            className="identity-alt-link"
            type="button"
            onClick={() => {
              setSentTo(null);
              setLinkError(null);
            }}
          >
            Send it again
          </button>
        </div>
      )}

      <div className="identity-alt-row">
        <button
          className="identity-alt-link"
          type="button"
          onClick={() => setPinMode(!pinMode)}
        >
          {pinMode ? 'Sign in with an email link instead' : 'Sign in with a PIN instead'}
        </button>
      </div>

      {pinMode && (
        <form onSubmit={submit}>
          <label className="identity-label" htmlFor="identity-owner">YOUR NAME</label>
          <div className="identity-select-wrap">
            <select
              id="identity-owner"
              className="identity-select"
              value={owner}
              onChange={(event) => chooseOwner(event.target.value)}
            >
              <option value="">Select your name…</option>
              {OWNERS.map((candidate) => {
                const candidateTeam = teamByOwner.get(candidate);
                const isNew = claimed !== null && claimed[candidate] === false;
                return (
                  <option key={candidate} value={candidate}>
                    {candidate} · {candidateTeam?.espnTeamName}{isNew ? ' · NEW' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {team && (
            <div className="identity-team-card">
              <div>
                <strong>{team.owner}</strong>
                <span>{team.espnTeamName}</span>
              </div>
              <div className="identity-draft-slot">
                <span>DRAFT</span>
                <strong>#{team.draftPosition}</strong>
              </div>
            </div>
          )}

          {owner && (
            <>
              {changing && (
                <div className="identity-notice identity-notice-ok">
                  Temporary PIN accepted. Choose your own 4–8 digit PIN.
                </div>
              )}
              {!changing && isFirstTime && (
                <div className="identity-notice">
                  First visit: choose a 4–8 digit PIN, then enter it again.
                </div>
              )}

              <div className={needsRepeat ? 'identity-pin-grid identity-pin-grid-repeat' : 'identity-pin-grid'}>
                <label>
                  <span className="identity-label">{needsRepeat ? 'NEW PIN' : 'PIN'}</span>
                  <input
                    className="identity-pin-input"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="current-password"
                    placeholder="••••"
                    value={pin}
                    maxLength={8}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </label>
                {needsRepeat && (
                  <label>
                    <span className="identity-label">REPEAT PIN</span>
                    <input
                      className="identity-pin-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="new-password"
                      placeholder="••••"
                      value={pin2}
                      maxLength={8}
                      onChange={(event) => setPin2(event.target.value.replace(/\D/g, ''))}
                    />
                  </label>
                )}
              </div>

              <button className="tap-btn identity-submit" type="submit" disabled={!ready || busy}>
                {busy ? 'CHECKING…' : needsRepeat ? 'SET PIN & ENTER' : 'ENTER LEAGUE'}
              </button>
            </>
          )}

          {error && <div className="identity-error" role="alert">{error}</div>}

          <p className="identity-help">
            {isFirstTime
              ? 'Your keeper picks stay hidden until the commish reveals them.'
              : 'Forgot your PIN? Ask Brey to reset it in Commish Mode.'}
          </p>
        </form>
      )}
    </div>
  );
}
