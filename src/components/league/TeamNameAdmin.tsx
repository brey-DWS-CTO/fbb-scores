import { useState } from 'react';
import {
  acceptTeamNames,
  apiErrorMessage,
  fetchEspnTeamNamePreview,
  sandboxActive,
  type TeamNamePreviewResponse,
} from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import NavIcon from './NavIcon.js';

function formatTime(value: string): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Commissioner tool: pull the team names from ESPN and store what changed. */
export default function TeamNameAdmin() {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [preview, setPreview] = useState<TeamNamePreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!identity?.isCommissioner) return null;
  const inSandbox = sandboxActive();
  const disabled = busy || inSandbox;
  const diff = preview?.preview;

  const fetchPreview = async () => {
    setBusy(true);
    setError(null);
    setArmed(false);
    setSaved(null);
    try {
      setPreview(await fetchEspnTeamNamePreview(identity));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await acceptTeamNames(identity, preview);
      applyState(result);
      setSaved(preview.preview.changes.length);
      setPreview(null);
      setArmed(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-blue)', marginBottom: 6 }}>
        TEAM NAMES
      </div>
      <div style={{ color: 'var(--text-mid)', fontSize: '0.74rem', marginBottom: 10 }}>
        People rename their team on ESPN and this app never hears about it. Fetch the current names,
        read what changed, then save. Teams are matched on their ESPN team number, so a rename is
        never mistaken for a new team.
      </div>

      {inSandbox && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
          Exit test mode before changing the live team names.
        </div>
      )}
      {saved !== null && (
        <div style={{ color: 'var(--neon-teal)', fontSize: '0.78rem', marginTop: 10 }}>
          Saved {saved} new {saved === 1 ? 'name' : 'names'}.
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: 'var(--neon-red)', fontSize: '0.78rem', marginTop: 10 }}>
          <NavIcon name="warning" size={14} className="icon-in-heading" />
          {error}
        </div>
      )}

      <button
        className="tap-btn"
        type="button"
        disabled={disabled}
        onClick={fetchPreview}
        style={{
          minHeight: 44,
          marginTop: 12,
          padding: '0 16px',
          borderRadius: 8,
          border: '2px solid var(--neon-blue)',
          background: 'rgba(0,153,255,0.08)',
          color: 'var(--neon-blue)',
          fontWeight: 800,
        }}
      >
        {busy ? 'WORKING…' : 'FETCH TEAM NAMES FROM ESPN'}
      </button>

      {diff && preview && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
          {diff.changes.length === 0 ? (
            <div style={{ color: 'var(--text-mid)', fontSize: '0.78rem' }}>
              Nothing changed. Every team is called what this app already says.
            </div>
          ) : (
            <>
              <div style={{ color: 'var(--text-hi)', fontSize: '0.78rem', fontWeight: 800 }}>
                {diff.changes.length} {diff.changes.length === 1 ? 'team' : 'teams'} renamed
              </div>
              <ul className="team-name-diff">
                {diff.changes.map((change) => (
                  <li key={change.owner}>
                    <span className="team-name-owner">{change.owner}</span>
                    <span className="team-name-before">{change.before}</span>
                    <span className="team-name-arrow">→</span>
                    <span className="team-name-after">{change.after}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: 9 }}>
            {diff.unchanged.length} unchanged · season {preview.candidate.sourceSeason} · read{' '}
            {formatTime(preview.candidate.fetchedAt)}
          </div>
          {diff.missing.length > 0 && (
            <div style={{ color: 'var(--neon-yellow)', fontSize: '0.68rem', marginTop: 4 }}>
              ESPN sent nothing for {diff.missing.map((row) => row.owner).join(', ')}. Those names
              stay as they are.
            </div>
          )}
          {diff.unknownEspnTeamIds.length > 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: 4 }}>
              Ignored {diff.unknownEspnTeamIds.length} ESPN{' '}
              {diff.unknownEspnTeamIds.length === 1 ? 'team' : 'teams'} this league does not know.
            </div>
          )}

          {diff.changes.length > 0 && (!armed ? (
            <button
              className="tap-btn"
              type="button"
              disabled={disabled}
              onClick={() => setArmed(true)}
              style={{
                minHeight: 44,
                marginTop: 12,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--neon-teal)',
                background: 'transparent',
                color: 'var(--neon-teal)',
                fontWeight: 800,
              }}
            >
              SAVE THESE NAMES
            </button>
          ) : (
            <button
              className="tap-btn"
              type="button"
              disabled={disabled}
              onClick={accept}
              style={{
                minHeight: 44,
                marginTop: 12,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--neon-yellow)',
                background: 'rgba(255,230,0,0.1)',
                color: 'var(--neon-yellow)',
                fontWeight: 800,
              }}
            >
              CONFIRM: USE THESE NAMES
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
