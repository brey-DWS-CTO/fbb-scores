/**
 * A burst of confetti for big moments. Pure CSS: each piece falls on its own
 * delay, drift and spin. Spread by a fixed formula, not Math.random, so it
 * draws the same every time and never re-shuffles on a re-render. Hidden for
 * anyone who asks their phone for less motion.
 */
const COLORS = ['var(--neon-yellow)', 'var(--neon-teal)', 'var(--neon-purple)', 'var(--neon-red)', 'var(--neon-orange)'];

const PIECES = Array.from({ length: 40 }, (_, i) => {
  // Golden-ratio steps scatter the pieces evenly without clumping.
  const spread = (i * 0.618034) % 1;
  return {
    left: `${Math.round(spread * 100)}%`,
    delay: `${((i * 37) % 60) / 100}s`,
    drift: `${Math.round((((i * 53) % 100) - 50) * 1.6)}px`,
    spin: `${360 + ((i * 97) % 360)}deg`,
    color: COLORS[i % COLORS.length],
    wide: i % 3 === 0,
    // Every fifth piece is a basketball.
    ball: i % 5 === 2,
  };
});

/** A small basketball: orange ball, dark seams. */
function Ball() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <circle cx="12" cy="12" r="11" fill="#f28c28" stroke="#3a1d06" strokeWidth="1.4" />
      <path d="M1 12h22 M12 1v22 M4.5 4.5c4 3 4 12 0 15 M19.5 4.5c-4 3-4 12 0 15" fill="none" stroke="#3a1d06" strokeWidth="1.4" />
    </svg>
  );
}

export default function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className={p.ball ? 'confetti-piece confetti-ball' : p.wide ? 'confetti-piece confetti-wide' : 'confetti-piece'}
          style={{
            left: p.left,
            background: p.ball ? 'transparent' : p.color,
            animationDelay: p.delay,
            ['--drift' as string]: p.drift,
            ['--spin' as string]: p.spin,
          }}
        >
          {p.ball && <Ball />}
        </span>
      ))}
    </div>
  );
}
