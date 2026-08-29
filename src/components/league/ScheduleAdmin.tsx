import { useMemo, useState } from 'react';
import {
  leagueSchedule2027,
  scheduleSnapshot2027,
  teamScheduleSummaries2027,
} from '../../lib/league/scheduleData.js';
import { NBA_TEAMS, type LeagueSchedulePeriod } from '../../lib/league/schedule.js';

type View = 'periods' | 'postseason';

const teams = [...NBA_TEAMS].sort((a, b) => a.code.localeCompare(b.code));

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
  const [view, setView] = useState<View>('periods');
  const summaryByTeamId = useMemo(
    () => new Map(teamScheduleSummaries2027.map((summary) => [summary.teamId, summary])),
    [],
  );

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
        Provisional snapshot · captured {formatDate(scheduleSnapshot2027.capturedAt.slice(0, 10))} · NBA weeks 24–25 kept for audit but excluded
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
              {leagueSchedule2027.map((period) => {
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
