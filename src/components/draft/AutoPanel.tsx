import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DraftRoom } from '../../lib/league/testDraft.js';
import { apiErrorMessage, fetchAutoStatus, setAutoDraft } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';

interface Props {
  room: DraftRoom;
  owners: readonly string[];
  autoOwners: readonly string[];
  /** The team on the clock, so its chip can say so. */
  onClockOwner: string | null;
}

/**
 * The commissioner's auto switches, one per team. A team on auto has its
 * picks made by the server: from its own private rankings, or the board's
 * order once they run out. The commish sees who has rankings, never what is
 * in them. In the test draft every auto pick takes the board's order, so
 * nobody's real rankings show on a practice board.
 */
export default function AutoPanel({ room, owners, autoOwners, onClockOwner }: Props) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['draft-auto', identity?.owner ?? 'anon', room.side],
    queryFn: () => fetchAutoStatus(identity!, room),
    enabled: identity !== null,
    staleTime: 10_000,
    // A member may save rankings while this page is open; look again every few seconds.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  if (!identity?.isCommissioner) return null;
  const listOwners = new Set(status.data?.listOwners ?? []);

  const toggle = async (owner: string) => {
    if (busy) return;
    const on = !autoOwners.includes(owner);
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

  return (
    <section className="panel auto-panel" aria-label="Auto pick">
      <div className="auto-panel-head">
        <span className="hub-heading">AUTO PICK</span>
        <span className="auto-panel-note">
          {room.side === 'test'
            ? 'Test draft: auto takes the best player left. Nobody’s rankings are used here.'
            : 'A team on auto picks from its own rankings, then the best player left. You never see them.'}
          {' '}Tap a team to turn auto on or off.
        </span>
      </div>
      <div className="auto-panel-chips">
        {owners.map((owner) => {
          const on = autoOwners.includes(owner);
          const hasList = room.side === 'league' && listOwners.has(owner);
          return (
            <button
              key={owner}
              type="button"
              className={`tap-btn auto-chip${on ? ' is-on' : ''}${owner === onClockOwner ? ' is-clock' : ''}`}
              aria-pressed={on}
              disabled={busy !== null}
              onClick={() => toggle(owner)}
              title={on ? `Take ${owner} off auto` : `Put ${owner} on auto${hasList ? ' (has rankings)' : ' (no rankings: best available)'}`}
            >
              <span className="auto-chip-name">{owner}</span>
              <span className="auto-chip-state">{busy === owner ? '…' : on ? 'AUTO ON · TAP TO STOP' : 'OFF · TAP FOR AUTO'}</span>
              {room.side === 'league' && (
                <span className={`auto-chip-list${hasList ? ' has-list' : ''}`}>{hasList ? 'RANKINGS' : 'NO RANKINGS'}</span>
              )}
            </button>
          );
        })}
      </div>
      {error && <div className="live-room-error" role="alert">{error}</div>}
    </section>
  );
}
