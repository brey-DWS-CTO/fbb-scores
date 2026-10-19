import { Link } from 'react-router-dom';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { DraftCountdown } from '../../hooks/useCountdown.js';
import { formatDraftAt } from '../../lib/league/format.js';
import { mockSaveKey, parseMockSave } from '../../lib/league/draftRoom.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

/** True when this person has a mock draft under way on this device. */
function mockUnderWay(owner: string | null): boolean {
  if (!owner) return false;
  try {
    return parseMockSave(window.localStorage.getItem(mockSaveKey(owner)))?.started === true;
  } catch {
    return false;
  }
}

/**
 * Where DRAFT opens: two big doors, the mock draft and the live draft, with
 * projections and tiers under them. Built for a thumb.
 */
export default function DraftStartPage() {
  const { identity } = useIdentity();
  const { state, meta } = useLeagueData();
  const owner = identity?.owner ?? null;
  const live = state.draft.startedAt !== null && !state.draft.closedAt;
  const underWay = mockUnderWay(owner);

  return (
    <div className="start-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="target" size={16} className="icon-in-heading" />
          DRAFT
        </h1>
        <IdentityChip />
      </div>

      <Link to="/mock" className="tap-btn start-btn start-btn-mock">
        <span className="start-btn-icon" aria-hidden="true"><NavIcon name="flask" size="1.6em" /></span>
        <span className="start-btn-title hub-heading">{underWay ? 'CONTINUE MOCK' : 'MOCK DRAFT'}</span>
        <span className="start-btn-sub">{underWay ? 'Your draft is where you left it.' : 'Practice against nine computer teams.'}</span>
      </Link>

      <Link to="/draft" className={`tap-btn start-btn start-btn-live${live ? ' is-live' : ''}`}>
        <span className="start-btn-icon" aria-hidden="true"><NavIcon name="tv" size="1.6em" /></span>
        <span className="start-btn-title hub-heading">LIVE DRAFT</span>
        <span className="start-btn-sub">
          {live ? 'The real draft is on now.' : meta?.draftAt ? formatDraftAt(meta.draftAt) : 'The real board.'}
        </span>
        {!live && meta?.draftAt && (
          <span className="start-btn-count"><DraftCountdown targetIso={meta.draftAt} size="1.1rem" /></span>
        )}
      </Link>

      <Link to="/my-rankings" className="tap-btn start-btn start-btn-list">
        <span className="start-btn-icon" aria-hidden="true"><NavIcon name="ballot" size="1.4em" /></span>
        <span className="start-btn-title hub-heading">MY RANKINGS</span>
        <span className="start-btn-sub">Your player rankings, for picks made while you are away. Only you see them.</span>
      </Link>

      <div className="start-row">
        <Link to="/projections" className="tap-btn start-btn start-btn-small">
          <span aria-hidden="true"><NavIcon name="chart" size="1.3em" /></span>
          <span className="hub-heading">PROJECTIONS</span>
        </Link>
        <Link to="/tiers" className="tap-btn start-btn start-btn-small">
          <span aria-hidden="true"><NavIcon name="tiers" size="1.3em" /></span>
          <span className="hub-heading">TIERS</span>
        </Link>
      </div>
    </div>
  );
}
