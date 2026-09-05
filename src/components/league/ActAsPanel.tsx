import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';

/**
 * Sign in as another owner, commissioner only.
 *
 * This replaces guessing what a member can see. It grants exactly their
 * rights and nothing more, it lapses in hours, and the audit log records both
 * names on everything done from that seat.
 */
export default function ActAsPanel() {
  const { identity, actAs } = useIdentity();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!identity?.isCommissioner) return null;

  const take = async (owner: string) => {
    setBusy(owner);
    setError(null);
    const result = await actAs(owner);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? 'Could not take that seat');
      return;
    }
    navigate(`/keepers/${owner}`);
  };

  const others = OWNERS.filter((owner) => owner !== identity.owner);

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 4 }}>
        ACT AS ANOTHER OWNER
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: 10 }}>
        You see what they see and can do what they can do. The log records it as you.
      </div>
      <div className="act-as-grid">
        {others.map((owner) => (
          <button
            key={owner}
            className="tap-btn act-as-btn"
            type="button"
            disabled={busy !== null}
            onClick={() => void take(owner)}
          >
            <span className="act-as-name">{busy === owner ? '…' : owner}</span>
            <span className="act-as-team">{teamByOwner.get(owner)?.espnTeamName ?? ''}</span>
          </button>
        ))}
      </div>
      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.78rem' }}>{error}</div>
      )}
    </div>
  );
}
