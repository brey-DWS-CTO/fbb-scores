import test from 'node:test';
import assert from 'node:assert/strict';
import { lineupFppg, fppgText } from '../src/lib/league/lineupFppg.ts';
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
