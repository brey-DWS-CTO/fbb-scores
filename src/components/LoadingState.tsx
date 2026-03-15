import type { FC } from 'react';

const LoadingState: FC = () => {
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 w-full"
      style={{
        minHeight: '60vh',
        background: 'var(--dark-bg)',
      }}
    >
      {/* Loading text */}
      <span
        className="pixel-text glow-teal blink"
        style={{
          fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
          color: 'var(--neon-teal)',
        }}
      >
        LOADING...
      </span>

      {/* Fake progress bar */}
      <div
        className="w-64 h-3 relative overflow-hidden"
        style={{
          border: '2px solid var(--neon-teal)',
          background: '#0a0a14',
        }}
      >
        <div
          className="absolute top-0 left-0 h-full"
          style={{
            background: 'linear-gradient(90deg, var(--neon-teal), var(--neon-blue))',
            animation: 'loading-bar 2s ease-in-out infinite',
            boxShadow: '0 0 8px var(--neon-teal)',
          }}
        />
      </div>

      {/* Terminal text lines */}
      <div className="flex flex-col items-start gap-2 mt-4">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.1rem',
            color: '#555577',
          }}
        >
          {'>'} CONNECTING TO LEAGUE SERVER...
        </span>
        <span
          className="blink"
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.1rem',
            color: '#444466',
            animationDelay: '0.5s',
          }}
        >
          {'>'} FETCHING MATCHUP DATA...
        </span>
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.1rem',
            color: '#333355',
          }}
        >
          {'>'} PLEASE WAIT_
        </span>
      </div>

      {/* Inline keyframes for the progress bar */}
      <style>{`
        @keyframes loading-bar {
          0%   { width: 0%;   left: 0; }
          50%  { width: 70%;  left: 0; }
          100% { width: 0%;   left: 100%; }
        }
      `}</style>
    </div>
  );
};

export default LoadingState;
