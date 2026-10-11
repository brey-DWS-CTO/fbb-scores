import { useState } from 'react';
import TeamPickerModal from './TeamPickerModal.js';

interface Props {
  /** Why they need to sign in, in one short line. */
  reason: string;
}

/**
 * The "sign in first" card a page shows when nobody is signed in. The whole
 * card is a button: tap it and the sign-in panel opens right there.
 */
export default function SignInPanel({ reason }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
      <button type="button" className="panel tap-btn sign-in-panel" onClick={() => setOpen(true)}>
        <span className="hub-heading sign-in-panel-title">SIGN IN</span>
        <span className="sign-in-panel-reason">{reason}</span>
        <span className="sign-in-panel-hint">Tap to sign in</span>
      </button>
      {open && <TeamPickerModal onClose={() => setOpen(false)} />}
    </div>
  );
}
