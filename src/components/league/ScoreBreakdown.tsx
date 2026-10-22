import { Fragment, useRef, useState } from 'react';
import type { ScorePlayer, ScoresWeek } from '../../lib/league/scores.js';
const names: Record<number,string> = {0:'Points',1:'Blocks',2:'Steals',3:'Assists',6:'Rebounds',11:'Turnovers',13:'Field goals made',14:'Field goals attempted',15:'Free throws made',16:'Free throws attempted',17:'Three pointers made',18:'Three pointers attempted',23:'Field goals missed',24:'Free throws missed',37:'Double doubles',38:'Triple doubles',39:'Quadruple doubles'};
// Keep made/missed shooting pairs and double-double bonuses together.
const statOrder = [0, 13, 23, 14, 17, 18, 15, 24, 16, 6, 3, 2, 1, 11, 37, 38, 39];
const statRank = new Map(statOrder.map((id, index) => [id, index]));
export default function ScoreBreakdown({player,week,period,total}: {player:ScorePlayer;week:ScoresWeek;period?:number;total:number}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [fieldGoalsOpen, setFieldGoalsOpen] = useState(false);
  const days=Object.entries(player.days).filter(([key])=>period === undefined || Number(key) === period).map(([,day])=>day);
  const raw: Record<string,number>={};
  for(const day of days) for(const [key,value] of Object.entries(day.rawStats ?? {})) raw[key]=(raw[key] ?? 0)+value;
  const rows=(week.scoringItems ?? []).filter(item=>item.points !== 0 && item.statId !== 9).map(item=>({...item,value:raw[String(item.statId)] ?? 0})).filter(item=>item.value * item.points !== 0).sort((a,b)=>(statRank.get(a.statId) ?? statOrder.length)-(statRank.get(b.statId) ?? statOrder.length));
  const fieldGoals = [13, 23].map(statId => ({ statId, value: raw[String(statId)] ?? 0, points: week.scoringItems?.find(item => item.statId === statId)?.points ?? 0 }));
  const showFieldGoals = fieldGoals.some(row => row.value !== 0 && row.points !== 0);
  const fieldGoalNet = fieldGoals.reduce((sum, row) => sum + row.value * row.points, 0);
  const displayRows = rows.filter(row => row.statId !== 13 && row.statId !== 23);
  if (showFieldGoals) displayRows.splice(displayRows.findIndex(row => row.statId !== 0) < 0 ? displayRows.length : displayRows.findIndex(row => row.statId !== 0), 0, { statId: -1, value: 0, points: 0 });
  const hasMinutes=days.some(day=>day.rawStats?.['40'] !== undefined || day.stats !== null);
  const minutes=days.reduce((sum,day)=>sum+(day.rawStats?.['40'] ?? day.stats?.min ?? 0),0);
  const hasFouls=days.some(day=>day.rawStats?.['9'] !== undefined || day.stats !== null);
  const fouls=days.reduce((sum,day)=>sum+(day.rawStats?.['9'] ?? day.stats?.fouls ?? 0),0);
  const foulPoints=week.scoringItems?.find(item=>item.statId === 9)?.points ?? 0;
  const sum=rows.reduce((s,r)=>s+r.value*r.points,0)+fouls*foulPoints;
  const available=days.some(d=>d.rawStats !== undefined) && (rows.length>0 || hasMinutes);
  if (total === 0) return <span>0.0</span>;
  return <><button type="button" className="score-detail-trigger" aria-label={`${player.name}: actual points breakdown`} onClick={()=>{setFieldGoalsOpen(false);dialog.current?.showModal();}}>{total.toFixed(1)}</button>
  <dialog ref={dialog} aria-label={`${player.name} points breakdown`} className="score-detail" onClick={e=>{if(e.target === e.currentTarget) dialog.current?.close();}}>
    <button type="button" className="tap-btn score-detail-close" aria-label="Close breakdown" onClick={()=>dialog.current?.close()}>×</button>
    <h2>{player.name}</h2><p>Actual · {period === undefined ? 'Week' : week.days.find(d=>d.scoringPeriodId === period)?.date}</p>
    {available ? <table><thead><tr><th>Scoring category</th><th>Pts per</th><th>#</th><th>Score</th></tr></thead><tbody>{hasMinutes && <tr><th>Minutes played</th><td>0</td><td>{Number(minutes.toFixed(1))}</td><td>0.0</td></tr>}{displayRows.map(r=>r.statId === -1 ? <Fragment key="field-goals"><tr><th>FGM/FGMI</th><td>Net</td><td>{fieldGoals[0].value}/{fieldGoals[1].value}</td><td><button type="button" className={`score-field-goal-net${fieldGoalNet < 0 ? ' is-negative' : ''}`} aria-label="Field goal net points; expand made and missed totals" aria-expanded={fieldGoalsOpen} onClick={() => setFieldGoalsOpen(!fieldGoalsOpen)}>{fieldGoalNet.toFixed(1)} <span aria-hidden="true">{fieldGoalsOpen ? '▴' : '▾'}</span></button></td></tr>{fieldGoalsOpen && fieldGoals.map(row => <tr key={row.statId} className="score-field-goal-part"><th>{names[row.statId]}</th><td className={row.points < 0 ? 'is-negative' : undefined}>{row.points}</td><td>{row.value}</td><td className={row.value * row.points < 0 ? 'is-negative' : undefined}>{(row.value * row.points).toFixed(1)}</td></tr>)}</Fragment> : <tr key={r.statId}><th>{names[r.statId] ?? `Stat ${r.statId}`}</th><td className={r.points < 0 ? 'is-negative' : undefined}>{r.points}</td><td>{r.value}</td><td className={r.value*r.points < 0 ? 'is-negative' : undefined}>{(r.value*r.points).toFixed(1)}</td></tr>)}{hasFouls && <tr><th>Fouls</th><td className={foulPoints < 0 ? 'is-negative' : undefined}>{foulPoints}</td><td>{fouls}</td><td className={fouls*foulPoints < 0 ? 'is-negative' : undefined}>{(fouls*foulPoints).toFixed(1)}</td></tr>}{Math.abs(sum-total)>0.05 && <tr><th>Other scoring / adjustments</th><td></td><td></td><td className={total-sum < 0 ? 'is-negative' : undefined}>{(total-sum).toFixed(1)}</td></tr>}</tbody><tfoot><tr><th>Total</th><td></td><td></td><td className={total < 0 ? 'is-negative' : undefined}>{total.toFixed(1)}</td></tr></tfoot></table> : <p>ESPN has not provided category stats for this score. Total: {total.toFixed(1)}.</p>}
  </dialog></>;
}
