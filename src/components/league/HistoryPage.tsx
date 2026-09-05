import { useEffect, useMemo, useState } from 'react';
import { useLeagueHistory } from '../../hooks/useLeague.js';
import {
  fetchHistoryVersions,
  type HistoryVersionSummary,
} from '../../lib/league/api.js';
import {
  franchiseIndex,
  franchiseTotals,
  rankRecords,
  reviewFlags,
  seasonRows,
  sortRankedRecords,
  type RecordSortKey,
} from '../../lib/league/history.js';
import IdentityChip from './IdentityChip.js';

const SOURCE_LABEL: Record<string, string> = {
  espn: 'ESPN',
  rulebook: 'Rule book',
  commissioner: 'Commish',
};

interface SortState {
  key: RecordSortKey;
  descending: boolean;
}

function SortHeader({
  label,
  columnKey,
  sort,
  onSort,
  numeric,
  className,
}: {
  label: string;
  columnKey: RecordSortKey;
  sort: SortState;
  onSort: (key: RecordSortKey) => void;
  numeric?: boolean;
  className?: string;
}) {
  const active = sort.key === columnKey;
  return (
    <th className={[numeric ? 'records-num' : '', className ?? ''].filter(Boolean).join(' ') || undefined}>
      <button
        type="button"
        className={active ? 'history-sort history-sort-on' : 'history-sort'}
        onClick={() => onSort(columnKey)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden="true">{active ? (sort.descending ? ' ▼' : ' ▲') : ' ⇅'}</span>
      </button>
    </th>
  );
}

/** /history — the league's own record of itself. Open to anyone. */
export default function HistoryPage() {
  const { history, published, revision, publishedAt } = useLeagueHistory();
  const [openSeason, setOpenSeason] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'rank', descending: false });
  const [versions, setVersions] = useState<HistoryVersionSummary[]>([]);

  useEffect(() => {
    fetchHistoryVersions()
      .then(setVersions)
      // A missing revision list is not worth an error banner; the book still reads.
      .catch(() => setVersions([]));
  }, []);

  const franchises = useMemo(() => franchiseIndex(history), [history]);
  const seasons = useMemo(() => seasonRows(history), [history]);
  const totals = useMemo(() => franchiseTotals(history), [history]);
  const flags = useMemo(() => reviewFlags(history), [history]);
  const category = history.recordCategories.find((entry) => entry.id === 'weekly-high-score');
  const ranked = useMemo(
    () => rankRecords(history.records, 'weekly-high-score', category?.higherIsBetter ?? true),
    [history.records, category?.higherIsBetter],
  );
  const rows = useMemo(() => sortRankedRecords(ranked, sort.key, sort.descending), [ranked, sort]);
  // Season 9 means nothing to a reader; "2018-2019" does.
  const seasonLabel = useMemo(
    () => new Map(history.seasons.map((season) => [season.seasonNumber, season.label])),
    [history.seasons],
  );
  const seasonEndYear = useMemo(
    () =>
      new Map(
        history.seasons.map((season) => {
          const endingYear = season.label.match(/\d{4}$/)?.[0];
          return [season.seasonNumber, endingYear ?? season.label];
        }),
      ),
    [history.seasons],
  );

  const onSort = (key: RecordSortKey) =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: key !== 'owner' },
    );

  return (
    <div className="history-page">
      <div className="history-head">
        <h1 className="hub-heading glow-teal history-title">LEAGUE HISTORY</h1>
        <IdentityChip />
      </div>
      <p className="history-status">
        {published
          ? `Revision ${revision}, published ${publishedAt ? new Date(publishedAt).toLocaleDateString() : ''}.`
          : 'Not published yet. This is the committed seed the commissioner is reviewing.'}
      </p>

      <section className="panel history-panel">
        <div className="hub-heading history-heading">SEASON BY SEASON</div>
        <div className="rules-table-wrap">
          <table className="rules-table records-table history-responsive-table history-season-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Year</th>
                <th>Champion</th>
                <th>Runner-up</th>
                <th className="history-season-source">Source</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((row) => {
                const open = openSeason === row.season.id;
                return [
                  <tr
                    key={row.season.id}
                    className="history-season-row"
                    onClick={() => setOpenSeason(open ? null : row.season.id)}
                  >
                    <td>{row.season.seasonNumber}</td>
                    <td>{row.season.label}</td>
                    <td>{row.champion?.ownerName ?? 'Unknown'}</td>
                    <td>{row.runnerUp?.ownerName ?? 'Unknown'}</td>
                    <td className="history-season-source">{SOURCE_LABEL[row.season.source.provenance] ?? row.season.source.provenance}</td>
                  </tr>,
                  open ? (
                    <tr key={`${row.season.id}-detail`}>
                      <td colSpan={5} className="history-season-detail">
                        <div>
                          {row.season.standingsComplete
                            ? 'Full final standings on file.'
                            : 'Only the top two finishes are on file for this season.'}
                        </div>
                        {row.others.length > 0 && (
                          <ol className="history-standings">
                            {row.others.map((entry) => (
                              <li key={`${row.season.id}-${entry.franchiseId}`}>
                                {entry.placement ?? '?'}. {entry.ownerName}
                              </li>
                            ))}
                          </ol>
                        )}
                        <div className="history-source">
                          {row.season.source.reference}
                          {row.season.source.verified ? ' · checked' : ' · not checked yet'}
                        </div>
                        {row.season.note && <div className="history-source">{row.season.note}</div>}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
        <p className="records-caption">Tap a season for the rest of the finishes and where they came from.</p>
      </section>

      <section className="panel history-panel">
        <div className="hub-heading history-heading">TITLES BY FRANCHISE</div>
        <div className="rules-table-wrap">
          <table className="rules-table records-table history-responsive-table history-title-table">
            <thead>
              <tr>
                <th>Franchise</th>
                <th className="records-num">Titles</th>
                <th className="records-num">Runner-up</th>
                <th className="records-num">Finals</th>
                <th className="records-num">Last championship</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.franchiseId}>
                  <td>
                    {row.name}
                    {row.active ? '' : '*'}
                  </td>
                  <td className="records-num">{row.titles}</td>
                  <td className="records-num">{row.runnerUps}</td>
                  <td className="records-num">{row.titles + row.runnerUps}</td>
                  <td className="records-num">
                    {row.lastTitleSeason === null ? '—' : (seasonEndYear.get(row.lastTitleSeason) ?? row.lastTitleSeason)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="records-caption">
          * No longer in the league. A franchise keeps its record when the owner changes. Finals
          means titles plus runner-up finishes.
        </p>
      </section>

      <section className="panel history-panel">
        <div className="hub-heading history-heading">{(category?.label ?? 'RECORDS').toUpperCase()}</div>
        <p className="records-caption">
          {category?.criteria}. {category?.basisNote}
        </p>
        <div className="rules-table-wrap">
          <table className="rules-table records-table history-responsive-table history-record-table">
            <thead>
              <tr>
                <SortHeader label="#" columnKey="rank" sort={sort} onSort={onSort} />
                <SortHeader label="Owner" columnKey="owner" sort={sort} onSort={onSort} />
                <SortHeader label="Season" columnKey="season" sort={sort} onSort={onSort} />
                <SortHeader label="Week" columnKey="period" sort={sort} onSort={onSort} />
                <SortHeader label="Points" columnKey="value" sort={sort} onSort={onSort} numeric />
                <th className="history-record-secondary">Basis</th>
                <SortHeader label="Source" columnKey="source" sort={sort} onSort={onSort} className="history-record-secondary" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.rank}</td>
                  <td>
                    {entry.ownerName}
                    {entry.franchiseId && franchises.get(entry.franchiseId)?.active === false ? '*' : ''}
                    <details className="history-record-detail">
                      <summary>Details</summary>
                      <div>Opponent: {entry.opponentName ?? 'unknown'}</div>
                      <div>Basis: {entry.basis}</div>
                      <div>Source: {SOURCE_LABEL[entry.source.provenance] ?? entry.source.provenance}</div>
                      <div>{entry.source.reference}</div>
                    </details>
                  </td>
                  <td>{seasonLabel.get(entry.seasonNumber) ?? entry.seasonNumber}</td>
                  <td>{entry.period ?? 'unknown'}</td>
                  <td className="records-num">{entry.value.toFixed(1)}</td>
                  <td className="history-record-secondary">{entry.basis}</td>
                  <td className="history-record-secondary">{SOURCE_LABEL[entry.source.provenance] ?? entry.source.provenance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {flags.length > 0 && (
        <section className="panel history-panel">
          <div className="hub-heading history-heading">HOW SOLID IS THIS</div>
          <ul className="history-flags">
            {flags.map((flag) => (
              <li key={flag.id}>{flag.message}</li>
            ))}
          </ul>
        </section>
      )}

      {versions.length > 0 && (
        <section className="panel history-panel">
          <div className="hub-heading history-heading">REVISIONS</div>
          <ul className="history-revisions">
            {versions.map((version) => (
              <li key={version.id}>
                <span className="history-revision-number">r{version.revision}</span>{' '}
                {new Date(version.publishedAt).toLocaleDateString()} · {version.publishedBy}
                <div className="history-source">{version.reason || version.notes}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
