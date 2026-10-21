import { useState } from 'react';
import { fppgText, lineupFppg } from '../../lib/league/lineupFppg.js';
import { shortDate, type ScoreSide, type ScoresWeek } from '../../lib/league/scores.js';

export function FppgLabel({ side, period }: { side: ScoreSide; period?: number }) {
  const value = lineupFppg(side, period);
  return <div className="lineup-fppg"><strong>{fppgText(value.average)} FPPG</strong> · {value.games} GP
    {period !== undefined && <> · {value.points.toFixed(1)} pts</>}{value.live ? ' · live' : ''}</div>;
}

function DailySparkline({ daily, dates }: { daily: Array<number | null>; dates: string[] }) {
  const values = daily.filter((value): value is number => value !== null);
  if (!values.length) return <span aria-label="No games played">—</span>;
  const low = Math.min(...values), high = Math.max(...values);
  const x = (index: number) => 5 + index * 110 / Math.max(1, dates.length - 1);
  const y = (value: number) => high === low ? 18 : 30 - (value - low) / (high - low) * 24;
  const points = daily.flatMap((value, index) => value === null ? [] : [`${x(index)},${y(value)}`]).join(' ');
  return <svg className="fppg-sparkline" viewBox="0 0 120 36" width="120" height="36" role="img"
    aria-label={`Daily FPPG: ${daily.map((value, index) => `${shortDate(dates[index])}: ${fppgText(value)}`).join(', ')}`}>
    <title>{daily.map((value, index) => `${shortDate(dates[index])}: ${fppgText(value)}`).join(' · ')}</title>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    {daily.map((value, index) => value === null ? null : <circle key={dates[index]} cx={x(index)} cy={y(value)} r="2.5" fill="currentColor" />)}
  </svg>;
}

export default function LineupFppg({ week }: { week: ScoresWeek }) {
  const [sort, setSort] = useState('week');
  const [ascending, setAscending] = useState(false);
  const days = week.days.filter(day => day.scoringPeriodId <= week.currentScoringPeriodId);
  const teams = week.matchups.flatMap(matchup => [matchup.home, matchup.away]);
  const value = (side: ScoreSide) => lineupFppg(side, sort === 'week' ? undefined : Number(sort)).average;
  teams.sort((a, b) => {
    const av = value(a), bv = value(b);
    return av === null ? (bv === null ? 0 : 1) : bv === null ? -1 : (av - bv) * (ascending ? 1 : -1);
  });
  const heading = (key: string, label: string) => <button type="button" onClick={() => {
    if (sort === key) setAscending(!ascending);
    else { setSort(key); setAscending(false); }
  }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button>;

  return <section className="panel fppg-panel"><h2>Weekly PPG · Week {week.matchupPeriodId}</h2>
    <p>Fantasy points per game (FPPG): starter points ÷ player-games played (GP). Daily columns show each date’s average. Includes live games; excludes bench and DNPs. Before overage deductions. Tap a column to sort.</p>
    <div className="fppg-scroll"><table><thead><tr><th>Team</th>
      {days.map(day => <th key={day.scoringPeriodId}>{heading(String(day.scoringPeriodId), shortDate(day.date))}</th>)}
      <th>{heading('week', 'Week FPPG')}</th><th>GP</th><th>Daily trend</th></tr></thead>
      <tbody>{teams.map(side => {
        const daily = days.map(day => lineupFppg(side, day.scoringPeriodId).average);
        const weekly = lineupFppg(side);
        return <tr key={side.teamId}><th>{side.name}</th>
          {daily.map((average, index) => <td key={days[index].scoringPeriodId}>{fppgText(average)}</td>)}
          <td><strong>{fppgText(weekly.average)}</strong></td><td>{weekly.games}</td>
          <td><DailySparkline daily={daily} dates={days.map(day => day.date)} /></td></tr>;
      })}</tbody></table></div></section>;
}
