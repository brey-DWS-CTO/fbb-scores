import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { OWNERS } from '../../lib/league/data.js';
import { apiErrorMessage, inviteToHouseParty } from '../../lib/league/api.js';
import { invitable, matchupLabel, type HouseParty } from '../../lib/league/houseParty.js';

interface Props {
  party: HouseParty;
  onDone: (party: HouseParty) => void;
  onClose: () => void;
}

const OWNERS_A_TO_Z = [...OWNERS].sort((a, b) => a.localeCompare(b));

/** Pick who to ask. They see a popup the next time they open the app. */
export default function InviteSheet({ party, onDone, onClose }: Props) {
  const { identity } = useIdentity();
  const viewer = identity?.owner ?? '';
  const open = invitable(party, OWNERS_A_TO_Z, viewer);
  const [picked, setPicked] = useState<string[]>(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (owner: string) => setPicked((current) => (current.includes(owner) ? current.filter((row) => row !== owner) : [...current, owner]));

  const send = async () => {
    if (!identity || busy || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      onDone((await inviteToHouseParty(identity, party.id, picked)).party);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="account-backdrop" onClick={onClose}>
      <div className="panel account-sheet host-sheet" role="dialog" aria-modal="true" aria-labelledby="invite-sheet-title" onClick={(event) => event.stopPropagation()}>
        <div className="account-sheet-header">
          <div>
            <div className="splash-step">INVITE</div>
            <h2 id="invite-sheet-title">{party.games[0] ? matchupLabel(party.games[0]) : 'House party'}</h2>
            <p>They see a popup the next time they open the app.</p>
          </div>
          <button className="tap-btn account-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        {open.length === 0 && <div className="mock-note mock-note-dim">Everyone is in or already asked.</div>}
        <div className="host-undercard">
          {open.map((owner) => (
            <label key={owner} className={`host-undercard-row${picked.includes(owner) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(owner)} onChange={() => toggle(owner)} />
              <span><strong>{owner}</strong></span>
            </label>
          ))}
        </div>
        {error && <div className="mock-note mock-note-bad">{error}</div>}
        <div className="favorites-actions">
          <button type="button" className="tap-btn mock-mini-btn is-host" disabled={busy || picked.length === 0} onClick={() => void send()}>
            {busy ? 'SENDING…' : `INVITE ${picked.length}`}
          </button>
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={onClose}>NEVER MIND</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
