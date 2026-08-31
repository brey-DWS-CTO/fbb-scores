import { useNavigate } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { teamByOwner } from '../../lib/league/data.js';
import TeamPickerForm from './TeamPickerForm.js';

interface Props {
  onClose: () => void;
}

/** Account and sign-in bottom sheet. */
export default function TeamPickerModal({ onClose }: Props) {
  const { identity, signOut } = useIdentity();
  const navigate = useNavigate();
  const team = identity ? teamByOwner.get(identity.owner) : null;

  const logout = () => {
    signOut();
    onClose();
    navigate('/');
  };

  return (
    <div className="account-backdrop" onClick={onClose}>
      <div
        className="panel account-sheet"
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
    </div>
  );
}
