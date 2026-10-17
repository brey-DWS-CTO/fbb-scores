import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import { testDraftJoined } from '../../lib/league/api.js';
import { statsLocked } from '../../lib/league/draftLock.js';
import NavIcon from './NavIcon.js';

/**
 * Closes a stats page (mock draft, projections, tiers) to members while the
 * draft runs, so the draft is picked from names alone. The commissioner keeps
 * every page.
 */
export default function StatsGate({ children }: { children: ReactNode }) {
  const { state } = useLeagueState();
  const { identity } = useIdentity();
  const locked = statsLocked({
    league: state,
    isCommissioner: identity?.isCommissioner === true,
    inTestDraft: testDraftJoined(),
  });
  if (!locked) return <>{children}</>;
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px' }}>
      <div className="panel stats-gate">
        <div className="hub-heading">
          <NavIcon name="lock" size={14} className="icon-in-heading" />
          THE DRAFT IS ON
        </div>
        <p>Mock drafts and stats come back when the draft ends.</p>
        <Link to="/draft" className="tap-btn stats-gate-btn">BACK TO THE DRAFT</Link>
      </div>
    </div>
  );
}
