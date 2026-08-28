import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptPlayerPool,
  apiErrorMessage,
  fetchEspnPlayerPoolPreview,
  fetchPlayerPool,
  sandboxActive,
  type FetchedPlayerPoolPreviewResponse,
} from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueState } from '../../hooks/useLeague.js';

function formatTime(value: string): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ChangeNames({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 10);
  return (
    <div style={{ marginTop: 8, color: 'var(--text-mid)', fontSize: '0.72rem' }}>
      <strong style={{ color: 'var(--text-hi)' }}>{label}:</strong> {shown.join(', ')}
      {names.length > shown.length ? `, +${names.length - shown.length} more` : ''}
    </div>
  );
}

export default function PlayerPoolAdmin() {
  const { identity } = useIdentity();
  const { state } = useLeagueState();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<FetchedPlayerPoolPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuery = useQuery({
    queryKey: [
      'admin-player-pool',
      state.playerPool?.activeSnapshotId ?? `dataset-${state.season}`,
      state.draft.playerPoolSnapshotId ?? 'unlocked',
    ],
    queryFn: () => fetchPlayerPool(identity),
    enabled: identity?.isCommissioner === true,
    staleTime: 30_000,
  });

  if (!identity?.isCommissioner) return null;
  const current = currentQuery.data?.snapshot;
  const draftStarted = state.draft.startedAt !== null;
  const inSandbox = sandboxActive();
  const disabled = busy || draftStarted || inSandbox;

  const fetchPreview = async () => {
    setBusy(true);
    setError(null);
    setArmed(false);
    try {
      setPreview(await fetchEspnPlayerPoolPreview(identity));
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
      const accepted = await acceptPlayerPool(identity, preview.candidate, preview);
      applyState(accepted);
      setPreview(null);
      setArmed(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-player-pool'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  const diff = preview?.preview;
  const fieldChanges = diff
    ? diff.nameChanged.length + diff.teamChanged.length + diff.positionChanged.length
    : 0;

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-blue)', marginBottom: 6 }}>
        DRAFT PLAYER POOL
      </div>
      <div style={{ color: 'var(--text-mid)', fontSize: '0.74rem', marginBottom: 10 }}>
        Fetches the full 2027 player list from ESPN, shows every change, then stores an immutable
        snapshot. Keeper averages and tiers never come from this feed.
      </div>

      {currentQuery.isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Loading current pool…</div>
      ) : current ? (
        <div
          style={{
            padding: 10,
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            background: 'var(--input-bg)',
            fontSize: '0.76rem',
          }}
        >
          <div style={{ color: 'var(--text-hi)', fontWeight: 800 }}>
            {current.players.length} players · {current.source === 'committed-dataset' ? 'committed fallback' : 'ESPN'}
          </div>
          <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>
            {current.id} · fetched {formatTime(current.fetchedAt)}
          </div>
          {state.draft.playerPoolSnapshotId && (
            <div style={{ color: 'var(--neon-yellow)', marginTop: 4, fontWeight: 700 }}>
              Draft locked to {state.draft.playerPoolSnapshotId}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem' }}>
          {apiErrorMessage(currentQuery.error)}
        </div>
      )}

      {draftStarted && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
          The draft has started. The player pool is locked.
        </div>
      )}
      {inSandbox && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
          Exit test mode before changing the live player pool.
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: 'var(--neon-red)', fontSize: '0.78rem', marginTop: 10 }}>
          ⚠ {error}
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
        {busy ? 'WORKING…' : 'FETCH 2027 POOL FROM ESPN'}
      </button>

      {diff && preview && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {[
              ['ADDED', diff.added.length, 'var(--neon-teal)'],
              ['REMOVED', diff.removed.length, 'var(--neon-red)'],
              ['FIELD CHANGES', fieldChanges, 'var(--neon-yellow)'],
              ['RETAINED', diff.retainedMissing.length, 'var(--neon-purple)'],
            ].map(([label, count, color]) => (
              <span
                key={String(label)}
                style={{
                  padding: '4px 8px',
                  border: `1px solid ${color}`,
                  borderRadius: 999,
                  color: String(color),
                  fontSize: '0.65rem',
                  fontWeight: 800,
                }}
              >
                {label} {count}
              </span>
            ))}
          </div>
          <ChangeNames label="Added" names={diff.added.map((player) => player.fullName)} />
          <ChangeNames label="Removed" names={diff.removed.map((player) => player.fullName)} />
          <ChangeNames
            label="Retained because protected"
            names={diff.retainedMissing.map((player) => player.fullName)}
          />
          <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: 9 }}>
            Candidate {preview.candidateSnapshotId} · {diff.nextPlayers.length} total players
          </div>

          {!armed ? (
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
              ACCEPT THIS SNAPSHOT
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
              CONFIRM: MAKE THIS THE LIVE POOL
            </button>
          )}
        </div>
      )}
    </section>
  );
}

