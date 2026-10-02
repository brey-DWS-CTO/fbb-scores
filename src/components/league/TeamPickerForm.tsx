import { useEffect, useRef, useState, type FormEvent } from 'react';
import { OWNERS } from '../../lib/league/data.js';
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
 * Sign in: pick your name, type your PIN. An emailed link sits underneath for
 * anyone who would rather not remember a PIN.
 */
export default function TeamPickerForm({ onDone }: { onDone: () => void }) {
  const { signIn } = useIdentity();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [owner, setOwner] = useState('');
  const [claimed, setClaimed] = useState<Record<string, boolean> | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPin, setTempPin] = useState<string | null>(null);

  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Whose PIN is still unclaimed, so a first visit asks for it twice.
    fetchPinStatus()
      .then((rows) => setClaimed(Object.fromEntries(rows.map((row) => [row.owner, row.claimed]))))
      .catch(() => setClaimed(null));
  }, []);

  const isFirstTime = owner !== '' && claimed !== null && claimed[owner] === false;
  const changing = tempPin !== null;
  const needsRepeat = isFirstTime || changing;
  const ready = owner !== '' && pin.length >= 4 && (!needsRepeat || pin2.length >= 4);
  const emailReady = email.trim().length > 3 && email.includes('@');
  const sendingRef = useRef(false);

  const sendLink = async (event?: FormEvent) => {
    event?.preventDefault();
    // A double tap fires twice before the busy flag has re-rendered, which
    // sends two links and burns two of the three tries in the window. A ref
    // is true the instant it is set, so the second tap finds it.
    if (!emailReady || linkBusy || sendingRef.current) return;
    sendingRef.current = true;
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
      sendingRef.current = false;
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
    // The box is disabled until a name is picked; wait for that render.
    if (nextOwner) setTimeout(() => pinRef.current?.focus(), 0);
  };

  return (
    <div className="identity-form">
      <form onSubmit={submit}>
        <label className="identity-label" htmlFor="identity-owner">YOUR NAME</label>
        <div className="identity-select-wrap">
          <select
            id="identity-owner"
            className="identity-select"
            value={owner}
            onChange={(event) => chooseOwner(event.target.value)}
          >
            <option value="">Pick your name…</option>
            {OWNERS.map((candidate) => (
              <option key={candidate} value={candidate}>{candidate}</option>
            ))}
          </select>
        </div>

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

        {/* The PIN box is always here, so picking a name never resizes the sheet. */}
        <div className={needsRepeat ? 'identity-pin-grid identity-pin-grid-repeat' : 'identity-pin-grid'}>
          <label>
            <span className="identity-label">{needsRepeat ? 'NEW PIN' : 'PIN'}</span>
            <input
              ref={pinRef}
              className="identity-pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••"
              value={pin}
              maxLength={8}
              disabled={owner === ''}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          {needsRepeat && (
            <label>
              <span className="identity-label">REPEAT PIN</span>
              <input
                className="identity-pin-input"
                type="password"
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
          {busy ? 'CHECKING…' : needsRepeat ? 'SET PIN & SIGN IN' : 'SIGN IN'}
        </button>
        {error && <div className="identity-error" role="alert">{error}</div>}
        <p className="identity-help">Forgot your PIN? Ask Brey, or get a link by email below.</p>
      </form>

      <div className="identity-or"><span>OR BY EMAIL</span></div>

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
          <button className="tap-btn identity-submit identity-submit-quiet" type="submit" disabled={!emailReady || linkBusy}>
            {linkBusy ? 'SENDING…' : 'SEND ME A LINK'}
          </button>
          {linkError && <div className="identity-error" role="alert">{linkError}</div>}
          <p className="identity-help">Tap the link we send and you&apos;re in. No PIN needed.</p>
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
    </div>
  );
}
