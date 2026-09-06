import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import rawSchedule from '../../data/source/basketball-monster-schedule-2027.json';
import {
  DEFAULT_2027_LEAGUE_MAPPING,
  NBA_TEAMS,
  buildScheduleTrend,
  summarizeAllTeamSchedules,
  type LeagueScheduleMapping,
  type LeagueSchedulePeriod,
  type RawScheduleSource,
} from '../../lib/league/schedule.js';
import ScheduleTrendChart from './ScheduleTrendChart.js';
import {
  leagueSchedule2027,
  scheduleSnapshot2027,
} from '../../lib/league/scheduleData.js';
import {
  acceptSchedule,
  apiErrorMessage,
  fetchSchedule,
  previewSchedule,
  sandboxActive,
  type ScheduleCandidateInput,
  type SchedulePreviewResponse,
} from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import {
  ariaSortValue,
  gameCountHeat,
  nextSortLabel,
  relativeScheduleHeat,
  scheduleHeatLabel,
  shortPeriodLabel,
  sortDirectionLabel,
  sortRowsByNumber,
  toggleColumnSort,
  type ColumnSort,
  type SortDirection,
} from './scheduleUi.js';

type View = 'periods' | 'postseason';
/** The grid sorts on an NBA team ID, or on the average games column. */
type PeriodSortKey = number | 'average';

const POSTSEASON_HEADERS = [
  'PI 1',
  'PI 2',
  'PI TOTAL',
  'R1 W1',
  'R1 W2',
  'R1 TOTAL',
  'R2 W1',
  'R2 W2',
  'R2 TOTAL',
  'PLAYOFF',
  'POSTSEASON',
] as const;

const teams = [...NBA_TEAMS].sort((a, b) => a.code.localeCompare(b.code));
const COMMITTED_CANDIDATE: ScheduleCandidateInput = {
  source: rawSchedule as RawScheduleSource,
  mapping: DEFAULT_2027_LEAGUE_MAPPING.map((entry): LeagueScheduleMapping => ({
    ...entry,
    sourceNbaWeeks: [...entry.sourceNbaWeeks],
  })),
  status: 'provisional',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  );
}

function dateRange(period: LeagueSchedulePeriod): string {
  return `${formatDate(period.startDate)}–${formatDate(period.endDate)}`;
}

/** Drops the repeated month, because the phone period cell has no room for it. */
function compactDateRange(period: LeagueSchedulePeriod): string {
  const start = formatDate(period.startDate);
  const end = formatDate(period.endDate);
  if (period.startDate.slice(0, 7) !== period.endDate.slice(0, 7)) return `${start}–${end}`;
  return `${start}–${end.replace(/^\D+/, '')}`;
}

function phaseColor(period: LeagueSchedulePeriod): string {
  if (period.combinesAllStarBreak) return 'var(--neon-yellow)';
  if (period.phase === 'fantasy-play-in') return 'var(--neon-purple)';
  if (period.phase === 'fantasy-playoff') return 'var(--neon-orange)';
  return 'var(--text-mid)';
}

interface SortHeaderProps {
  /** Full header text. Screen readers always get this one. */
  long: string;
  /** Narrow stand-in shown on a phone. Leave it out to keep the full text. */
  short?: string;
  direction: SortDirection | null;
  onSort: () => void;
  className?: string;
}

/** A tap-to-sort column header. The whole cell is the target, so it clears 44px. */
function SortHeader({ long, short, direction, onSort, className }: SortHeaderProps) {
  const caret = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '';
  return (
    <th
      scope="col"
      aria-sort={ariaSortValue(direction)}
      className={['schedule-sort-head', className, direction ? 'schedule-col-active' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className="schedule-sort-btn"
        type="button"
        onClick={onSort}
        aria-label={`${long}: ${nextSortLabel(direction)}`}
      >
        <span className={short ? 'schedule-head-long' : undefined}>{long}</span>
        {short && <span className="schedule-head-short" aria-hidden="true">{short}</span>}
        {caret && <span className="schedule-sort-caret" aria-hidden="true">{caret}</span>}
      </button>
    </th>
  );
}

export default function ScheduleAdmin() {
  const { identity } = useIdentity();
  const { state } = useLeagueState();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('periods');
  // Grid sort keys on the NBA team id; the postseason table sorts on a column index.
  const [periodSort, setPeriodSort] = useState<ColumnSort<PeriodSortKey> | null>(null);
  const [summarySort, setSummarySort] = useState<ColumnSort<number> | null>(null);
  const [preview, setPreview] = useState<SchedulePreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentQuery = useQuery({
    queryKey: [
      'admin-schedule',
      state.schedule?.activeSnapshotId ?? 'schedule-fixture-2027',
    ],
    queryFn: () => fetchSchedule(identity!),
    enabled: identity?.isCommissioner === true,
    staleTime: 30_000,
  });
  const current = currentQuery.data?.snapshot;
  const leaguePeriods = current?.leaguePeriods ?? leagueSchedule2027;
  const teamScheduleSummaries = useMemo(
    () => summarizeAllTeamSchedules(leaguePeriods),
    [leaguePeriods],
  );
  const summaryByTeamId = useMemo(
    () => new Map(teamScheduleSummaries.map((summary) => [summary.teamId, summary])),
    [teamScheduleSummaries],
  );
  const periodRows = useMemo(
    () => leaguePeriods.map((period) => ({
      period,
      total: Object.values(period.gamesByTeamId).reduce((sum, games) => sum + games, 0),
    })),
    [leaguePeriods],
  );
  // The colour scale reads every total, so it holds whatever order the rows are in.
  const periodTotals = useMemo(() => periodRows.map((row) => row.total), [periodRows]);
  const sortedPeriodRows = useMemo(
    () => {
      if (!periodSort) return periodRows;
      const key = periodSort.key;
      return sortRowsByNumber(
        periodRows,
        // The average is the total over 30 teams, so both sort the same way.
        (row) => (key === 'average' ? row.total : row.period.gamesByTeamId[key]),
        periodSort.direction,
      );
    },
    [periodRows, periodSort],
  );
  const sortedTeamId = periodSort && typeof periodSort.key === 'number' ? periodSort.key : null;
  const sortedTeamCode = sortedTeamId === null
    ? null
    : teams.find((team) => team.espnId === sortedTeamId)?.code ?? null;
  // The chart follows the grid: a sorted team, or the league otherwise.
  const trend = useMemo(
    () => buildScheduleTrend(leaguePeriods, sortedTeamCode ? sortedTeamId : null),
    [leaguePeriods, sortedTeamCode, sortedTeamId],
  );
  const postseasonRows = useMemo(
    () => teams.flatMap((team) => {
      const summary = summaryByTeamId.get(team.espnId);
      if (!summary) return [];
      return [{
        team,
        values: [
          summary.playIn.byLeagueWeek[17],
          summary.playIn.byLeagueWeek[18],
          summary.playIn.total,
          summary.playoffs.byLeagueWeek[19],
          summary.playoffs.byLeagueWeek[20],
          summary.playoffs.round1,
          summary.playoffs.byLeagueWeek[21],
          summary.playoffs.byLeagueWeek[22],
          summary.playoffs.round2,
          summary.playoffs.total,
          summary.postseasonTotal,
        ],
      }];
    }),
    [summaryByTeamId],
  );
  const postseasonColumns = useMemo(
    () => POSTSEASON_HEADERS.map((_, column) => postseasonRows.map((row) => row.values[column])),
    [postseasonRows],
  );
  const sortedPostseasonRows = useMemo(
    () => (summarySort
      ? sortRowsByNumber(postseasonRows, (row) => row.values[summarySort.key], summarySort.direction)
      : postseasonRows),
    [postseasonRows, summarySort],
  );
  const draftStarted = state.draft.startedAt !== null;
  const inSandbox = sandboxActive();
  const disabled = busy || draftStarted || inSandbox;

  if (!identity?.isCommissioner) return null;

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setArmed(false);
    try {
      setPreview(await previewSchedule(identity, COMMITTED_CANDIDATE));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptSchedule(identity, COMMITTED_CANDIDATE, preview);
      applyState(accepted);
      setPreview(null);
      setArmed(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-schedule'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel schedule-workspace">
      {/* The grid comes first on a phone, so the snapshot controls sit in their own block. */}
      <div className="schedule-snapshot-admin">
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-orange)', marginBottom: 6 }}>
          2027 SNAPSHOT
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: '0.74rem', lineHeight: 1.45 }}>
          The first 23 of 25 NBA calendar weeks form 22 league periods. The current fantasy mapping
          ends March 28, and Play-In 2 combines February 15–28 across the All-Star break.
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: 6 }}>
          {(current?.status ?? scheduleSnapshot2027.status) === 'final' ? 'Final' : 'Provisional'} snapshot · captured{' '}
          {formatDate((current?.capturedAt ?? scheduleSnapshot2027.capturedAt).slice(0, 10))} · NBA weeks 24–25 kept for audit but excluded
        </div>

        {currentQuery.isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 10 }}>
            Loading live schedule…
          </div>
        ) : current ? (
          <div
            style={{
              padding: 10,
              border: '1px solid var(--panel-border)',
              borderRadius: 8,
              background: 'var(--input-bg)',
              fontSize: '0.72rem',
              marginTop: 10,
            }}
          >
            <div style={{ color: 'var(--text-hi)', fontWeight: 800 }}>
              {currentQuery.data?.fallback ? 'Committed fallback' : 'Accepted live snapshot'}
            </div>
            <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>
              {current.id} · accepted by {current.createdBy}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem', marginTop: 10 }}>
            {apiErrorMessage(currentQuery.error)}
          </div>
        )}

        {draftStarted && (
          <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
            The draft has started. The live schedule is locked.
          </div>
        )}
        {inSandbox && (
          <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
            Exit test mode before changing the live schedule.
          </div>
        )}
        {error && (
          <div role="alert" style={{ color: 'var(--neon-red)', fontSize: '0.78rem', marginTop: 10 }}>
            ⚠ {error}
          </div>
        )}

        <button
          className="tap-btn"
          type="button"
          disabled={disabled}
          onClick={runPreview}
          style={{
            minHeight: 44,
            marginTop: 12,
            padding: '0 16px',
            borderRadius: 8,
            border: '2px solid var(--neon-orange)',
            background: 'rgba(255,126,0,0.08)',
            color: 'var(--neon-orange)',
            fontWeight: 800,
          }}
        >
          {busy ? 'WORKING…' : 'PREVIEW COMMITTED 2027 SNAPSHOT'}
        </button>

        {preview && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {[
                ['TEAM-WEEK CHANGES', preview.preview.changedTeamPeriods.length, 'var(--neon-yellow)'],
                ['MAPPING CHANGES', preview.preview.changedMappings.length, 'var(--neon-purple)'],
              ].map(([label, count, color]) => (
                <span
                  key={String(label)}
                  style={{
                    padding: '4px 8px',
                    border: `1px solid ${color}`,
                    borderRadius: 999,
                    color: String(color),
                    fontSize: '0.65rem',
                    fontWeight: 800,
                  }}
                >
                  {label} {count}
                </span>
              ))}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: 9 }}>
              Candidate {preview.candidateSnapshotId}
            </div>
            {preview.candidateSnapshotId === preview.currentSnapshotId && (
              <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', marginTop: 7 }}>
                This exact snapshot is already live.
              </div>
            )}

            {preview.candidateSnapshotId !== preview.currentSnapshotId && (!armed ? (
              <button
                className="tap-btn"
                type="button"
                disabled={disabled}
                onClick={() => setArmed(true)}
                style={{
                  minHeight: 44,
                  marginTop: 12,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: '2px solid var(--neon-teal)',
                  background: 'transparent',
                  color: 'var(--neon-teal)',
                  fontWeight: 800,
                }}
              >
                ACCEPT THIS SNAPSHOT
              </button>
            ) : (
              <button
                className="tap-btn"
                type="button"
                disabled={disabled}
                onClick={accept}
                style={{
                  minHeight: 44,
                  marginTop: 12,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: '2px solid var(--neon-yellow)',
                  background: 'rgba(255,230,0,0.1)',
                  color: 'var(--neon-yellow)',
                  fontWeight: 800,
                }}
              >
                CONFIRM: MAKE THIS THE LIVE SCHEDULE
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="schedule-grid-block">
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-orange)', marginBottom: 6 }}>
          2027 SCHEDULE GRID
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {([
            ['periods', 'LEAGUE PERIODS'],
            ['postseason', 'POSTSEASON TOTALS'],
          ] as const).map(([key, label]) => (
            <button
              className="tap-btn"
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              style={{
                minHeight: 44,
                padding: '0 14px',
                borderRadius: 999,
                border: `2px solid ${view === key ? 'var(--neon-orange)' : 'var(--panel-border)'}`,
                background: view === key ? 'rgba(255,126,0,0.1)' : 'transparent',
                color: view === key ? 'var(--neon-orange)' : 'var(--text-mid)',
                fontWeight: 800,
                fontSize: '0.68rem',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="schedule-sort-bar" aria-live="polite">
          {view === 'periods' ? (
            periodSort ? (
              <>
                <span className="schedule-sort-state">
                  Sorted by <b>{sortedTeamCode ?? 'AVG'}</b>, {sortDirectionLabel(periodSort.direction)}
                </span>
                <button
                  className="tap-btn schedule-sort-reset"
                  type="button"
                  onClick={() => setPeriodSort(null)}
                >
                  SCHEDULE ORDER
                </button>
              </>
            ) : (
              <span className="schedule-sort-hint">
                In schedule order. Tap a team code or AVG to sort it.
              </span>
            )
          ) : summarySort ? (
            <>
              <span className="schedule-sort-state">
                Sorted by <b>{POSTSEASON_HEADERS[summarySort.key]}</b>, {sortDirectionLabel(summarySort.direction)}
              </span>
              <button
                className="tap-btn schedule-sort-reset"
                type="button"
                onClick={() => setSummarySort(null)}
              >
                TEAM ORDER
              </button>
            </>
          ) : (
            <span className="schedule-sort-hint">
              In team order. Tap a column to sort it.
            </span>
          )}
        </div>

        {view === 'periods' && (
          <ScheduleTrendChart
            trend={trend}
            subject={sortedTeamCode ?? 'LEAGUE AVERAGE'}
          />
        )}

        <div className="schedule-table-scroll" role="region" aria-label={view === 'periods' ? 'League schedule by period' : 'Postseason schedule totals'} tabIndex={0}>
          {view === 'periods' ? (
            <table className="schedule-grid-table">
              <thead>
                <tr>
                  <SortHeader
                    className="schedule-sticky-corner"
                    long="PERIOD"
                    direction={periodSort ? null : 'asc'}
                    onSort={() => setPeriodSort(null)}
                  />
                  <th className="schedule-date-head" scope="col">DATES</th>
                  <th className="schedule-source-head" scope="col">NBA WK</th>
                  {teams.map((team) => (
                    <SortHeader
                      key={team.espnId}
                      className="schedule-team-head"
                      long={team.code}
                      direction={periodSort?.key === team.espnId ? periodSort.direction : null}
                      onSort={() => setPeriodSort((current) => toggleColumnSort(current, team.espnId))}
                    />
                  ))}
                  <th className="schedule-total-head" scope="col">
                    <span className="schedule-head-long">TEAM-GAMES</span>
                    <span className="schedule-head-short" aria-hidden="true">TOT</span>
                  </th>
                  <SortHeader
                    className="schedule-total-head"
                    long="AVG"
                    direction={periodSort?.key === 'average' ? periodSort.direction : null}
                    onSort={() => setPeriodSort((current) => toggleColumnSort(current, 'average'))}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedPeriodRows.map(({ period, total }) => {
                  const totalHeat = relativeScheduleHeat(total, periodTotals);
                  // Phase rules only read as rules while the rows sit in schedule order.
                  const breakClass = periodSort ? '' : [
                    period.leagueWeek === 17 || period.leagueWeek === 19 || period.leagueWeek === 21 ? 'schedule-period-break' : '',
                    period.leagueWeek === 17 ? 'schedule-period-play-in' : '',
                    period.leagueWeek === 19 || period.leagueWeek === 21 ? 'schedule-period-playoff' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={period.leagueWeek} className={breakClass || undefined}>
                      <td className="schedule-sticky-period" style={{ color: phaseColor(period) }}>
                        <span className="schedule-period-long">
                          {period.label}{period.combinesAllStarBreak ? ' ★' : ''}
                        </span>
                        <span className="schedule-period-short" aria-hidden="true">
                          {shortPeriodLabel(period.label)}{period.combinesAllStarBreak ? ' ★' : ''}
                        </span>
                        <span className="schedule-period-meta">
                          {compactDateRange(period)}
                        </span>
                      </td>
                      <td className="schedule-date-cell">{dateRange(period)}</td>
                      <td className="schedule-source-cell">{period.sourceNbaWeeks.join('+')}</td>
                      {teams.map((team) => {
                        const games = period.gamesByTeamId[team.espnId];
                        const heat = gameCountHeat(games);
                        return (
                          <td
                            key={team.espnId}
                            className={`schedule-game-cell schedule-heat-${heat}`}
                            aria-label={`${team.code}, ${period.label}: ${games} games, ${scheduleHeatLabel(heat)}`}
                            title={`${team.code}: ${games} games`}
                          >
                            {games}
                          </td>
                        );
                      })}
                      <td className={`schedule-total-cell schedule-heat-${totalHeat}`} aria-label={`${total} total team-games, ${scheduleHeatLabel(totalHeat)}`}>
                        {total}
                      </td>
                      <td className={`schedule-total-cell schedule-heat-${totalHeat}`}>{(total / 30).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="schedule-summary-table">
              <thead>
                <tr>
                  <SortHeader
                    className="schedule-sticky-corner"
                    long="TEAM"
                    direction={summarySort ? null : 'asc'}
                    onSort={() => setSummarySort(null)}
                  />
                  {POSTSEASON_HEADERS.map((label, column) => (
                    <SortHeader
                      key={label}
                      long={label}
                      direction={summarySort?.key === column ? summarySort.direction : null}
                      onSort={() => setSummarySort((current) => toggleColumnSort(current, column))}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPostseasonRows.map((row) => (
                  <tr key={row.team.espnId}>
                    <td className="schedule-sticky-team">{row.team.code}</td>
                    {row.values.map((value, column) => {
                      const heat = relativeScheduleHeat(value, postseasonColumns[column]);
                      return (
                        <td
                          key={POSTSEASON_HEADERS[column]}
                          className={`schedule-summary-cell schedule-heat-${heat}`}
                          aria-label={`${row.team.code} ${POSTSEASON_HEADERS[column]}: ${value}, ${scheduleHeatLabel(heat)}`}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="schedule-scroll-hint">
          Swipe the grid sideways for the rest of the {view === 'periods' ? 'teams' : 'columns'}.
        </p>

        <div style={{ marginTop: 9, color: 'var(--text-dim)', fontSize: '0.68rem' }}>
          ★ Long ESPN period. A later refresh must create and accept a new snapshot after the NBA Cup schedule settles.
        </div>
      </div>
    </section>
  );
}
