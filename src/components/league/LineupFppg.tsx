import { useState } from 'react';
import { fppgText, lineupFppg } from '../../lib/league/lineupFppg.js';
import type { ScoreSide, ScoresWeek } from '../../lib/league/scores.js';
export function FppgLabel({ side, period }: { side: ScoreSide; period?: number }) {
  const v = lineupFppg(side, period);
  return <div className="lineup-fppg"><strong>{fppgText(v.average)} FPPG</strong> · {v.games} GP{period !== undefined && <> · {v.points.toFixed(1)} pts</>}{v.live ? ' · live' : ''}</div>;
}
export default function LineupFppg({ week }: { week: ScoresWeek }) {
  const [sort, setSort] = useState('week');
  const [asc, setAsc] = useState(false);
  const days = week.days.filter(d => d.scoringPeriodId <= week.currentScoringPeriodId);
  const teams = week.matchups.flatMap(m => [m.home, m.away]);
  const value = (s: ScoreSide) => lineupFppg(s, sort === 'week' ? undefined : Number(sort)).average;
  teams.sort((a,b) => { const av=value(a), bv=value(b); return av === null ? (bv === null ? 0 : 1) : bv === null ? -1 : (av-bv)*(asc ? 1 : -1); });
  const heading = (key: string, label: string) => <button type="button" onClick={() => { if(sort === key) setAsc(!asc); else {setSort(key);setAsc(false);} }}>{label}{sort === key ? asc ? ' ↑' : ' ↓' : ''}</button>;
  return <section className="panel fppg-panel"><h2>Lineup FPPG · Week {week.matchupPeriodId}</h2><p>Starter points ÷ player-games played. Includes live games; excludes bench and DNPs. Before overage deductions. Tap a column to sort.</p>
    <div className="fppg-scroll"><table><thead><tr><th>Team</th>{days.map(d => <th key={d.scoringPeriodId}>{heading(String(d.scoringPeriodId), d.date.slice(5))}</th>)}<th>{heading('week', 'Week FPPG')}</th><th>GP</th><th>Daily trend</th></tr></thead><tbody>
    {teams.map(s => { const daily = days.map(d => lineupFppg(s,d.scoringPeriodId).average); const vals=daily.filter((v): v is number => v !== null); const lo=Math.min(...vals), hi=Math.max(...vals); const x=(i:number)=>5+i*90/Math.max(1,days.length-1); const y=(v:number)=>30-(v-lo)/Math.max(1,hi-lo)*24;
    return <tr key={s.teamId}><th>{s.name}</th>{daily.map((v,i)=><td key={days[i].scoringPeriodId}>{fppgText(v)}</td>)}<td><strong>{fppgText(lineupFppg(s).average)}</strong></td><td>{lineupFppg(s).games}</td><td><svg width="100" height="36" role="img" aria-label={`Daily FPPG: ${daily.map(fppgText).join(', ')}`}>
    {daily.map((v,i)=>v === null ? null : <g key={i}><title>{days[i].date}: {fppgText(v)} FPPG</title>{i>0 && daily[i-1] !== null && <line x1={x(i-1)} y1={y(daily[i-1]!)} x2={x(i)} y2={y(v)} stroke="currentColor" />}<circle cx={x(i)} cy={y(v)} r="3" fill="currentColor" /></g>)}</svg></td></tr>; })}</tbody></table></div></section>;
}
