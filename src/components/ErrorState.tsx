import type { FC } from 'react';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const ErrorState: FC<ErrorStateProps> = ({ message, onRetry }) => {
  const isAuthError =
    message.includes('401') ||
    message.toLowerCase().includes('auth') ||
    message.toLowerCase().includes('unauthorized');

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 w-full px-4"
      style={{
        minHeight: '60vh',
        background: 'var(--dark-bg)',
      }}
    >
      {/* Error header */}
      <span
        className="pixel-text glow-red"
        style={{
          fontSize: 'clamp(0.8rem, 3vw, 1.2rem)',
          color: 'var(--neon-red)',
          textShadow: '0 0 12px var(--neon-red), 0 0 32px #ff222244',
        }}
      >
        !! ERROR !!
      </span>

      {/* Error message */}
      <div
        className="panel p-4 max-w-lg w-full text-center"
        style={{
          borderColor: 'var(--neon-red)',
          boxShadow: '0 0 12px #ff222233',
        }}
      >
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.3rem',
            color: '#cc8888',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </span>
      </div>

      {/* Auth hint */}
      {isAuthError && (
        <div
          className="panel p-4 max-w-lg w-full"
          style={{
            borderColor: 'var(--neon-yellow)',
            boxShadow: '0 0 8px #ffe60022',
          }}
        >
          <span
            className="pixel-text"
            style={{
              fontSize: '0.4rem',
              color: 'var(--neon-yellow)',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            AUTH HELP:
          </span>
          <span
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1.1rem',
              color: '#999977',
              lineHeight: 1.4,
            }}
          >
            Make sure your ESPN cookies (espn_s2 and SWID) are configured correctly.
            Private leagues require authentication to fetch data.
          </span>
        </div>
      )}

      {/* Retry button */}
      <button
        onClick={onRetry}
        className="pixel-text cursor-pointer px-6 py-3 mt-2"
        style={{
          fontSize: '0.6rem',
          color: 'var(--neon-teal)',
          background: '#00ffcc0a',
          border: '3px solid var(--neon-teal)',
          boxShadow: '0 0 8px #00ffcc44',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow =
            '0 0 16px var(--neon-teal), 0 0 32px #00ffcc44';
          e.currentTarget.style.background = '#00ffcc15';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = '0 0 8px #00ffcc44';
          e.currentTarget.style.background = '#00ffcc0a';
        }}
      >
        RETRY
      </button>
    </div>
  );
};

export default ErrorState;
