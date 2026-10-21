import { useRef } from 'react';
import type { ScorePlayer, ScoresWeek } from '../../lib/league/scores.js';
const names: Record<number,string> = {0:'Points',1:'Blocks',2:'Steals',3:'Assists',6:'Rebounds',11:'Turnovers',13:'Field goals made',14:'Field goals attempted',15:'Free throws made',16:'Free throws attempted',17:'Three pointers made',18:'Three pointers attempted',23:'Field goals missed',24:'Free throws missed',37:'Double doubles',38:'Triple doubles',39:'Quadruple doubles'};
export default function ScoreBreakdown({player,week,period,total,projected=false}: {player:ScorePlayer;week:ScoresWeek;period?:number;total:number;projected?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const days=Object.entries(player.days).filter(([key])=>period === undefined || Number(key) === period).map(([,day])=>day);
  const raw: Record<string,number>={};
  for(const day of days) for(const [key,value] of Object.entries(day.rawStats ?? {})) raw[key]=(raw[key] ?? 0)+value;
  const rows=(week.scoringItems ?? []).filter(item=>item.points !== 0).map(item=>({...item,value:raw[String(item.statId)] ?? 0}));
  const sum=rows.reduce((s,r)=>s+r.value*r.points,0);
  const available=days.some(d=>d.rawStats !== undefined) && rows.length>0;
  return <><button type="button" className="score-detail-trigger" aria-label={`${player.name}: ${projected ? 'projected' : 'actual'} points breakdown`} onClick={()=>dialog.current?.showModal()}>{total.toFixed(1)}</button>
  <dialog ref={dialog} className="score-detail" onClick={e=>{if(e.target === e.currentTarget) dialog.current?.close();}}>
    <button type="button" className="tap-btn score-detail-close" aria-label="Close breakdown" onClick={()=>dialog.current?.close()}>×</button>
    <h2>{player.name}</h2><p>{projected ? 'Projected' : 'Actual'} · {period === undefined ? 'Week' : week.days.find(d=>d.scoringPeriodId === period)?.date}</p>
    {projected ? <p>Projected finish: {total.toFixed(1)} points. Uses ESPN’s daily projection when available, otherwise recent form, season average and preseason expectations; live games account for remaining playing time. Category projections are not available for this estimate.</p> : available ? <table><thead><tr><th>Scoring category</th><th>Pts per</th><th>#</th><th>Score</th></tr></thead><tbody>{rows.map(r=><tr key={r.statId}><th>{names[r.statId] ?? `Stat ${r.statId}`}</th><td>{r.points}</td><td>{r.value}</td><td>{(r.value*r.points).toFixed(1)}</td></tr>)}{Math.abs(sum-total)>0.05 && <tr><th>Other scoring / adjustments</th><td></td><td></td><td>{(total-sum).toFixed(1)}</td></tr>}</tbody><tfoot><tr><th>Total</th><td></td><td></td><td>{total.toFixed(1)}</td></tr></tfoot></table> : <p>ESPN has not provided category stats for this score. Total: {total.toFixed(1)}.</p>}
  </dialog></>;
}
