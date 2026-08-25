import TeamPickerForm from './TeamPickerForm.js';

interface Props {
  onClose: () => void;
}

/** In-app bottom-sheet wrapper around the team picker / PIN form. */
export default function TeamPickerModal({ onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '20px 16px calc(20px + env(safe-area-inset-bottom))',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div className="hub-heading glow-teal" style={{ fontSize: '0.8rem', marginBottom: 14 }}>
          WHO ARE YOU?
        </div>
        <TeamPickerForm onDone={onClose} />
      </div>
    </div>
  );
}
