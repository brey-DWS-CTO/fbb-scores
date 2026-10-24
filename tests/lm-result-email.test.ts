import assert from 'node:assert/strict';
import test from 'node:test';
import { isRosterCapacityError, lmResultEmail, LM_NO_ROSTER_SPOT, LM_ROSTER_SPOT_EXPIRED } from '../src/lib/league/lmResultEmail.ts';
import { flushLmResultEmails, type LmResultMailRuntime } from '../server/lib/lmResultNotifier.ts';
import { sendMail } from '../server/lib/mailer.ts';
import type { LmAddRequest } from '../src/lib/league/lmWeekend.ts';

const now=new Date('2026-10-25T21:01:00Z');
const row=(extra:Partial<LmAddRequest>={}):LmAddRequest=>({id:'claim-1',season:2027,owner:'Kyle',teamId:1,playerId:100,playerName:'Test Player',proTeam:'DEN',requestedAt:'2026-10-24T20:00:00Z',forDate:'2026-10-25',status:'added',note:'ESPN accepted (200)',updatedAt:'2026-10-25T21:00:00Z',handledBy:null,...extra});

test('success and both verified failure reasons use the standard mail content contract',()=>{
  const success=lmResultEmail(row(),'https://league.test')!;
  assert.match(success.subject,/successful/); assert.match(success.lines.join(' '),/added to your team/);
  assert.equal(success.action.href,'https://league.test/lm-adds?date=2026-10-25');
  const lost=lmResultEmail(row({status:'denied',note:'This player was already awarded for this LM Add day.'}),'https://league.test')!;
  assert.match(lost.lines.join(' '),/Another team claimed this player first/);
  const full=lmResultEmail(row({status:'denied',note:LM_ROSTER_SPOT_EXPIRED}),'https://league.test')!;
  assert.match(full.lines.join(' '),/did not have an open roster spot/);
  assert.ok(!JSON.stringify(full).includes('FAILED_'));
});

test('incomplete and cancelled claims send no result; unknown errors are not blamed on a full roster',()=>{
  for(const status of ['queued','processing','waiting-for-drop','cancelled','requested','failsafe'] as const) assert.equal(lmResultEmail(row({status,note:LM_NO_ROSTER_SPOT}),'https://league.test'),null);
  const unknown=lmResultEmail(row({status:'denied',note:'Unexpected ESPN error'}),'https://league.test')!;
  assert.match(unknown.lines.join(' '),/contact the commissioner/);
  assert.ok(!unknown.lines.join(' ').includes('did not have an open roster spot'));
  for(const body of ['Roster is full','No open roster spot','MAXIMUM ROSTER SIZE','ROSTER_FULL']) assert.equal(isRosterCapacityError(body),true,body);
  for(const body of ['Invalid credentials','Insufficient budget','Player was claimed','HTTP 503']) assert.equal(isRosterCapacityError(body),false,body);
});

function runtime(rows:LmAddRequest[]) {
  const sent=new Set<string>(); const messages:Array<{to:string;key:string}>=[];
  let ok=true;
  const deps:LmResultMailRuntime={requests:async()=>rows,emails:async()=>[{owner:'Kyle',email:'kyle@example.test',confirmedAt:null}],sent:async()=>[...sent],mark:async key=>{sent.add(key);return true;},send:async(to,_content,_origin,_tag,key)=>{messages.push({to,key});return {ok};}};
  return {deps,sent,messages,fail:()=>{ok=false;},succeed:()=>{ok=true;}};
}

test('only the submitting owner is emailed once; pending, missing-address and stale results are skipped',async()=>{
  const rt=runtime([row(),row({id:'other',owner:'Joel'}),row({id:'pending',status:'queued'}),row({id:'stale',updatedAt:'2026-10-23T00:00:00Z'})]);
  assert.equal(await flushLmResultEmails(2027,now,rt.deps),1);
  assert.deepEqual(rt.messages.map(msg=>msg.to),['kyle@example.test']);
  assert.equal(await flushLmResultEmails(2027,now,rt.deps),0);
  assert.equal(rt.messages.length,1);
});

test('mail failures retry with the same provider key, without claiming delivery early',async()=>{
  const rt=runtime([row()]); rt.fail();
  assert.equal(await flushLmResultEmails(2027,now,rt.deps),0); assert.equal(rt.sent.size,0);
  rt.succeed(); assert.equal(await flushLmResultEmails(2027,now,rt.deps),1);
  assert.equal(rt.messages[0].key,rt.messages[1].key); assert.equal(rt.sent.size,1);
});

test('existing branded mailer renders result mail and sends the provider idempotency header',async()=>{
  const oldFetch=globalThis.fetch, oldKey=process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY='qa-key';
  globalThis.fetch=async(_url,init)=>{
    const headers=init?.headers as Record<string,string>;
    assert.equal(headers['Idempotency-Key'],'qa-result-key');
    const body=JSON.parse(String(init?.body));
    assert.deepEqual(body.to,['kyle@example.test']);
    assert.match(body.html,/logo.png/); assert.match(body.html,/VIEW LM ADDS/);
    assert.match(body.text,/Test Player was added/);
    return new Response(JSON.stringify({id:'qa-message'}),{status:200});
  };
  try { assert.equal((await sendMail('kyle@example.test',lmResultEmail(row(),'https://league.test')!,'https://league.test','lm-result','qa-result-key')).ok,true); }
  finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;}
});
