import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';
import axios from 'axios';
import { lmResultEmail, LM_ROSTER_SPOT_EXPIRED } from '../src/lib/league/lmResultEmail.js';

const root = path.resolve(import.meta.dirname, '..');
const originalAdapter = axios.defaults.adapter;
let fixture = '';
let service: typeof import('../server/lib/lmWeekendService.ts');
let store: typeof import('../server/lib/leagueStore.ts');
let players: number[];
let posts = 0;
let reads = 0;
let intendedTeam = 0;
let result: 'ok' | 'uncertain' | 'full' = 'ok';
const holders = new Map<number, number>();
const config = {leagueId:'qa-only',seasonId:2027,cookie:'not-a-real-cookie',dryRun:false};
const submitted = new Date('2026-10-24T19:00:00Z');
const sunday = new Date('2026-10-25T20:05:00Z'); // 1:05 PM PT, after waivers, before 2 PM tip.

before(async () => {
  const parent = path.join(root,'node_modules','.tmp'); mkdirSync(parent,{recursive:true});
  fixture = mkdtempSync(path.join(parent,'lm-sunday-'));
  cpSync(path.join(root,'package.json'),path.join(fixture,'package.json'));
  for (const folder of ['src','server']) cpSync(path.join(root,folder),path.join(fixture,folder),{recursive:true});
  process.env.DATABASE_URL=''; process.env.RESEND_API_KEY=''; process.env.SLACK_WEBHOOK_URL='';
  process.env.ESPN_LEAGUE_ID=config.leagueId; process.env.ESPN_COOKIE_STRING=config.cookie; process.env.ESPN_LM_DRY_RUN='0';
  axios.defaults.adapter = async request => {
    const response = (data: unknown, status=200) => ({config:request,status,statusText:String(status),headers:{},data});
    if (request.method === 'post') {
      assert.ok(request.baseURL?.startsWith('https://lm-api-writes.fantasy.espn.com/'));
      assert.equal(request.url,'/transactions/');
      const body = JSON.parse(String(request.data));
      assert.deepEqual(body,{isLeagueManager:true,teamId:intendedTeam,type:'FREEAGENT',scoringPeriodId:6,executionType:'EXECUTE',items:[{playerId:body.items[0].playerId,type:'ADD',toTeamId:intendedTeam}],isActingAsTeamOwner:false,skipTransactionCounters:false});
      posts++;
      if (result === 'full') return response({error:'Roster is full'},400);
      holders.set(body.items[0].playerId,intendedTeam);
      if (result === 'uncertain') throw new Error('Connection ended after ESPN accepted');
      return response({accepted:true});
    }
    reads++;
    if (request.url?.includes('/scoreboard')) {
      const date=String(request.params.dates).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
      return response({events:[{competitions:[{date:`${date}T21:00:00Z`,competitors:[{homeAway:'home',team:{abbreviation:'DEN'}},{homeAway:'away',team:{abbreviation:'LAL'}}]}]}]});
    }
    if (request.params?.view==='mSettings') return response({scoringPeriodId:6});
    if (request.params?.view==='mTransactions2') return response({id:1,transactions:[]});
    if (request.params?.view==='kona_player_info') {
      const ids=JSON.parse(String(request.headers.get('x-fantasy-filter'))).players.filterIds.value as number[];
      return response({players:ids.map(id=>({id,onTeamId:holders.get(id)??0,player:{id,fullName:`QA Player ${id}`,proTeamId:7}}))});
    }
    throw new Error(`Unexpected external request blocked: ${request.url}`);
  };
  service=await import(pathToFileURL(path.join(fixture,'server/lib/lmWeekendService.ts')).href);
  store=await import(pathToFileURL(path.join(fixture,'server/lib/leagueStore.ts')).href);
  const {FALLBACK_PLAYER_POOL}=await import(pathToFileURL(path.join(fixture,'server/lib/playerPoolService.ts')).href);
  players=FALLBACK_PLAYER_POOL.players.filter((p: {espnId:number|null})=>p.espnId).slice(0,4).map((p: {espnId:number})=>p.espnId);
});

after(()=>{axios.defaults.adapter=originalAdapter;if(fixture)rmSync(fixture,{recursive:true,force:true});});

test('empty queue returns immediately without any ESPN reads or writes',async()=>{
  assert.deepEqual(await service.runAdvanceLmClaims(config,sunday),[]);
  assert.equal(reads,0); assert.equal(posts,0);
});

test('tomorrow-only queue does nothing today, then Sunday uses the real worker and LM write path once',async()=>{
  const claim=await service.queueLmClaim('Kyle',players[0],'2026-10-25',submitted);
  intendedTeam=claim.teamId;
  const priorReads=reads;
  assert.deepEqual(await service.runAdvanceLmClaims(config,new Date('2026-10-24T21:05:00Z')),[]);
  assert.equal(reads,priorReads); assert.equal(posts,0);
  const output=await service.runAdvanceLmClaims(config,sunday);
  assert.equal(output.find(row=>row.id===claim.id)?.status,'added'); assert.equal(posts,1);
  assert.equal((await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)?.status,'added');
  await service.runAdvanceLmClaims(config,new Date('2026-10-25T20:06:00Z'));
  assert.equal(posts,1,'a later cron tick must not add again');
});

test('full roster leaves the claim queued and succeeds after room is available',async()=>{
  const claim=await service.queueLmClaim('Kyle',players[1],'2026-10-25',submitted);
  result='full';
  await service.runAdvanceLmClaims(config,sunday);
  let saved=(await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)!;
  assert.equal(saved.status,'queued'); assert.match(saved.note,/No open roster spot/);
  result='ok';
  await service.runAdvanceLmClaims(config,new Date('2026-10-25T20:06:00Z'));
  saved=(await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)!;
  assert.equal(saved.status,'added');
});

test('uncertain ESPN response is reconciled from ownership without another write',async()=>{
  const claim=await service.queueLmClaim('Kyle',players[2],'2026-10-25',submitted);
  result='uncertain';
  await service.runAdvanceLmClaims(config,sunday);
  const saved=(await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)!;
  assert.equal(saved.status,'processing');
  const priorPosts=posts;
  result='ok';
  const retryAt=new Date(Math.max(Date.parse(saved.updatedAt)+180_000,sunday.getTime()+180_000));
  await service.runAdvanceLmClaims(config,retryAt);
  assert.equal((await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)?.status,'added');
  assert.equal(posts,priorPosts);
});

test('a full roster that never opens becomes a final roster-space failure',async()=>{
  const claim=await service.queueLmClaim('Kyle',players[3],'2026-10-25',submitted);
  result='full';
  await service.runAdvanceLmClaims(config,sunday);
  assert.equal((await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)?.status,'queued');
  await service.runAdvanceLmClaims(config,new Date('2026-10-25T21:01:00Z'));
  const saved=(await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)!;
  assert.equal(saved.status,'denied'); assert.equal(saved.note,LM_ROSTER_SPOT_EXPIRED);
  assert.match(lmResultEmail(saved,'https://league.test')!.lines.join(' '),/did not have an open roster spot/);
});

test('a later competing claim receives the claimed-first email reason',async()=>{
  const claim=await service.queueLmClaim('Ryan',players[0],'2026-10-25',submitted);
  await service.runAdvanceLmClaims(config,sunday);
  const saved=(await store.listLmAddRequests(2027)).find(row=>row.id===claim.id)!;
  assert.equal(saved.status,'denied');
  assert.match(lmResultEmail(saved,'https://league.test')!.lines.join(' '),/Another team claimed this player first/);
});
