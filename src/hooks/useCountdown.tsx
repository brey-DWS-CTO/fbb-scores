import { useEffect, useState } from 'react';

export interface Countdown {
  past: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Ticking countdown to an ISO timestamp (1s resolution). */
export function useCountdown(targetIso: string | null | undefined): Countdown | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!targetIso) return null;
  const diff = Date.parse(targetIso) - now;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return { past: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSeconds = Math.floor(diff / 1000);
  return {
    past: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function CountdownDisplay({
  countdown,
  size = '1.6rem',
}: {
  countdown: Countdown;
  size?: string;
}) {
  const seg = (n: number, label: string) => (
    <span style={{ textAlign: 'center' }}>
      <span
        style={{
          display: 'block',
          fontSize: size,
          fontWeight: 800,
          color: 'var(--neon-teal)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {String(n).padStart(2, '0')}
      </span>
      <span style={{ display: 'block', fontSize: '0.6rem', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
        {label}
      </span>
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 14, alignItems: 'flex-start', justifyContent: 'center' }}>
      {seg(countdown.days, 'DAYS')}
      {seg(countdown.hours, 'HRS')}
      {seg(countdown.minutes, 'MIN')}
      {seg(countdown.seconds, 'SEC')}
    </span>
  );
}
