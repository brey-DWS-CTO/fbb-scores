import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDraftRankings } from '../../lib/league/api.js';
import { rankSourceLabel } from '../../lib/league/draftRankings.js';
import { POSITIONS, valueBoard, type Position } from '../../lib/league/draftValue.js';
import { keepersForMock } from '../../lib/league/mockDraft.js';
import {
  PROJECTION_COLUMNS,
  buildProjections,
  changeTone,
  filterProjections,
  gamesTone,
  nextSort,
  oddsTone,
  pageOf,
  projectionsToCsv,
  sortProjections,
  type PlayerProjection,
  type ProjectionColumnId,
  type ProjectionSort,
  type Tone,
} from '../../lib/league/projections.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { useDraftData, useIdentity, useKeeperScenario } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

const PAGE_SIZES = [20, 50, 100, 200, 500] as const;

const one = (value: number | null) => (value === null ? '—' : value.toFixed(1));
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const whole = (value: number | null) => (value === null ? '—' : String(Math.round(value)));
const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`);

function toneClass(tone: Tone): string {
  return tone ? ` proj-${tone}` : '';
}

/** What a cell shows, and its colour. The spreadsheet gets the raw numbers instead. */
function cell(row: PlayerProjection, id: ProjectionColumnId): { text: React.ReactNode; className?: string } {
  switch (id) {
    case 'valueRank': return { text: row.valueRank };
    case 'name': return { text: row.name };
    case 'proTeam': return { text: row.proTeam };
    case 'positions': return { text: row.positions.join('/') || '—' };
    case 'tag':
      return {
        text: row.tag === 'open'
          ? <span className="proj-open">open</span>
          : (
            <span className={`mock-tag ${row.tag === 'keeper' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>
              {row.tag === 'keeper' ? 'keeper' : 'projected'} · {row.keptBy}
            </span>
          ),
      };
    case 'fppg':
      return {
        text: one(row.fppg),
        className: row.source === 'projection' ? 'proj-fppg' : 'proj-fppg proj-fallback',
      };
    case 'base': return { text: one(row.base) };
    case 'bonus': return { text: row.bonus === null ? '—' : `+${row.bonus.toFixed(1)}` };
    case 'ddOdds': return { text: pct(row.ddOdds), className: toneClass(oddsTone(row.ddOdds)).trim() };
    case 'tdOdds': return { text: pct(row.tdOdds), className: toneClass(oddsTone(row.tdOdds)).trim() };
    case 'games': return { text: whole(row.games), className: toneClass(gamesTone(row.games)).trim() };
    case 'pts': return { text: one(row.line?.pts ?? null) };
    case 'reb': return { text: one(row.line?.reb ?? null) };
    case 'ast': return { text: one(row.line?.ast ?? null) };
    case 'stl': return { text: one(row.line?.stl ?? null) };
    case 'blk': return { text: one(row.line?.blk ?? null) };
    case 'threes': return { text: one(row.line?.threes ?? null) };
    case 'to': return { text: one(row.line?.to ?? null) };
    case 'lastSeason': return { text: one(row.lastSeason) };
    case 'change': return { text: signed(row.change), className: toneClass(changeTone(row.change)).trim() };
    case 'espnRank': return { text: whole(row.espnRank) };
    case 'adp': return { text: one(row.adp) };
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Detail({ row, season }: { row: PlayerProjection; season: number }) {
  return (
    <div className="proj-detail">
      {row.base !== null && row.bonus !== null && row.fppg !== null ? (
        <p>
          <strong>{row.base.toFixed(1)}</strong> from ESPN&apos;s line in our scoring,
          plus <strong>{row.bonus.toFixed(1)}</strong> for double- and triple-doubles,
          makes <strong>{row.fppg.toFixed(1)}</strong> a game.
        </p>
      ) : (
        <p>
          ESPN has no projection for him. His {one(row.fppg)} comes from the {rankSourceLabel(row.source, season)}.
        </p>
      )}
      <p>
        {row.ddOdds !== null && <>Double-double in {pct(row.ddOdds)} of games, triple-double in {pct(row.tdOdds)}. </>}
        {row.games !== null && <>ESPN has him for {whole(row.games)} games. </>}
        {row.lastSeason !== null ? <>Last season: {row.lastSeason.toFixed(1)}. </> : <>No games last season. </>}
      </p>
      <p>
        Board rank {row.valueRank}
        {row.espnRank !== null && <>, ESPN rank {row.espnRank}</>}
        {row.adp !== null && <>, ADP {row.adp.toFixed(1)}</>}.
        {row.lastTeam && <> On {row.lastTeam}&apos;s roster last season.</>}
        {row.keptBy && <> {row.tag === 'keeper' ? 'Kept by' : 'Projected keeper for'} {row.keptBy}.</>}
      </p>
    </div>
  );
}

/**
 * Commissioner tool: every player's projected season in this league's
 * scoring, with ESPN's line and the double-double bonus shown apart.
 */
export default function ProjectionsPage() {
  const { identity } = useIdentity();
  const { state, dataset, meta } = useDraftData();
  const scenarioQuery = useKeeperScenario();
  const viewer = identity?.owner ?? null;
  const isCommish = identity?.isCommissioner === true;

  const rankingsQuery = useQuery({
    queryKey: ['mock-draft-rankings', viewer ?? 'anon', meta?.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 30_000,
  });
  const snapshot = rankingsQuery.data?.snapshot ?? null;
  const scenario = scenarioQuery.scenario;

  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [hideKept, setHideKept] = useState(false);
  const [sort, setSort] = useState<ProjectionSort | null>({ column: 'fppg', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027 }),
    [dataset.players, snapshot],
  );
  const keeperSets = useMemo(
    () => keepersForMock(dataset, { viewer, state, scenario, useEntered: true }),
    [dataset, viewer, state, scenario],
  );
  const rows = useMemo(() => buildProjections(values, snapshot, keeperSets), [values, snapshot, keeperSets]);
  const shown = useMemo(
    () => sortProjections(filterProjections(rows, { query, position, hideKept }), sort),
    [rows, query, position, hideKept, sort],
  );
  const current = pageOf(shown, page, pageSize);

  if (!isCommish || !viewer) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>COMMISH ONLY</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Projections are the commish&apos;s for now.
          </div>
        </div>
      </div>
    );
  }

  const resetPage = () => setPage(1);
  const projected = rows.filter((row) => row.source === 'projection').length;
  const fetchedOn = snapshot && snapshot.players.length > 0
    ? new Date(snapshot.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  const exportCsv = () => {
    download(new Blob([projectionsToCsv(shown)], { type: 'text/csv;charset=utf-8' }), 'projections.csv');
  };
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const header = PROJECTION_COLUMNS.map((column) => ({ value: column.header, fontWeight: 'bold' as const }));
      const body = shown.map((row) => PROJECTION_COLUMNS.map((column) => {
        const value = column.value(row);
        return value === null ? null : { value };
      }));
      await writeXlsxFile([header, ...body], { stickyRowsCount: 1 }).toFile('projections.xlsx');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mock-page proj-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="chart" size={16} className="icon-in-heading" />
          PROJECTIONS
        </h1>
        <IdentityChip />
      </div>
      <div className="mock-intro">
        Every player&apos;s projected points a game in our scoring: ESPN&apos;s line, plus the double- and
        triple-double bonus ESPN leaves out. {projected} players have an ESPN projection
        {fetchedOn ? `, fetched ${fetchedOn}` : ''}. <span className="proj-fallback">Grey</span> numbers have none
        and come from ESPN&apos;s rank or last season. Tap a player to see how his number is built.
        {!snapshot?.players.length && (
          <> No ESPN numbers are accepted yet. <Link to="/admin">Fetch them in Commish Mode.</Link></>
        )}
        {' '}<Link to="/mock">Open the mock draft →</Link>
      </div>

      {snapshot && snapshot.players.length > 0 && projected === 0 && (
        <div className="panel proj-stale" role="status">
          <NavIcon name="warning" size={15} className="icon-in-heading" />
          Your saved ESPN numbers are from {fetchedOn}, before ESPN posted its projections, so the
          projection columns are empty. <Link to="/admin">Update from ESPN in Commish Mode</Link>, save, and
          this page fills in.
        </div>
      )}

      <section className="panel mock-controls proj-controls">
        <div className="proj-search">
          <input
            className="hub-input"
            type="search"
            placeholder="Search across all columns..."
            aria-label="Search players"
            value={query}
            onChange={(event) => { setQuery(event.target.value); resetPage(); }}
          />
          {query && (
            <button type="button" className="proj-clear" aria-label="Clear search" onClick={() => { setQuery(''); resetPage(); }}>
              <NavIcon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="mock-seg" role="radiogroup" aria-label="Position">
          {(['ALL', ...POSITIONS] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={position === choice}
              className={`tap-btn mock-seg-btn${position === choice ? ' is-on' : ''}`}
              onClick={() => { setPosition(choice); resetPage(); }}
            >
              {choice}
            </button>
          ))}
        </div>
        <label className="proj-check">
          <input type="checkbox" checked={hideKept} onChange={(event) => { setHideKept(event.target.checked); resetPage(); }} />
          Hide keepers
        </label>
        <div className="proj-export">
          <button type="button" className="tap-btn mock-mini-btn" onClick={exportCsv} disabled={shown.length === 0}>
            EXPORT CSV
          </button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => void exportXlsx()} disabled={shown.length === 0 || exporting}>
            {exporting ? 'SAVING…' : 'EXPORT XLSX'}
          </button>
        </div>
      </section>

      <div className="panel proj-table-wrap">
        <table className="proj-table">
          <thead>
            <tr>
              {PROJECTION_COLUMNS.map((column) => {
                const sorted = sort?.column === column.id ? sort.dir : null;
                return (
                  <th
                    key={column.id}
                    className={`proj-col-${column.id}`}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    title={column.header}
                  >
                    <button type="button" onClick={() => { setSort(nextSort(sort, column.id)); resetPage(); }}>
                      {column.label}
                      <span className={sorted ? 'proj-caret is-on' : 'proj-caret'} aria-hidden="true">
                        {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((row) => {
              const isOpen = open === row.key;
              return (
                <Fragment key={row.key}>
                  <tr
                    className={`proj-row${isOpen ? ' is-open' : ''}${row.tag !== 'open' ? ' is-kept' : ''}`}
                    onClick={() => setOpen(isOpen ? null : row.key)}
                  >
                    {PROJECTION_COLUMNS.map((column) => {
                      const { text, className } = cell(row, column.id);
                      return (
                        <td key={column.id} className={`proj-col-${column.id}${className ? ` ${className}` : ''}`}>
                          {column.id === 'name'
                            ? <button type="button" className="proj-name" aria-expanded={isOpen}>{text}</button>
                            : text}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && (
                    <tr className="proj-detail-row">
                      <td colSpan={PROJECTION_COLUMNS.length}>
                        <Detail row={row} season={dataset.season} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {current.rows.length === 0 && (
              <tr>
                <td colSpan={PROJECTION_COLUMNS.length} className="proj-empty">No players match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="proj-pager">
        <span className="proj-count">
          {current.total === 0 ? 'No players' : `${current.from}–${current.to} of ${current.total} player${current.total === 1 ? '' : 's'}`}
        </span>
        <div className="proj-pages">
          <button type="button" className="tap-btn mock-mini-btn" aria-label="First page" disabled={current.page === 1} onClick={() => setPage(1)}>|‹</button>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Previous page" disabled={current.page === 1} onClick={() => setPage(current.page - 1)}>‹</button>
          <select
            className="hub-input mock-select"
            aria-label="Page"
            value={current.page}
            onChange={(event) => setPage(Number(event.target.value))}
          >
            {Array.from({ length: current.pageCount }, (_, index) => (
              <option key={index + 1} value={index + 1}>Page {index + 1} of {current.pageCount}</option>
            ))}
          </select>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Next page" disabled={current.page === current.pageCount} onClick={() => setPage(current.page + 1)}>›</button>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Last page" disabled={current.page === current.pageCount} onClick={() => setPage(current.pageCount)}>›|</button>
        </div>
        <div className="mock-seg" role="radiogroup" aria-label="Rows per page">
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={pageSize === size}
              className={`tap-btn mock-seg-btn${pageSize === size ? ' is-on' : ''}`}
              onClick={() => { setPageSize(size); resetPage(); }}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
