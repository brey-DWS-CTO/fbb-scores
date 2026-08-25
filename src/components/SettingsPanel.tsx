import type { FC } from 'react';
import { useSettings, type FontMode } from '../hooks/useSettings.js';

interface SettingsPanelProps {
  onClose: () => void;
}

const FONT_OPTIONS: Array<{ value: FontMode; label: string; desc: string }> = [
  { value: 'retro', label: 'RETRO (VT323)', desc: 'Original pixel-style font' },
  { value: 'modern', label: 'MODERN', desc: 'Easier to read, clean sans-serif' },
];

const SettingsPanel: FC<SettingsPanelProps> = ({ onClose }) => {
  const { fontMode, setFontMode } = useSettings();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#00000088',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#0a0a14',
          border: '1px solid #333355',
          padding: '24px',
          maxWidth: '400px',
          width: '90%',
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <span className="pixel-text glow-teal" style={{ fontSize: '0.58rem', color: 'var(--neon-teal)' }}>
            SETTINGS
          </span>
          <button
            onClick={onClose}
            className="pixel-text"
            style={{
              fontSize: '0.58rem',
              color: '#777799',
              background: 'none',
              border: '1px solid #333355',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            CLOSE
          </button>
        </div>

        {/* Font mode */}
        <div className="mb-4">
          <span className="pixel-text" style={{ fontSize: '0.52rem', color: '#777799', letterSpacing: '0.1em' }}>
            DISPLAY FONT
          </span>
          <div className="flex flex-col gap-2 mt-2">
            {FONT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFontMode(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  background: fontMode === opt.value ? '#1a1a33' : '#0f0f1a',
                  border: fontMode === opt.value ? '1px solid var(--neon-teal)' : '1px solid #222244',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    border: fontMode === opt.value ? '2px solid var(--neon-teal)' : '2px solid #444466',
                    background: fontMode === opt.value ? 'var(--neon-teal)' : 'transparent',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{
                    fontFamily: opt.value === 'retro' ? "'VT323', monospace" : "'Inter', system-ui, sans-serif",
                    fontSize: opt.value === 'retro' ? '1.1rem' : '0.9rem',
                    color: '#e0e0ff',
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontFamily: "'VT323', monospace", fontSize: '0.75rem', color: '#555577' }}>
                    {opt.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Future: Light mode toggle placeholder */}
        <div style={{ borderTop: '1px solid #1a1a33', paddingTop: '12px' }}>
          <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#444466' }}>
            MORE SETTINGS COMING SOON...
          </span>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
