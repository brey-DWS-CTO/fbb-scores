import { useState } from 'react';
import { fppgText, lineupFppg, sortLineupFppg } from '../../lib/league/lineupFppg.js';
import { shortDate, type ScoreSide, type ScoresWeek } from '../../lib/league/scores.js';
import { gamesCapStatus, lineupGames } from '../../lib/league/lineupGames.js';

/** With `week`, GP reads played/projected, the projection coloured by where it lands against the cap. */
export function FppgLabel({ side, period, week }: { side: ScoreSide; period?: number; week?: ScoresWeek }) {
  const value = lineupFppg(side, period);
  const games = week ? lineupGames(side, week) : null;
  const tone = !games || games.difference === null ? '' : games.difference > 0 ? ' is-over' : games.difference < 0 ? ' is-under' : ' is-at';
  return <div className="lineup-fppg"><strong>{fppgText(value.average)} FPPG</strong> · {value.games}
    {games && <>/<span className={`fppg-proj${tone}`} title={`${games.estimated ? 'Estimated' : 'Projected'} ${games.projected} of ${games.cap ?? '?'} games. ${gamesCapStatus(games)}.`}>{games.estimated ? '~' : ''}{games.projected}</span></>} GP
    {period !== undefined && <> · {value.points.toFixed(1)} pts</>}{value.live ? <span className="fppg-live" role="img" aria-label="live" /> : null}</div>;
}

function DailySparkline({ daily, dates }: { daily: Array<number | null>; dates: string[] }) {
  const values = daily.filter((value): value is number => value !== null);
  if (!values.length) return <span aria-label="No games played">—</span>;
  const low = Math.min(...values), high = Math.max(...values);
  const x = (index: number) => 5 + index * 110 / Math.max(1, dates.length - 1);
  const y = (value: number) => high === low ? 18 : 30 - (value - low) / (high - low) * 24;
  const points = daily.flatMap((value, index) => value === null ? [] : [`${x(index)},${y(value)}`]).join(' ');
  return <svg className="fppg-sparkline" viewBox="0 0 120 36" width="96" height="24" role="img"
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
  const teams = sortLineupFppg(week.matchups.flatMap(matchup => [matchup.home, matchup.away]), sort, ascending, days.map(day => day.scoringPeriodId));
  const heading = (key: string, label: string) => <th key={key} scope="col" aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : 'none'}>
    <button type="button" onClick={() => {
      if (sort === key) setAscending(!ascending);
      else { setSort(key); setAscending(key === 'team'); }
    }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button>
  </th>;

  return <section className="panel fppg-panel"><h2>Weekly PPG · Week {week.matchupPeriodId}</h2>
    <div className="fppg-help">FPPG = starter points ÷ GP. Tap headers to sort. <details><summary>How it’s counted</summary>Daily columns show each date’s average. Includes live games; excludes bench and DNPs. Before overage deductions. Trend sorts by the change from the first played day to the latest.</details></div>
    <div className="fppg-scroll"><table><thead><tr>{heading('team', 'Team')}
      {heading('week', 'Week FPPG')}{heading('gp', 'GP')}
      {days.map(day => heading(String(day.scoringPeriodId), shortDate(day.date)))}
      {heading('trend', 'Daily trend')}</tr></thead>
      <tbody>{teams.map(side => {
        const daily = days.map(day => lineupFppg(side, day.scoringPeriodId).average);
        const weekly = lineupFppg(side);
        return <tr key={side.teamId}><th scope="row">{side.name}</th>
          <td><strong>{fppgText(weekly.average)}</strong></td><td>{weekly.games}</td>
          {daily.map((average, index) => <td key={days[index].scoringPeriodId}>{fppgText(average)}</td>)}
          <td><DailySparkline daily={daily} dates={days.map(day => day.date)} /></td></tr>;
      })}</tbody></table></div></section>;
}
