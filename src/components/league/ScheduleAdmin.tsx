import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import rawSchedule from '../../data/source/basketball-monster-schedule-2027.json';
import {
  DEFAULT_2027_LEAGUE_MAPPING,
  NBA_TEAMS,
  summarizeAllTeamSchedules,
  type LeagueScheduleMapping,
  type LeagueSchedulePeriod,
  type RawScheduleSource,
} from '../../lib/league/schedule.js';
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

type View = 'periods' | 'postseason';

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

function phaseColor(period: LeagueSchedulePeriod): string {
  if (period.combinesAllStarBreak) return 'var(--neon-yellow)';
  if (period.phase === 'fantasy-play-in') return 'var(--neon-purple)';
  if (period.phase === 'fantasy-playoff') return 'var(--neon-orange)';
  return 'var(--text-mid)';
}

const cellStyle = {
  borderBottom: '1px solid var(--panel-border)',
  padding: '5px 7px',
  textAlign: 'right' as const,
};

export default function ScheduleAdmin() {
  const { identity } = useIdentity();
  const { state } = useLeagueState();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('periods');
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
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-orange)', marginBottom: 6 }}>
        2027 SCHEDULE GRID
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
              minHeight: 38,
              padding: '0 12px',
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

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        {view === 'periods' ? (
          <table style={{ borderCollapse: 'collapse', minWidth: 1260, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--panel-bg)', zIndex: 2 }}>PERIOD</th>
                <th style={{ ...cellStyle, textAlign: 'left' }}>DATES</th>
                <th style={{ ...cellStyle, textAlign: 'left' }}>NBA WK</th>
                {teams.map((team) => <th key={team.espnId} style={cellStyle}>{team.code}</th>)}
                <th style={cellStyle}>TEAM-GAMES</th>
                <th style={cellStyle}>AVG</th>
              </tr>
            </thead>
            <tbody>
              {leaguePeriods.map((period) => {
                const total = Object.values(period.gamesByTeamId).reduce((sum, games) => sum + games, 0);
                return (
                  <tr key={period.leagueWeek}>
                    <td
                      style={{
                        ...cellStyle,
                        textAlign: 'left',
                        color: phaseColor(period),
                        fontWeight: 800,
                        position: 'sticky',
                        left: 0,
                        background: 'var(--panel-bg)',
                      }}
                    >
                      {period.label}{period.combinesAllStarBreak ? ' ★' : ''}
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-mid)' }}>{dateRange(period)}</td>
                    <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-dim)' }}>{period.sourceNbaWeeks.join('+')}</td>
                    {teams.map((team) => (
                      <td key={team.espnId} style={{ ...cellStyle, color: 'var(--text-hi)' }}>
                        {period.gamesByTeamId[team.espnId]}
                      </td>
                    ))}
                    <td style={{ ...cellStyle, color: 'var(--text-mid)', fontWeight: 700 }}>{total}</td>
                    <td style={{ ...cellStyle, color: 'var(--text-mid)' }}>{(total / 30).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                {['TEAM', 'PI 1', 'PI 2', 'PI TOTAL', 'R1 W1', 'R1 W2', 'R1 TOTAL', 'R2 W1', 'R2 W2', 'R2 TOTAL', 'PLAYOFF', 'POSTSEASON'].map((label, index) => (
                  <th key={label} style={{ ...cellStyle, textAlign: index === 0 ? 'left' : 'right' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const summary = summaryByTeamId.get(team.espnId);
                if (!summary) return null;
                return (
                  <tr key={team.espnId}>
                    <td style={{ ...cellStyle, textAlign: 'left', color: 'var(--neon-orange)', fontWeight: 800 }}>{team.code}</td>
                    <td style={cellStyle}>{summary.playIn.byLeagueWeek[17]}</td>
                    <td style={cellStyle}>{summary.playIn.byLeagueWeek[18]}</td>
                    <td style={{ ...cellStyle, color: 'var(--neon-purple)', fontWeight: 800 }}>{summary.playIn.total}</td>
                    <td style={cellStyle}>{summary.playoffs.byLeagueWeek[19]}</td>
                    <td style={cellStyle}>{summary.playoffs.byLeagueWeek[20]}</td>
                    <td style={{ ...cellStyle, fontWeight: 800 }}>{summary.playoffs.round1}</td>
                    <td style={cellStyle}>{summary.playoffs.byLeagueWeek[21]}</td>
                    <td style={cellStyle}>{summary.playoffs.byLeagueWeek[22]}</td>
                    <td style={{ ...cellStyle, fontWeight: 800 }}>{summary.playoffs.round2}</td>
                    <td style={{ ...cellStyle, color: 'var(--neon-orange)', fontWeight: 800 }}>{summary.playoffs.total}</td>
                    <td style={{ ...cellStyle, color: 'var(--neon-yellow)', fontWeight: 800 }}>{summary.postseasonTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 9, color: 'var(--text-dim)', fontSize: '0.68rem' }}>
        ★ Long ESPN period. A later refresh must create and accept a new snapshot after the NBA Cup schedule settles.
      </div>
    </section>
  );
}
