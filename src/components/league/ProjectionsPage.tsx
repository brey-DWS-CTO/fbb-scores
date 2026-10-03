import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { projectedPerGame } from '../../lib/league/draftRankings.js';
import { POSITIONS, valueBoard, type Position } from '../../lib/league/draftValue.js';
import { keepersForMock } from '../../lib/league/mockDraft.js';
import {
  FIXED_COLUMNS,
  PROJECTION_COLUMNS,
  buildProjections,
  changeTone,
  editTitle,
  filterProjections,
  projectionColumn,
  gamesTone,
  nextSort,
  oddsTone,
  pageOf,
  parseHiddenColumns,
  projectionsToCsv,
  visibleColumns,
  sortProjections,
  type PlayerProjection,
  type ProjectionColumnId,
  type ProjectionSort,
  type Tone,
} from '../../lib/league/projections.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { useDraftData, useIdentity, useKeeperScenario } from '../../hooks/useLeague.js';
import { PROJECTION_EDITS_KEY, useProjectionData } from '../../hooks/useProjectionData.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, deleteProjectionEdit, saveProjectionEdit } from '../../lib/league/api.js';
import { EDITABLE_COLUMNS, cellEdited, withCellEdit } from '../../lib/league/projectionEdits.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

const PAGE_SIZES = [20, 50, 100, 200, 500] as const;
const HIDDEN_KEY = 'nerds.projections.hidden';

function readHidden(): Set<ProjectionColumnId> {
  try {
    return parseHiddenColumns(window.localStorage.getItem(HIDDEN_KEY));
  } catch {
    return new Set();
  }
}

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
        text: (() => {
          const team = row.keptBy ?? row.lastTeam;
          const label = row.tag === 'open'
            ? <span className="proj-open">open</span>
            : (
              <span className={`mock-tag ${row.tag === 'keeper' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>
                {row.tag === 'keeper' ? 'keeper' : 'projected'} · {row.keptBy}
              </span>
            );
          // One place edits keepers: the team's keeper screen.
          return team
            ? (
              <Link
                className="proj-keeper-link"
                to={`/keepers/${encodeURIComponent(team)}`}
                title={`Open ${team}'s keepers`}
                onClick={(event) => event.stopPropagation()}
              >
                {label}
              </Link>
            )
            : label;
        })(),
      };
    case 'fppg':
      return {
        text: one(row.fppg),
        className: row.source === 'projection' ? 'proj-fppg' : 'proj-fppg proj-fallback',
      };
    case 'total': return { text: row.total === null ? '—' : row.total.toLocaleString(), className: 'proj-fppg' };
    case 'postPoints': return { text: row.postPoints === null ? '—' : row.postPoints.toLocaleString() };
    case 'playInGames': return { text: whole(row.playInGames) };
    case 'playoffGames': return { text: whole(row.playoffGames) };
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
    case 'min': return { text: one(row.line?.min ?? null) };
    case 'fgm': return { text: one(row.line?.fgm ?? null) };
    case 'fga': return { text: one(row.line?.fga ?? null) };
    case 'fgPct': return { text: one(row.line?.fgPct ?? null) };
    case 'ftm': return { text: one(row.line?.ftm ?? null) };
    case 'fta': return { text: one(row.line?.fta ?? null) };
    case 'ftPct': return { text: one(row.line?.ftPct ?? null) };
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

/**
 * Every player's projected season in this league's
 * scoring, with ESPN's line and the double-double bonus shown apart.
 */
export default function ProjectionsPage() {
  const { identity } = useIdentity();
  const { state, dataset } = useDraftData();
  const scenarioQuery = useKeeperScenario();
  const viewer = identity?.owner ?? null;
  const isCommish = identity?.isCommissioner === true;

  const { snapshot, original, edits } = useProjectionData();
  const [editedOnly, setEditedOnly] = useState(false);
  // The player whose stats are open for typing, and what has been typed.
  const [rowEdit, setRowEdit] = useState<{ key: string; values: Record<string, string> } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const scenario = scenarioQuery.scenario;

  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [hideKept, setHideKept] = useState(false);
  const [sort, setSort] = useState<ProjectionSort | null>({ column: 'fppg', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [exporting, setExporting] = useState(false);
  const [hidden, setHidden] = useState<Set<ProjectionColumnId>>(readHidden);
  const [picking, setPicking] = useState(false);
  const columns = useMemo(() => visibleColumns(hidden), [hidden]);
  const toggleColumn = (id: ProjectionColumnId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* no storage: the choice lasts until the page reloads */
    }
  };

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true }),
    [dataset.players, snapshot],
  );
  const keeperSets = useMemo(
    () => keepersForMock(dataset, { viewer, state, scenario, useEntered: true }),
    [dataset, viewer, state, scenario],
  );
  const rows = useMemo(
    () => buildProjections(values, snapshot, keeperSets, edits, original),
    [values, snapshot, keeperSets, edits, original],
  );
  const shown = useMemo(
    () => sortProjections(filterProjections(rows, { query, position, hideKept, editedOnly }), sort),
    [rows, query, position, hideKept, editedOnly, sort],
  );
  const current = pageOf(shown, page, pageSize);

  useEffect(() => {
    if (!rowEdit) return;
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`tr[data-editing="true"]`) || target?.closest('.proj-pencil')) return;
      void commitRowRef.current();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [rowEdit]);

  const espnRowOf = (row: PlayerProjection) =>
    original?.players.find((player) => player.espnId === row.espnId)?.projection ?? null;
  const espnValue = (row: PlayerProjection, statId: string): number | null => {
    const espn = espnRowOf(row);
    if (statId === '42') return espn?.stats['42'] ?? null;
    return projectedPerGame(espn)?.[statId] ?? null;
  };
  const shownValue = (row: PlayerProjection, column: ProjectionColumnId): number | null => {
    const value = projectionColumn(column).value(row);
    return typeof value === 'number' ? value : null;
  };
  // Save whatever is typed in the open row: one write for all its stats.
  const commitRow = async (open = rowEdit) => {
    setRowEdit(null);
    if (!open || !identity) return;
    const row = rows.find((entry) => entry.key === open.key);
    if (!row || row.espnId === null) return;
    let next: ReturnType<typeof withCellEdit> = row.edit ? { games: row.edit.games, perGame: { ...row.edit.perGame }, note: row.edit.note } : null;
    let changed = false;
    for (const [column, text] of Object.entries(open.values)) {
      const number = Number(text);
      if (text.trim() === '' || !Number.isFinite(number) || number < 0) continue;
      const before = shownValue(row, column as ProjectionColumnId);
      if (before !== null && Math.round(before * 10) === Math.round(number * 10)) continue;
      next = withCellEdit(next, espnRowOf(row), EDITABLE_COLUMNS[column], number);
      changed = true;
    }
    if (!changed) return;
    try {
      if (next) await saveProjectionEdit(identity, row.espnId, { name: row.name, ...next });
      else await deleteProjectionEdit(identity, row.espnId);
      await queryClient.invalidateQueries({ queryKey: PROJECTION_EDITS_KEY });
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    }
  };
  const openRow = (row: PlayerProjection) => {
    if (!isCommish || !identity || row.espnId === null || row.line === null) return;
    // Opening another player saves the one that was open.
    if (rowEdit && rowEdit.key !== row.key) void commitRow();
    setSaveError(null);
    const values: Record<string, string> = {};
    for (const column of Object.keys(EDITABLE_COLUMNS)) {
      const value = shownValue(row, column as ProjectionColumnId);
      values[column] = value === null ? '' : String(column === 'games' ? Math.round(value) : value);
    }
    setRowEdit({ key: row.key, values });
  };
  const commitRowRef = useRef(commitRow);
  useEffect(() => {
    commitRowRef.current = commitRow;
  });
  const resetRow = async (row: PlayerProjection) => {
    if (!identity || row.espnId === null) return;
    setRowEdit(null);
    try {
      await deleteProjectionEdit(identity, row.espnId);
      await queryClient.invalidateQueries({ queryKey: PROJECTION_EDITS_KEY });
    } catch (caught) {
      setSaveError(apiErrorMessage(caught));
    }
  };

  if (!viewer) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>SIGN IN</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Sign in to see projections.
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
    download(new Blob([projectionsToCsv(shown, columns)], { type: 'text/csv;charset=utf-8' }), 'projections.csv');
  };
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const header = [{ value: '#', fontWeight: 'bold' as const }, ...columns.map((column) => ({ value: column.header, fontWeight: 'bold' as const }))];
      const body = shown.map((row, index) => [{ value: index + 1 }, ...columns.map((column) => {
        const value = column.value(row);
        return value === null ? null : { value };
      })]);
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
        Points a game in our scoring: ESPN&apos;s line plus the double-double bonus. {isCommish
          ? ' Hover a player and tap ✎ to change his stats; click anywhere else to save. Your edits show in yellow.'
          : ' Numbers in yellow are the commish’s changes to ESPN’s projection.'}
        {!snapshot?.players.length && (
          <> No ESPN numbers are accepted yet.{' '}
            {isCommish ? <Link to="/admin">Fetch them in Commish Mode.</Link> : 'The commish will load them soon.'}</>
        )}
      </div>

      {snapshot && snapshot.players.length > 0 && projected === 0 && (
        <div className="panel proj-stale" role="status">
          <NavIcon name="warning" size={15} className="icon-in-heading" />
          The saved ESPN numbers are from {fetchedOn}, before ESPN posted its projections, so the
          projection columns are empty.{' '}
          {isCommish
            ? <><Link to="/admin">Update from ESPN in Commish Mode</Link>, save, and this page fills in.</>
            : 'The commish will update them soon.'}
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
        <label className="proj-check">
          <input type="checkbox" checked={editedOnly} onChange={(event) => { setEditedOnly(event.target.checked); resetPage(); }} />
          Edited only ({edits.size})
        </label>
        <div className="proj-export">
          <button type="button" className={`tap-btn mock-mini-btn${picking ? ' is-on' : ''}`} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            COLUMNS{hidden.size > 0 ? ` (${PROJECTION_COLUMNS.length - hidden.size} of ${PROJECTION_COLUMNS.length})` : ''}
          </button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={exportCsv} disabled={shown.length === 0}>
            EXPORT CSV
          </button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => void exportXlsx()} disabled={shown.length === 0 || exporting}>
            {exporting ? 'SAVING…' : 'EXPORT XLSX'}
          </button>
        </div>
      </section>

      {picking && (
        <section className="panel proj-columns" aria-label="Columns to show">
          {PROJECTION_COLUMNS.filter((column) => !FIXED_COLUMNS.has(column.id)).map((column) => (
            <label key={column.id} className="proj-column-pick" title={column.header}>
              <input type="checkbox" checked={!hidden.has(column.id)} onChange={() => toggleColumn(column.id)} />
              {column.label}
            </label>
          ))}
          {hidden.size > 0 && (
            <button
              type="button"
              className="tap-btn mock-mini-btn"
              onClick={() => {
                setHidden(new Set());
                try { window.localStorage.removeItem(HIDDEN_KEY); } catch { /* nothing to clear */ }
              }}
            >
              SHOW ALL
            </button>
          )}
        </section>
      )}

      {saveError && <div className="identity-error" role="alert">{saveError}</div>}

      <div className="panel proj-table-wrap">
        <table className="proj-table">
          <thead>
            <tr>
              <th className="proj-col-pos" title="Place in this sort"><span>#</span></th>
              {columns.map((column) => {
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
            {current.rows.map((row, index) => {
              const open = rowEdit?.key === row.key;
              return (
                <tr
                  key={row.key}
                  data-editing={open ? 'true' : undefined}
                  className={`proj-row${row.tag !== 'open' ? ' is-kept' : ''}${open ? ' is-editing' : ''}`}
                >
                  <td className="proj-col-pos">{current.from + index}</td>
                  {columns.map((column) => {
                    const { text, className } = cell(row, column.id);
                    const statId = EDITABLE_COLUMNS[column.id];
                    const edited = statId !== undefined && cellEdited(row.edit, statId);
                    const classes = `proj-col-${column.id}${className ? ` ${className}` : ''}${edited ? ' proj-cell-edited' : ''}`;
                    if (column.id === 'name') {
                      return (
                        <td key={column.id} className={classes}>
                          <span className="proj-name">{text}</span>
                          {isCommish && row.espnId !== null && row.line !== null && !open && (
                            <button
                              type="button"
                              className={`proj-pencil${row.edit ? ' is-edited' : ''}`}
                              title={row.edit ? `${editTitle(row) ?? 'Edited.'} Click to change.` : 'Change his projection'}
                              aria-label={`Edit ${row.name}`}
                              onClick={() => openRow(row)}
                            >
                              ✎
                            </button>
                          )}
                          {open && row.edit && (
                            <button type="button" className="proj-reset" onClick={() => void resetRow(row)} title="Undo every change to this player">
                              ↺ UNDO
                            </button>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.id}
                        className={classes}
                        title={edited && !open ? `ESPN: ${espnValue(row, statId)?.toFixed(column.id === 'games' ? 0 : 1) ?? 'none'}` : undefined}
                      >
                        {open && statId !== undefined ? (
                          <input
                            className="proj-cell-input"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            autoFocus={column.id === 'games'}
                            aria-label={`${row.name} ${column.header}`}
                            value={rowEdit.values[column.id] ?? ''}
                            onFocus={(event) => event.currentTarget.select()}
                            // Typed numbers only: no spinner, wheel or arrow keys can change a value.
                            onChange={(event) => setRowEdit({ ...rowEdit, values: { ...rowEdit.values, [column.id]: event.target.value.replace(/[^0-9.]/g, '') } })}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') { event.preventDefault(); setRowEdit(null); }
                              if (event.key === 'Enter') { event.preventDefault(); void commitRow(); }
                            }}
                          />
                        ) : text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {current.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="proj-empty">No players match.</td>
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
