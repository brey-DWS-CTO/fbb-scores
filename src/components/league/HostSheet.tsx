import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, editHouseParty, openHouseParty } from '../../lib/league/api.js';
import {
  dayLabel,
  gameDay,
  matchupLabel,
  MAX_PARTY_GAMES,
  MAX_PARTY_NOTE,
  tipLabel,
  type HouseParty,
  type NbaGame,
  type WatchGame,
} from '../../lib/league/houseParty.js';
import TeamLogo from './TeamLogo.js';

interface Props {
  /** The game tapped. For an edit, the party's main game. */
  main: NbaGame;
  /** Every game on the list, so the night's others can be picked. */
  games: readonly WatchGame[];
  /** Editing this party, instead of opening a new one. */
  editing?: HouseParty | null;
  onDone: (party: HouseParty) => void;
  onClose: () => void;
}

/**
 * Throw a party: the game tapped is the main one, up to two more from the
 * same night are the undercard, and a note says where. The same sheet edits
 * a party's games and note.
 */
export default function HostSheet({ main, games, editing = null, onDone, onClose }: Props) {
  const { identity } = useIdentity();
  const night = gameDay(main.tipoff);
  const others = games.filter((game) => game.id !== main.id && gameDay(game.tipoff) === night && game.state !== 'post');
  const [extra, setExtra] = useState<string[]>(editing ? editing.games.slice(1).map((game) => game.id) : []);
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExtra((current) => (current.includes(id) ? current.filter((row) => row !== id) : current.length < MAX_PARTY_GAMES - 1 ? [...current, id] : current));
  };

  const save = async () => {
    if (!identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gameIds = [main.id, ...extra];
      const result = editing
        ? await editHouseParty(identity, editing.id, { gameIds, note })
        : await openHouseParty(identity, { gameIds, hosting: true, note });
      onDone(result.party);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="account-backdrop" onClick={onClose}>
      <div className="panel account-sheet host-sheet" role="dialog" aria-modal="true" aria-labelledby="host-sheet-title" onClick={(event) => event.stopPropagation()}>
        <div className="account-sheet-header">
          <div>
            <div className="splash-step">{editing ? 'YOUR PARTY' : 'THROW A PARTY'}</div>
            <h2 id="host-sheet-title">{matchupLabel(main)}</h2>
            <p>{dayLabel(main.tipoff)}, {tipLabel(main.tipoff)}{main.tv ? ` on ${main.tv}` : ''}</p>
          </div>
          <button className="tap-btn account-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {others.length > 0 && (
          <div className="host-undercard">
            <div className="identity-label">ALSO ON THAT NIGHT (PICK UP TO {MAX_PARTY_GAMES - 1})</div>
            {others.map((game) => {
              const on = extra.includes(game.id);
              const full = !on && extra.length >= MAX_PARTY_GAMES - 1;
              return (
                <label key={game.id} className={`host-undercard-row${on ? ' is-on' : ''}${full ? ' is-full' : ''}`}>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(game.id)} />
                  <TeamLogo code={game.away} size={22} />
                  <TeamLogo code={game.home} size={22} />
                  <span>
                    <strong>{matchupLabel(game)}</strong>
                    <small>{tipLabel(game.tipoff)}{game.tv ? ` · ${game.tv}` : ''}</small>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <label className="identity-label" htmlFor="host-note">WHERE, AND WHAT TO BRING</label>
        <textarea
          id="host-note"
          className="hub-input host-note"
          rows={3}
          maxLength={MAX_PARTY_NOTE}
          placeholder="12 Elm St. Bring beer."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error && <div className="mock-note mock-note-bad">{error}</div>}
        <div className="favorites-actions">
          <button type="button" className="tap-btn mock-mini-btn is-host" disabled={busy} onClick={() => void save()}>
            {busy ? 'SAVING…' : editing ? 'SAVE' : 'HOST IT'}
          </button>
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={onClose}>NEVER MIND</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
