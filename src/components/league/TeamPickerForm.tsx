import { useEffect, useState, type FormEvent } from 'react';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { changePin, claimPin, fetchPinStatus, apiErrorMessage } from '../../lib/league/api.js';

/** Pick an owner and verify or create that owner's PIN. */
export default function TeamPickerForm({ onDone }: { onDone: () => void }) {
  const { signIn } = useIdentity();
  const [owner, setOwner] = useState('');
  const [claimed, setClaimed] = useState<Record<string, boolean> | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPin, setTempPin] = useState<string | null>(null);

  useEffect(() => {
    fetchPinStatus()
      .then((rows) => setClaimed(Object.fromEntries(rows.map((row) => [row.owner, row.claimed]))))
      .catch(() => setClaimed(null));
  }, []);

  const team = owner ? teamByOwner.get(owner) : null;
  const isFirstTime = owner !== '' && claimed !== null && claimed[owner] === false;
  const changing = tempPin !== null;
  const needsRepeat = isFirstTime || changing;
  const ready = owner !== '' && pin.length >= 4 && (!needsRepeat || pin2.length >= 4);

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
    <form className="identity-form" onSubmit={submit}>
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
  );
}
