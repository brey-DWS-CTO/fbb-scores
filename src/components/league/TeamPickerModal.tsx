import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { teamByOwner } from '../../lib/league/data.js';
import TeamPickerForm from './TeamPickerForm.js';
import SetPinPanel from './SetPinPanel.js';

interface Props {
  anchor?: DOMRect;
  onClose: () => void;
}

/** Account panel opens toward the available space beside the owner chip. */
export default function TeamPickerModal({ anchor, onClose }: Props) {
  const { identity, signOut } = useIdentity();
  const navigate = useNavigate();
  const team = identity ? teamByOwner.get(identity.owner) : null;

  const logout = () => {
    signOut();
    onClose();
    navigate('/');
  };

  return createPortal(
    <div className="account-backdrop" onClick={onClose}>
      <div
        className="panel account-sheet"
        style={anchor ? {
          top: anchor.top > window.innerHeight / 2 ? 'auto' : Math.max(8, anchor.bottom + 8),
          bottom: anchor.top > window.innerHeight / 2 ? Math.max(8, window.innerHeight - anchor.top + 8) : 'auto',
          right: Math.min(Math.max(8, window.innerWidth - anchor.right), Math.max(8, window.innerWidth - 432)),
        } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="account-sheet-header">
          <div>
            <div className="splash-step">{identity ? 'YOUR ACCOUNT' : 'OWNER ACCESS'}</div>
            <h2 id="account-sheet-title">{identity ? identity.owner : 'Who are you?'}</h2>
            {team && <p>{team.espnTeamName}</p>}
          </div>
          <button className="tap-btn account-close" type="button" onClick={onClose} aria-label="Close account menu">
            ×
          </button>
        </div>

        {identity && <SetPinPanel />}

        {identity && (
          <button className="tap-btn account-signout" type="button" onClick={logout}>
            SIGN OUT
          </button>
        )}

        <div className={identity ? 'account-switch account-switch-separated' : 'account-switch'}>
          {identity && <div className="identity-label">SWITCH OWNER</div>}
          <TeamPickerForm onDone={onClose} />
        </div>
      </div>
    </div>, document.body
  );
}
