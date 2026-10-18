import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DraftRoom } from '../../lib/league/testDraft.js';
import { apiErrorMessage, fetchAutoStatus, setAutoDraft } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import { ACTION_BUTTON } from './boardUtils.js';

/** The commissioner's auto switch and status. Only he can flip it. */
function useAutoSwitch(room: DraftRoom) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['draft-auto', identity?.owner ?? 'anon', room.side],
    queryFn: () => fetchAutoStatus(identity!, room),
    enabled: identity?.isCommissioner === true,
    staleTime: 10_000,
    // A member may save rankings while this page is open; look again every few seconds.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const listOwners = new Set(status.data?.listOwners ?? []);

  const flip = async (owner: string, on: boolean) => {
    if (!identity || busy) return;
    setBusy(owner);
    setError(null);
    try {
      applyState(await setAutoDraft(identity, owner, on, room));
      void queryClient.invalidateQueries({ queryKey: ['draft-auto'] });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return { commish: identity?.isCommissioner === true, busy, error, listOwners, flip };
}

/**
 * One button in the clock panel: auto on or off for the team on the clock.
 * Turning it on makes that team's pick at once, from its own rankings and
 * then the best player left, and keeps picking for it until it is turned off.
 * The commish sees whether the team has rankings, never what is in them. In
 * the test draft every auto pick takes the board's order.
 */
export function AutoButton({ room, owner, autoOwners }: { room: DraftRoom; owner: string; autoOwners: readonly string[] }) {
  const { commish, busy, error, listOwners, flip } = useAutoSwitch(room);
  if (!commish) return null;
  const on = autoOwners.includes(owner);
  const hasList = room.side === 'league' && listOwners.has(owner);
  const title = room.side === 'test'
    ? 'Test draft: auto takes the best player left. Nobody’s rankings are used here.'
    : hasList
      ? `${owner} has rankings. Auto picks from them, then the best player left. You never see them.`
      : `${owner} has no rankings. Auto takes the best player left.`;
  return (
    <>
      <button
        className="tap-btn"
        type="button"
        disabled={busy !== null}
        onClick={() => flip(owner, !on)}
        aria-pressed={on}
        title={title}
        style={{
          ...ACTION_BUTTON,
          border: `2px solid ${on ? 'var(--neon-yellow)' : 'var(--panel-border)'}`,
          background: on ? 'rgba(255,230,0,0.12)' : 'transparent',
          color: on ? 'var(--neon-yellow)' : 'var(--text-soft)',
        }}
      >
        {busy === owner ? '…' : on ? `⚡ AUTO ON · ${owner.toUpperCase()}` : `⚡ AUTO OFF · ${owner.toUpperCase()}`}
      </button>
      {error && <div className="live-room-error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</div>}
    </>
  );
}

/** Every team on auto, each a chip the commish taps to turn off, under NEXT. */
export function AutoChips({ room, autoOwners }: { room: DraftRoom; autoOwners: readonly string[] }) {
  const { commish, busy, flip } = useAutoSwitch(room);
  if (autoOwners.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--neon-yellow)', fontWeight: 700 }}>ON AUTO:</span>
      {autoOwners.map((owner) => (
        <button
          key={owner}
          className="tap-btn auto-tag"
          type="button"
          disabled={!commish || busy !== null}
          onClick={() => flip(owner, false)}
          title={commish ? `Take ${owner} off auto` : `${owner} is on auto`}
          style={{ padding: '3px 10px', fontSize: '0.72rem', background: 'rgba(255,230,0,0.08)', cursor: commish ? 'pointer' : 'default' }}
        >
          {owner}{commish ? ' ✕' : ''}
        </button>
      ))}
    </div>
  );
}
