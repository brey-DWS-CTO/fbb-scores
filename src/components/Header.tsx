import type { FC } from 'react';
import type { PlayoffInfo } from '../types/index.js';

interface HeaderProps {
  leagueName: string;
  playoff: PlayoffInfo;
  fetchedAt: string;
}

const Header: FC<HeaderProps> = ({ leagueName, playoff, fetchedAt }) => {
  const updatedTime = new Date(fetchedAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <header
      className="w-full relative overflow-hidden"
      style={{
        background: 'linear-gradient(90deg, #1a0033 0%, #0a0a2e 50%, #001a33 100%)',
        borderBottom: '3px solid var(--neon-teal)',
        boxShadow: '0 4px 24px #00ffcc22, 0 2px 0 #00ffcc44',
      }}
    >
      {/* Decorative pixel dots top row */}
      <div className="absolute top-0 left-0 w-full flex justify-between px-4 py-1 opacity-30">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="inline-block w-1 h-1"
            style={{
              background: i % 3 === 0 ? 'var(--neon-purple)' : i % 3 === 1 ? 'var(--neon-teal)' : 'var(--neon-blue)',
            }}
          />
        ))}
      </div>

      {/* Decorative diagonal lines */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent, transparent 10px, var(--neon-purple) 10px, var(--neon-purple) 11px)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center py-6 px-4 gap-2">
        {/* Title block */}
        <h1
          className="pixel-text glow-yellow text-center"
          style={{
            fontSize: 'clamp(1.2rem, 4vw, 2.2rem)',
            color: 'var(--neon-yellow)',
            textShadow: '0 0 12px #ffe600, 0 0 32px #ffe60066, 0 0 64px #ffe60033',
          }}
        >
          FANTASY HOOPS
        </h1>

        <h2
          className="pixel-text glow-teal text-center"
          style={{
            fontSize: 'clamp(0.5rem, 1.8vw, 0.85rem)',
            color: 'var(--neon-teal)',
            marginTop: '2px',
          }}
        >
          LEAGUE SCOREBOARD
        </h2>

        {/* League name */}
        <p
          className="text-center mt-1 opacity-70"
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.1rem',
            color: '#aaaacc',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          {leagueName}
        </p>

        {/* Info row: LIVE badge + Round + updated time */}
        <div className="flex items-center gap-6 mt-2 flex-wrap justify-center">
          {/* LIVE badge */}
          <span
            className="pixel-text flex items-center gap-2"
            style={{ fontSize: '0.6rem', color: 'var(--neon-orange)' }}
          >
            <span
              className="blink inline-block w-2 h-2 rounded-full"
              style={{
                background: 'var(--neon-red)',
                boxShadow: '0 0 6px var(--neon-red), 0 0 12px var(--neon-red)',
              }}
            />
            LIVE
          </span>

          {/* Playoff/Week indicator */}
          <span
            className="pixel-text"
            style={{
              fontSize: '0.65rem',
              color: playoff.isPlayoffs ? 'var(--neon-yellow)' : 'var(--neon-teal)',
              textShadow: playoff.isPlayoffs
                ? '0 0 8px #ffe600, 0 0 16px #ffe60066'
                : '0 0 8px #00ffcc, 0 0 16px #00ffcc66',
            }}
          >
            {playoff.roundLabel}
          </span>

          {/* Updated time */}
          <span
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1rem',
              color: '#666688',
            }}
          >
            UPDATED {updatedTime}
          </span>
        </div>
      </div>

      {/* Decorative bottom pixel strip */}
      <div className="absolute bottom-0 left-0 w-full h-1 flex">
        {Array.from({ length: 40 }).map((_, i) => (
          <span
            key={i}
            className="flex-1 h-full"
            style={{
              background:
                i % 4 === 0
                  ? 'var(--neon-teal)'
                  : i % 4 === 1
                    ? 'transparent'
                    : i % 4 === 2
                      ? 'var(--neon-purple)'
                      : 'transparent',
              opacity: 0.6,
            }}
          />
        ))}
      </div>
    </header>
  );
};

export default Header;
