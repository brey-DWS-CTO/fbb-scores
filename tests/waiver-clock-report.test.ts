import assert from 'node:assert/strict';
import test from 'node:test';
import { waiverCountdown, waiverHourFor, waiverRunAt } from '../src/lib/league/lmWeekend.ts';
import { normalizeWaiverOffers, type EspnTransaction } from '../src/lib/league/transactions.ts';

test('planned waiver times follow the selected day, including Pacific DST changes', () => {
  assert.equal(waiverRunAt('2026-10-24', 14), '2026-10-24T21:00:00.000Z');
  assert.equal(waiverRunAt('2026-11-01', 15), '2026-11-01T23:00:00.000Z');
  assert.equal(waiverRunAt('2027-03-14', 15), '2027-03-14T22:00:00.000Z');
  const tomorrow = waiverHourFor([{home:'DEN',away:'LAL',tipoff:'2026-10-24T19:30:00Z'}]);
  assert.equal(tomorrow.hourPT, 11);
  assert.equal(waiverCountdown(waiverRunAt('2026-10-24', tomorrow.hourPT), Date.parse('2026-10-23T22:00:00Z')), '20:00:00');
});

test('countdowns tick through seconds and never claim ESPN has processed waivers', () => {
  const target = '2026-10-24T18:00:00Z';
  assert.equal(waiverCountdown(target, Date.parse('2026-10-24T17:59:58Z')), '00:00:02');
  assert.equal(waiverCountdown(target, Date.parse('2026-10-24T17:59:59Z')), '00:00:01');
  assert.equal(waiverCountdown(target, Date.parse(target)), 'Scheduled time passed');
  assert.equal(waiverCountdown(target, Date.parse('2026-10-25T00:00:00Z')), 'Scheduled time passed');
});

const now = Date.parse('2026-10-23T22:00:00Z');
const offer = (extra: Partial<EspnTransaction> = {}): EspnTransaction => ({id:'test',type:'WAIVER',status:'EXECUTED',teamId:1,bidAmount:8,processDate:now - 1000,items:[{playerId:100,type:'ADD'}],...extra});
const context = {season:2027,teams:[{owner:'Joel',espnTeamId:1}],players:new Map([[100,{name:'Test Player',proTeam:'DEN'}]])};

test('offers report includes processed wins and failures, preserving bids', () => {
  const rows = normalizeWaiverOffers({transactions:[offer(),offer({id:'failed',type:'WAIVER_ERROR',status:'FAILED_INVALIDPLAYERSOURCE',bidAmount:3})]},context,now);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.outcome).sort(),['successful','unsuccessful']);
  assert.equal(rows.find(row=>row.outcome==='unsuccessful')?.bid,3);
  assert.ok(rows.every(row=>row.playerName==='Test Player' && row.owner==='Joel'));
  assert.ok(rows.every(row => !('status' in row)), 'raw ESPN failure codes are not public explanations');
  assert.ok(!JSON.stringify(rows).includes('INVALIDPLAYERSOURCE'));
});

test('pending, cancelled, future, undated and unrelated offers cannot leak', () => {
  for (const extra of [{status:'PENDING'},{status:'CANCELED'},{isPending:true},{processDate:now+1},{processDate:undefined,proposedDate:now-1000},{type:'TRADE'},{status:'UNKNOWN'},{teamId:99}]) {
    assert.deepEqual(normalizeWaiverOffers({transactions:[offer(extra)]},context,now),[],JSON.stringify(extra));
  }
});
