import { useId, useState } from 'react';
import type { ScheduleTrend } from '../../lib/league/schedule.js';
import { shortPeriodLabel } from './scheduleUi.js';

// A 340 wide box maps close to 1:1 on a 375px phone, so the type in the chart
// renders near the size it is written at instead of shrinking to nothing.
const WIDTH = 340;
const HEIGHT = 152;
const LEFT = 26;
// Short of the right edge on purpose: the last week label is centred on the
// last point, and "R2 W2" is the widest label the mapping produces.
const RIGHT = 316;
const TOP = 16;
const BOTTOM = 110;
const WEEK_LABEL_Y = 128;
// Twenty-two weeks will not all fit, so every third one carries a label.
const LABEL_EVERY = 3;

function formatGames(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

interface ScheduleTrendChartProps {
  trend: ScheduleTrend;
  /** What the line counts, for the heading and for screen readers. */
  subject: string;
}

/**
 * Games per league period, drawn by hand.
 *
 * Twenty-two points do not need a charting library, and one would not match
 * the rest of the app.
 */
export default function ScheduleTrendChart({ trend, subject }: ScheduleTrendChartProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const { points, max, average, peak, trough } = trend;

  const scaleTop = Math.max(1, Math.ceil(max));
  const step = points.length > 1 ? (RIGHT - LEFT) / (points.length - 1) : 0;
  const x = (index: number) => (points.length > 1 ? LEFT + index * step : (LEFT + RIGHT) / 2);
  const y = (value: number) => BOTTOM - (value / scaleTop) * (BOTTOM - TOP);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);
  const area = points.length
    ? `M ${x(0).toFixed(1)},${BOTTOM} L ${line.join(' L ')} L ${x(points.length - 1).toFixed(1)},${BOTTOM} Z`
    : '';
  const peakIndex = peak ? points.indexOf(peak) : -1;
  const troughIndex = trough ? points.indexOf(trough) : -1;
  const lastIndex = points.length - 1;
  // The last week earns a label only when it will not crowd the one before it.
  const showsWeek = (index: number) => index % LABEL_EVERY === 0
    || (index === lastIndex && lastIndex % LABEL_EVERY >= 2);

  const averageLabel = formatGames(Number(average.toFixed(1)));
  const summary = peak && trough
    ? `${subject}. High ${formatGames(peak.value)} games in ${shortPeriodLabel(peak.label)}.`
      + ` Low ${formatGames(trough.value)} games in ${shortPeriodLabel(trough.label)}.`
      + ` Average ${averageLabel} games a week.`
    : `${subject}. No weeks to chart.`;

  return (
    <section className="schedule-trend">
      <button
        className="tap-btn schedule-trend-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="schedule-trend-title">GAMES PER WEEK · {subject}</span>
        <span className="schedule-trend-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      <div id={panelId} className="schedule-trend-body" hidden={!open}>
        {points.length > 0 && (
          <svg
            className="schedule-trend-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={summary}
            preserveAspectRatio="xMidYMid meet"
          >
            <line
              className="schedule-trend-gridline"
              x1={LEFT}
              y1={TOP}
              x2={RIGHT}
              y2={TOP}
            />
            <line
              className="schedule-trend-baseline"
              x1={LEFT}
              y1={BOTTOM}
              x2={RIGHT}
              y2={BOTTOM}
            />
            <line
              className="schedule-trend-average"
              x1={LEFT}
              y1={y(average)}
              x2={RIGHT}
              y2={y(average)}
            />
            <text className="schedule-trend-axis" x={LEFT - 6} y={TOP + 4} textAnchor="end">
              {scaleTop}
            </text>
            <text className="schedule-trend-axis" x={LEFT - 6} y={BOTTOM + 4} textAnchor="end">
              0
            </text>

            <path className="schedule-trend-area" d={area} />
            <polyline className="schedule-trend-line" points={line.join(' ')} />

            {points.map((point, index) => (
              <circle
                key={point.leagueWeek}
                className={index === peakIndex || index === troughIndex
                  ? 'schedule-trend-dot schedule-trend-dot-edge'
                  : 'schedule-trend-dot'}
                cx={x(index)}
                cy={y(point.value)}
                r={index === peakIndex || index === troughIndex ? 3.4 : 2.2}
              />
            ))}

            {peak && (
              <text
                className="schedule-trend-value"
                x={x(peakIndex)}
                y={y(peak.value) - 8}
                textAnchor="middle"
              >
                {formatGames(peak.value)}
              </text>
            )}
            {trough && troughIndex !== peakIndex && (
              <text
                className="schedule-trend-value"
                x={x(troughIndex)}
                y={y(trough.value) + 14}
                textAnchor="middle"
              >
                {formatGames(trough.value)}
              </text>
            )}

            {points.map((point, index) => (
              showsWeek(index) ? (
                <text
                  key={point.leagueWeek}
                  className="schedule-trend-week"
                  x={x(index)}
                  y={WEEK_LABEL_Y}
                  textAnchor="middle"
                >
                  {shortPeriodLabel(point.label)}
                </text>
              ) : null
            ))}
          </svg>
        )}

        <p className="schedule-trend-summary">
          {peak && trough ? (
            <>
              High <b>{formatGames(peak.value)}</b> in {shortPeriodLabel(peak.label)}. Low{' '}
              <b>{formatGames(trough.value)}</b> in {shortPeriodLabel(trough.label)}. The dashed
              line is the {averageLabel} average.
            </>
          ) : (
            'No weeks to chart yet.'
          )}
        </p>
      </div>
    </section>
  );
}
