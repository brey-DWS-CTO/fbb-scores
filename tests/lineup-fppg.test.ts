import test from 'node:test';
import assert from 'node:assert/strict';
import { lineupFppg, fppgText, leadPerExtraGameLabel, sortLineupFppg } from '../src/lib/league/lineupFppg.ts';
import { planWeek } from '../src/lib/league/scores.ts';
import type { ScoreSide, ScorePlayer, PlayerDay } from '../src/lib/league/scores.ts';
const day = (points:number, started=true, played=true):PlayerDay => ({points,started,played,lineupSlotId:0,stats:null,game:null});
const side = (...days:Record<string,PlayerDay>[]):ScoreSide => ({teamId:1,name:'Team',abbrev:'T',record:{wins:0,losses:0,ties:0},total:81.3,pointsByDay:{},players:days.map((days,i)=>({id:i,days}) as ScorePlayer)});
test('81.3 across two starters is 40.65 FPPG; bench and DNP excluded',()=>{
 const s=side({'1':day(52.9)},{'1':day(28.4)},{'1':day(100,false)},{'1':day(0,true,false)});
 assert.equal(fppgText(lineupFppg(s,1).average),'40.7'); assert.equal(lineupFppg(s,1).games,2); assert.ok(Math.abs(lineupFppg(s,1).average!-40.65)<1e-9);
});
test('weekly average weights player-games and includes zero and negative scores',()=>{
 const s=side({'1':day(60),'2':day(0)},{'2':day(-3)});
 assert.equal(lineupFppg(s).average,19);assert.equal(lineupFppg(s,2).average,-1.5);assert.equal(lineupFppg(s,3).average,null);
});
test('opening night anchor keeps scoring dates stable after Eastern midnight',()=>{
 const settings={seasonId:2027,scoringPeriodId:1,status:{currentMatchupPeriod:1},settings:{scheduleSettings:{matchupPeriods:{'1':[1,2,3,4,5,6,7]}}}};
 const plan=planWeek(settings,null,{scoringPeriodId:1,date:'2026-10-20',source:'opening-night'});
 assert.equal(plan.days[0].date,'2026-10-20');
});

test('weekly table sorts week, GP, dates, names and trend without mutating rows; missing averages remain last',()=>{
 const a={...side({'1':day(20),'2':day(60)}),teamId:1,name:'Alpha'};
 const b={...side({'1':day(70)}),teamId:2,name:'Beta'};
 const empty={...side({'1':day(0,true,false)}),teamId:3,name:'Empty'};
 const rows=[a,b,empty];
 const ids=(column:string,ascending=false)=>sortLineupFppg(rows,column,ascending,[1,2]).map(row=>row.teamId);
 assert.deepEqual(ids('week'),[2,1,3]); assert.deepEqual(ids('week',true),[1,2,3]);
 assert.deepEqual(ids('gp'),[1,2,3]); assert.deepEqual(ids('gp',true),[3,2,1]);
 assert.deepEqual(ids('1'),[2,1,3]); assert.deepEqual(ids('2',true),[1,2,3]);
 assert.deepEqual(ids('team',true),[1,2,3]); assert.deepEqual(ids('team'),[3,2,1]);
 assert.deepEqual(ids('trend'),[1,2,3]); assert.deepEqual(rows.map(row=>row.teamId),[1,2,3]);
});

test('lead per extra game: 166.1 up over 4 extra starter-games is 41.5 PPG; even and fewer games show the lead',()=>{
 const g=(n:number)=>Object.fromEntries(Array.from({length:n},(_,i)=>[String(i+1),day(10)]));
 const funk={...side(g(26)),total:859.6,abbrev:'FUNK'};
 const st={...side(g(22)),total:693.5,abbrev:'ST'};
 assert.equal(leadPerExtraGameLabel(funk,st),'FUNK +41.5 PPG · 4 extra GP');
 assert.equal(leadPerExtraGameLabel(st,funk),'FUNK +41.5 PPG · 4 extra GP');
 assert.equal(leadPerExtraGameLabel(funk,{...st,total:900}),'ST +40.4 · 4 fewer GP');
 assert.equal(leadPerExtraGameLabel(funk,{...funk,abbrev:'X',total:800}),'FUNK +59.6 · even GP');
 assert.equal(leadPerExtraGameLabel(funk,{...funk,abbrev:'X'}),'Even');
 assert.equal(leadPerExtraGameLabel({...funk,players:[]},{...st,players:[]}),null);
});
