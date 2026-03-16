import type { FC } from 'react';

interface SparklineProps {
  /** Array of numeric values to plot */
  data: number[];
  /** Width of the SVG in pixels */
  width?: number;
  /** Height of the SVG in pixels */
  height?: number;
  /** Stroke color (CSS color string) */
  color?: string;
  /** Whether to show a filled area under the line */
  filled?: boolean;
  /** Label shown on hover or below the sparkline */
  label?: string;
}

/**
 * Inline SVG sparkline chart — no dependencies.
 * Renders a small line chart suitable for embedding in table cells.
 */
const Sparkline: FC<SparklineProps> = ({
  data,
  width = 80,
  height = 24,
  color = 'var(--neon-teal)',
  filled = true,
  label,
}) => {
  if (data.length < 2) {
    return (
      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '0.9rem',
          color: '#555577',
        }}
      >
        -
      </span>
    );
  }

  const padding = 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * plotWidth;
    const y = padding + plotHeight - ((value - min) / range) * plotHeight;
    return { x, y };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // Filled area path — line path + close to bottom
  const areaD = filled
    ? `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`
    : '';

  // Determine trend direction
  const lastVal = data[data.length - 1];
  const prevVal = data[data.length - 2];
  const trendUp = lastVal > prevVal;
  const trendFlat = lastVal === prevVal;

  return (
    <div className="inline-flex flex-col items-center gap-0.5" title={label}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        {/* Filled area */}
        {filled && areaD && (
          <path d={areaD} fill={color} opacity={0.15} />
        )}
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Endpoint dot */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2}
          fill={color}
        />
      </svg>
      {label && (
        <span
          className="pixel-text"
          style={{
            fontSize: '0.22rem',
            color: trendFlat ? '#555577' : trendUp ? 'var(--neon-teal)' : 'var(--neon-red)',
          }}
        >
          {trendUp ? '▲' : trendFlat ? '—' : '▼'} {label}
        </span>
      )}
    </div>
  );
};

export default Sparkline;
