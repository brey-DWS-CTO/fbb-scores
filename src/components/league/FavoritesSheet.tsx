import { useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, saveFavorites } from '../../lib/league/api.js';
import { NBA_TEAM_INFO, type FavoriteTeams, type FavoritesByOwner } from '../../lib/league/houseParty.js';
import TeamLogo from './TeamLogo.js';

interface Props {
  current: FavoriteTeams | null;
  /** Called with everyone's favorites after a save, or with null after CLEAR. */
  onSaved: (favorites: FavoritesByOwner) => void;
  onSkip?: () => void;
  /** The words above the pickers. */
  title?: string;
  compact?: boolean;
}

/** The 30 teams, Atlanta to Washington, for a select. */
function TeamOptions({ none }: { none: string }) {
  return (
    <>
      <option value="">{none}</option>
      {NBA_TEAM_INFO.map((team) => (
        <option key={team.code} value={team.code}>{team.city} {team.name}</option>
      ))}
    </>
  );
}

/**
 * Pick a favorite team and, if you like, a second. The same form sits in the
 * account sheet, in the first-sign-in prompt and on the WATCH page.
 */
export default function FavoritesSheet({ current, onSaved, onSkip, title = 'FAVORITE TEAMS', compact = false }: Props) {
  const { identity } = useIdentity();
  const [first, setFirst] = useState(current?.first ?? '');
  const [second, setSecond] = useState(current?.second ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (clear = false) => {
    if (!identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const favorites = await saveFavorites(identity, clear ? null : first, clear || !second ? null : second);
      if (clear) {
        setFirst('');
        setSecond('');
      }
      onSaved(favorites);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const changed = first !== (current?.first ?? '') || (second || '') !== (current?.second ?? '');

  return (
    <div className={compact ? 'favorites-sheet is-compact' : 'favorites-sheet'}>
      <div className="identity-label">{title}</div>
      <div className="favorites-row">
        <TeamLogo code={first || null} size={34} />
        <select className="hub-input favorites-select" aria-label="First favorite team" value={first} onChange={(event) => setFirst(event.target.value)}>
          <TeamOptions none="Pick a team…" />
        </select>
      </div>
      <div className="favorites-row">
        <TeamLogo code={second || null} size={34} />
        <select className="hub-input favorites-select" aria-label="Second favorite team" value={second} onChange={(event) => setSecond(event.target.value)} disabled={!first}>
          <TeamOptions none="Second team (optional)" />
        </select>
      </div>
      {error && <div className="mock-note mock-note-bad">{error}</div>}
      <div className="favorites-actions">
        <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busy || !first || !changed || (second !== '' && second === first)} onClick={() => void save()}>
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        {current && (
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void save(true)}>CLEAR</button>
        )}
        {onSkip && (
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={onSkip}>SKIP</button>
        )}
      </div>
      {second !== '' && second === first && <div className="mock-note mock-note-warn">Your second team has to be a different team.</div>}
    </div>
  );
}
