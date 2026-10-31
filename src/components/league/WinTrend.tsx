import { useState, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWinTrend } from '../../lib/league/api.js';
import { nearestDot, trendChart, type TrendPoint } from '../../lib/league/winTrend.js';

const WIDTH = 320;
const HEIGHT = 96;

/** "Mon 7:45 PM" in the viewer's own clock. */
function whenText(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-US', { weekday: 'short' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

const dayLetter = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

interface WinTrendProps {
  season: number;
  matchupPeriodId: number;
  matchupId: number;
  /** The week's dates, first to last. */
  dates: string[];
  homeLabel: string;
  awayLabel: string;
}

/**
 * How the home side's win chance moved this week. Top is a sure home win,
 * bottom a sure away win, the dashed line an even game. Tap or drag across
 * it for the score and chance at any point.
 */
export function WinTrend({ season, matchupPeriodId, matchupId, dates, homeLabel, awayLabel }: WinTrendProps) {
  const query = useQuery({
    queryKey: ['win-trend', season, matchupPeriodId],
    queryFn: () => fetchWinTrend(season, matchupPeriodId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
  const [picked, setPicked] = useState<TrendPoint | null>(null);
  const points = (query.data ?? []).filter((point) => point.matchupId === matchupId);
  const chart = trendChart(points, dates, WIDTH, HEIGHT);
  const active = chart.dots.find((dot) => dot.point.takenAt === picked?.takenAt) ?? chart.dots[chart.dots.length - 1] ?? null;
  const shown = active?.point ?? null;
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    if (event.type === 'pointermove' && event.pointerType !== 'mouse' && event.buttons === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * (WIDTH + 12) - 6;
    const dot = nearestDot(chart.dots, x);
    if (dot) setPicked(dot.point);
  };

  if (query.isLoading) return <div className="win-trend win-trend-note">Loading the trend...</div>;
  if (query.isError) return <div className="win-trend win-trend-note">The trend did not load. Try again in a minute.</div>;
  if (points.length === 0) return <div className="win-trend win-trend-note">No points yet. The first one comes with the next game or the 7 AM check.</div>;

  return (
    <div className="win-trend">
      <div className="win-trend-plot">
        <span className="win-trend-side is-top">{homeLabel}</span>
        <span className="win-trend-side is-bottom">{awayLabel}</span>
        <svg
          viewBox={`-6 -6 ${WIDTH + 12} ${HEIGHT + 22}`}
          role="img"
          aria-label={`Win chance over the week, ${points.length} points`}
          onPointerDown={pick}
          onPointerMove={pick}
        >
          {chart.days.map((day) => (
            <g key={day.date}>
              <line className="win-trend-grid" x1={day.x} x2={day.x} y1={0} y2={HEIGHT} />
              <text className="win-trend-day" x={day.x + 2} y={HEIGHT + 13}>{dayLetter(day.date)}</text>
            </g>
          ))}
          <line className="win-trend-mid" x1={0} x2={WIDTH} y1={chart.midY} y2={chart.midY} />
          <path className="win-trend-line" d={chart.path} />
          {active && (
            <>
              <line className="win-trend-cursor" x1={active.x} x2={active.x} y1={0} y2={HEIGHT} />
              <circle className="win-trend-dot" cx={active.x} cy={active.y} r={4} />
            </>
          )}
          <rect className="win-trend-hit" x={-6} y={-6} width={WIDTH + 12} height={HEIGHT + 12} />
        </svg>
      </div>
      {shown && (
        <div className="win-trend-readout" aria-live="polite">
          <span>{whenText(shown.takenAt)}</span>
          <b>{homeLabel} {shown.homePct}%</b>
          <span>{shown.homePoints.toFixed(1)} to {shown.awayPoints.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
