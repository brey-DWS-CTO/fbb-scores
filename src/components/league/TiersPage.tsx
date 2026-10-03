import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { POSITIONS, valueBoard, type Position } from '../../lib/league/draftValue.js';
import { keepersForMock } from '../../lib/league/mockDraft.js';
import { buildProjections } from '../../lib/league/projections.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import {
  TIER_PAGE_SIZE,
  buildTierRows,
  labelSide,
  niceTicks,
  tierPages,
  type TierRow,
} from '../../lib/league/tierChart.js';
import { useDraftData, useIdentity, useKeeperScenario } from '../../hooks/useLeague.js';
import { useProjectionData } from '../../hooks/useProjectionData.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

// Eight tier colours, repeated past tier 8. Neighbours never match, and the
// tier number sits on every band, so colour is never the only clue.
const TIER_COLORS = 8;
const tierColor = (tier: number) => `var(--tier-${((tier - 1) % TIER_COLORS) + 1})`;

const ROW_HEIGHT = 22;
const AXIS_HEIGHT = 36;
const RANK_WIDTH = 24;
const NAME_FONT = 11;
const NAME_GAP = 6;

/** The pixel boxes the chart is drawn in, for a given width. */
function layoutFor(width: number) {
  const narrow = width < 560;
  const totalWidth = narrow ? 76 : 200;
  const mainLeft = RANK_WIDTH + 8;
  const mainRight = width - totalWidth - 14;
  return {
    narrow,
    mainLeft,
    mainRight,
    totalLeft: mainRight + 14,
    totalRight: width - 6,
  };
}

type Layout = ReturnType<typeof layoutFor>;

/** A linear scale from a domain onto a pixel range. */
function scale(min: number, max: number, left: number, right: number) {
  const span = max - min || 1;
  return (value: number) => left + ((value - min) / span) * (right - left);
}

/** Width of a name in the chart's font. A canvas measures it; a guess stands in without one. */
function useMeasure() {
  const context = useMemo(() => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
        ctx.font = `600 ${NAME_FONT}px ${family}`;
      }
      return ctx;
    } catch {
      return null;
    }
  }, []);
  return (text: string) => (context ? context.measureText(text).width : text.length * NAME_FONT * 0.56);
}

/** The width of the box the chart sits in, kept current as the window changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const thousands = (value: number) => {
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const k = value / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
};

interface Scales {
  fppg: ReturnType<typeof niceTicks>;
  total: ReturnType<typeof niceTicks>;
  x: (value: number) => number;
  t: (value: number) => number;
}

function scalesFor(rows: readonly TierRow[], layout: Layout): Scales {
  const fppg = niceTicks(
    Math.min(...rows.map((row) => row.fppgLow)),
    Math.max(...rows.map((row) => row.fppgHigh)),
    layout.mainRight - layout.mainLeft < 300 ? 4 : 7,
  );
  const total = niceTicks(
    Math.min(...rows.map((row) => row.totalLow)),
    Math.max(...rows.map((row) => row.totalHigh)),
    layout.totalRight - layout.totalLeft < 120 ? 2 : 4,
  );
  // Inset by a dot's width, so a dot at either end of the range is drawn whole.
  const inset = 7;
  return {
    fppg,
    total,
    x: scale(fppg.min, fppg.max, layout.mainLeft + inset, layout.mainRight - inset),
    t: scale(total.min, total.max, layout.totalLeft + inset, layout.totalRight - inset),
  };
}

function Grid({ scales, height }: { scales: Scales; height: number }) {
  return (
    <g className="tier-grid">
      {scales.fppg.ticks.map((tick) => (
        <line key={`f${tick}`} x1={scales.x(tick)} x2={scales.x(tick)} y1={0} y2={height} />
      ))}
      {scales.total.ticks.map((tick) => (
        <line key={`t${tick}`} x1={scales.t(tick)} x2={scales.t(tick)} y1={0} y2={height} />
      ))}
    </g>
  );
}

/** A tick label hard by a panel's edge leans inward, so the two panels' labels never meet. */
const edgeAnchor = (x: number, left: number, right: number) =>
  x - left < 10 ? 'start' : right - x < 10 ? 'end' : 'middle';

function Axis({ scales, layout, width }: { scales: Scales; layout: Layout; width: number }) {
  return (
    <svg className="tier-axis" width={width} height={AXIS_HEIGHT} aria-hidden="true">
      <text className="tier-axis-title" x={(layout.mainLeft + layout.mainRight) / 2} y={12} textAnchor="middle">
        POINTS A GAME
      </text>
      <text className="tier-axis-title" x={(layout.totalLeft + layout.totalRight) / 2} y={12} textAnchor="middle">
        SEASON TOTAL
      </text>
      <text className="tier-axis-title" x={RANK_WIDTH - 2} y={12} textAnchor="end">#</text>
      {scales.fppg.ticks.map((tick) => (
        <text key={`f${tick}`} className="tier-tick" x={scales.x(tick)} y={30} textAnchor={edgeAnchor(scales.x(tick), layout.mainLeft, layout.mainRight)}>{tick}</text>
      ))}
      {scales.total.ticks.map((tick) => (
        <text key={`t${tick}`} className="tier-tick" x={scales.t(tick)} y={30} textAnchor={edgeAnchor(scales.t(tick), layout.totalLeft, layout.totalRight)}>{thousands(tick)}</text>
      ))}
    </svg>
  );
}

function Row({
  row,
  scales,
  layout,
  width,
  measure,
}: {
  row: TierRow;
  scales: Scales;
  layout: Layout;
  width: number;
  measure: (text: string) => number;
}) {
  const color = tierColor(row.tier);
  const mid = ROW_HEIGHT / 2;
  const low = scales.x(row.fppgLow);
  const high = scales.x(row.fppgHigh);
  const dot = scales.x(row.fppg);
  const keeper = row.tag === 'open' ? '' : ' K';
  const name = layout.narrow ? row.shortName : row.name;
  const labelWidth = measure(name + keeper);
  const barLeft = Math.min(low, dot);
  const barRight = Math.max(high, dot);
  const side = labelSide(barLeft, barRight, labelWidth, layout.mainLeft, layout.mainRight, NAME_GAP);
  // When the name fits neither side it stays inside the plot and crosses the
  // bar; the halo in the name's style keeps it readable.
  const nameX = side === 'left'
    ? Math.max(layout.mainLeft + labelWidth, barLeft - NAME_GAP)
    : Math.min(layout.mainRight - labelWidth, barRight + NAME_GAP);
  const totalLow = scales.t(row.totalLow);
  const totalHigh = scales.t(row.totalHigh);

  return (
    <svg width={width} height={ROW_HEIGHT} aria-hidden="true">
      <Grid scales={scales} height={ROW_HEIGHT} />
      <text className="tier-rank" x={RANK_WIDTH - 2} y={mid} dominantBaseline="central" textAnchor="end">{row.rank}</text>
      <rect x={RANK_WIDTH + 2} y={0} width={4} height={ROW_HEIGHT} style={{ fill: color }} />
      {high - low > 0.5 && (
        <line className="tier-bar" x1={low} x2={high} y1={mid} y2={mid} style={{ stroke: color }} />
      )}
      <circle className="tier-dot" cx={dot} cy={mid} r={4} style={{ fill: color }} />
      <text
        className="tier-name"
        x={nameX}
        y={mid}
        dominantBaseline="central"
        textAnchor={side === 'left' ? 'end' : 'start'}
      >
        {name}
        {keeper && <tspan className={row.tag === 'keeper' ? 'tier-k-known' : 'tier-k-guess'}>{keeper}</tspan>}
      </text>
      {totalHigh - totalLow > 0.5 && (
        <line className="tier-bar" x1={totalLow} x2={totalHigh} y1={mid} y2={mid} style={{ stroke: color }} />
      )}
      <circle className="tier-dot" cx={scales.t(row.total)} cy={mid} r={4} style={{ fill: color }} />
    </svg>
  );
}

function Detail({ row }: { row: TierRow }) {
  const atLast = row.lastGames !== null && row.lastGames !== row.games
    ? Math.round(row.fppg * row.lastGames)
    : null;
  return (
    <div className="tier-detail">
      <div className="tier-detail-head">
        <strong>{row.name}</strong>
        <span>{row.proTeam} · {row.positions.join('/') || '—'} · Tier {row.tier} · #{row.rank}{row.adp !== null ? ` · ADP ${row.adp.toFixed(1)}` : ''}</span>
      </div>
      <div className="tier-detail-grid">
        <div>
          <div className="tier-detail-label">POINTS A GAME</div>
          {row.estimates.map((estimate) => (
            <div key={estimate.label} className="tier-detail-line">
              <span className="tier-detail-num">{estimate.fppg.toFixed(1)}</span>
              {estimate.label}
            </div>
          ))}
        </div>
        <div>
          <div className="tier-detail-label">SEASON TOTAL</div>
          <div className="tier-detail-line">
            <span className="tier-detail-num">{row.total.toLocaleString()}</span>
            over {Math.round(row.games)} projected games
          </div>
          {atLast !== null && (
            <div className="tier-detail-line">
              <span className="tier-detail-num">{atLast.toLocaleString()}</span>
              over last season&apos;s {row.lastGames} games
            </div>
          )}
          {row.lastGames === null && <div className="tier-detail-line tier-detail-note">No games last season to compare.</div>}
        </div>
      </div>
      {row.keptBy && (
        <div className="tier-detail-note">
          {row.tag === 'keeper' ? `Kept by ${row.keptBy}.` : `Projected keeper for ${row.keptBy}.`}
        </div>
      )}
    </div>
  );
}

function TierChart({ rows }: { rows: readonly TierRow[] }) {
  const { ref, width } = useWidth();
  const measure = useMeasure();
  const [open, setOpen] = useState<string | null>(null);
  const layout = layoutFor(width);
  const scales = rows.length > 0 && width > 0 ? scalesFor(rows, layout) : null;

  const tiers: TierRow[][] = [];
  for (const row of rows) {
    const last = tiers[tiers.length - 1];
    if (last && last[0].tier === row.tier) last.push(row);
    else tiers.push([row]);
  }

  return (
    <div ref={ref} className="tier-chart">
      {scales && (
        <>
          <div className="tier-axis-wrap"><Axis scales={scales} layout={layout} width={width} /></div>
          {tiers.map((group) => (
            <section key={group[0].tier} className="tier-group" aria-label={`Tier ${group[0].tier}`}>
              <div className="tier-head">
                <span className="tier-swatch" style={{ background: tierColor(group[0].tier) }} />
                TIER {group[0].tier}
              </div>
              {group.map((row) => (
                <Fragment key={row.key}>
                  <button
                    type="button"
                    className={`tier-row${open === row.key ? ' is-open' : ''}${row.tag !== 'open' ? ' is-kept' : ''}`}
                    aria-expanded={open === row.key}
                    aria-label={`${row.rank}. ${row.name}, tier ${row.tier}. ${row.fppg.toFixed(1)} points a game, ${row.total.toLocaleString()} for the season.`}
                    onClick={() => setOpen(open === row.key ? null : row.key)}
                  >
                    <Row row={row} scales={scales} layout={layout} width={width} measure={measure} />
                  </button>
                  {open === row.key && <Detail row={row} />}
                </Fragment>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Tiers in the style of Boris Chen's football charts: one row per player,
 * ranked by season total, with points a game beside it and a bar for how far
 * our numbers disagree.
 */
export default function TiersPage() {
  const { identity } = useIdentity();
  const { state, dataset } = useDraftData();
  const scenarioQuery = useKeeperScenario();
  const viewer = identity?.owner ?? null;
  const scenario = scenarioQuery.scenario;
  const { snapshot, original, edits, loading } = useProjectionData();

  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [hideKept, setHideKept] = useState(false);
  const [page, setPage] = useState(0);

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true }),
    [dataset.players, snapshot],
  );
  const keeperSets = useMemo(
    () => keepersForMock(dataset, { viewer, state, scenario, useEntered: true }),
    [dataset, viewer, state, scenario],
  );
  const projections = useMemo(
    () => buildProjections(values, snapshot, keeperSets, edits, original),
    [values, snapshot, keeperSets, edits, original],
  );
  const rows = useMemo(
    () => buildTierRows(projections, dataset.players, { position, hideKept }),
    [projections, dataset.players, position, hideKept],
  );
  const pages = tierPages(rows.length);
  const current = Math.min(page, Math.max(0, pages.length - 1));
  const shown = rows.slice(current * TIER_PAGE_SIZE, (current + 1) * TIER_PAGE_SIZE);

  if (!viewer) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>SIGN IN</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Sign in to see tiers.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mock-page tier-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="tiers" size={16} className="icon-in-heading" />
          TIERS
        </h1>
        <IdentityChip />
      </div>
      <div className="mock-intro">
        Players ranked by the points they should score this season, cut into tiers where the numbers
        leave a gap. The dot is the projection. The bar runs from the lowest to the highest number we
        have for him: ESPN, last season and the season before for points a game; last season&apos;s
        games for the total. Tap a player to see the numbers. <Link to="/projections">Same numbers as a table.</Link>
      </div>

      <section className="panel mock-controls proj-controls">
        <div className="mock-seg" role="radiogroup" aria-label="Position">
          {(['ALL', ...POSITIONS] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={position === choice}
              className={`tap-btn mock-seg-btn${position === choice ? ' is-on' : ''}`}
              onClick={() => { setPosition(choice); setPage(0); }}
            >
              {choice}
            </button>
          ))}
        </div>
        <label className="proj-check">
          <input type="checkbox" checked={hideKept} onChange={(event) => { setHideKept(event.target.checked); setPage(0); }} />
          Hide keepers
        </label>
        {pages.length > 1 && (
          <div className="mock-seg tier-pages" role="radiogroup" aria-label="Players">
            {pages.map((label, index) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={current === index}
                className={`tap-btn mock-seg-btn${current === index ? ' is-on' : ''}`}
                onClick={() => setPage(index)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="panel tier-panel">
        {loading && rows.length === 0 && <div className="tier-empty">Loading projections…</div>}
        {!loading && rows.length === 0 && (
          <div className="tier-empty">
            No projections yet.{' '}
            {identity?.isCommissioner
              ? <Link to="/admin">Fetch ESPN&apos;s numbers in Commish Mode.</Link>
              : 'The commish will load them soon.'}
          </div>
        )}
        {shown.length > 0 && <TierChart key={`${position}-${hideKept}-${current}`} rows={shown} />}
      </div>
    </div>
  );
}
