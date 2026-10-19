import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { answerHouseParty, apiErrorMessage, fetchHouseInvites, putOffHouseInvite } from '../../lib/league/api.js';
import { partyHeadline, type PendingInvite } from '../../lib/league/houseParty.js';
import NavIcon from './NavIcon.js';
import TeamLogo from './TeamLogo.js';

/**
 * The popup for a house party invite. It shows the oldest invite waiting on
 * you when you open the app, and again every few minutes until you say I'M
 * IN, CAN'T MAKE IT, or LATER.
 */
export default function InviteToast() {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery<{ invites: PendingInvite[]; now: string }>({
    queryKey: ['house-invites', identity?.owner ?? 'anon'],
    queryFn: () => fetchHouseInvites(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
    refetchOnWindowFocus: true,
  });
  const invite = query.data?.invites[0];
  if (!identity || !invite) return null;
  const main = invite.party.games[0];

  const settle = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      queryClient.setQueryData<{ invites: PendingInvite[]; now: string }>(['house-invites', identity.owner], (current) => (current
        ? { ...current, invites: current.invites.filter((row) => row.party.id !== invite.party.id) }
        : current));
      queryClient.invalidateQueries({ queryKey: ['watch'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="panel invite-toast" role="dialog" aria-live="polite" aria-label="House party invite">
      <div className="invite-toast-head">
        <NavIcon name="home" size={16} className="icon-in-heading" />
        <span className="hub-heading">{invite.by} invited you</span>
      </div>
      <div className="invite-toast-body">
        {main && (
          <span className="party-game-logos">
            <TeamLogo code={main.away} size={28} />
            <TeamLogo code={main.home} size={28} />
          </span>
        )}
        <span>{partyHeadline(invite.party)}</span>
      </div>
      {invite.party.note && <div className="invite-toast-note">{invite.party.note}</div>}
      {error && <div className="mock-note mock-note-bad">{error}</div>}
      <div className="invite-toast-actions">
        <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busy} onClick={() => void settle(() => answerHouseParty(identity, invite.party.id, 'in'))}>I'M IN</button>
        <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void settle(() => answerHouseParty(identity, invite.party.id, 'out'))}>CAN'T MAKE IT</button>
        <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void settle(() => putOffHouseInvite(identity, invite.party.id))}>LATER</button>
        <Link className="invite-toast-link" to={`/party/${invite.party.id}`}>Details</Link>
      </div>
    </div>,
    document.body,
  );
}
