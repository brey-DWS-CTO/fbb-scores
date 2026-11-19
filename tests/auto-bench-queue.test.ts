import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAutoBench, deliverAutoBench, type AutoBenchMessage, type AutoBenchScheduler } from '../server/lib/autoBenchQueue.js';
import { readFileSync } from 'node:fs';

// Injected publisher: tests never connect to Vercel Queues or ESPN.
process.env.ESPN_LEAGUE_ID = '123';
process.env.ESPN_SEASON_ID = '2027';
process.env.ESPN_COOKIE_STRING = 'fixture-only';
function source() {
  const sent: Array<{ message: AutoBenchMessage; options: { delaySeconds: number; retentionSeconds: number; idempotencyKey: string } }> = [];
  const deps: AutoBenchScheduler = { async eligible() { return true; }, async games() { return []; }, async publish(message, options) { sent.push({ message, options }); } };
  return { deps, sent };
}
test('daily planner sends one delayed message for normal, early and DST waiver days', async () => {
  const normal = source();
  await scheduleAutoBench(new Date('2026-11-18T07:00:00Z'), normal.deps);
  assert.equal(normal.sent.length, 1);
  assert.equal(normal.sent[0].message.runAt, '2026-11-18T23:15:00.000Z');
  assert.equal(normal.sent[0].options.delaySeconds, 16 * 3600 + 15 * 60);
  const early = source(); early.deps.games = async () => [{ home: 'BOS', away: 'DEN', tipoff: '2026-10-24T19:00:00Z' }];
  await scheduleAutoBench(new Date('2026-10-24T07:00:00Z'), early.deps);
  assert.equal(early.sent[0].message.runAt, '2026-10-24T18:15:00.000Z');
  assert.equal(early.sent[0].options.delaySeconds, 11 * 3600 + 15 * 60);
  await scheduleAutoBench(new Date('2026-10-24T08:00:00Z'), early.deps);
  assert.equal(early.sent[0].options.idempotencyKey, early.sent[1].options.idempotencyKey);
});
test('no opted-in owners means no schedule or queue read; a late opt-in schedules tomorrow', async () => {
  const off = source(); off.deps.eligible = async () => false; off.deps.games = async () => { assert.fail('must not read games'); };
  assert.equal((await scheduleAutoBench(new Date('2026-11-18T07:00:00Z'), off.deps)).scheduled, false);
  assert.equal(off.sent.length, 0);
  const late = source(); await scheduleAutoBench(new Date('2026-11-18T23:30:00Z'), late.deps);
  assert.equal(late.sent[0].message.date, '2026-11-19');
  assert.equal(late.sent[0].message.runAt, '2026-11-19T23:15:00.000Z');
});
test('queue delivery validates league, season, date and due time before invoking the daily batch', async () => {
  const message: AutoBenchMessage = { date: '2026-11-18', leagueId: '123', seasonId: 2027, runAt: '2026-11-18T23:15:00Z' };
  let calls = 0;
  const run = async (now: Date, expected?: string) => { calls++; assert.equal(now.toISOString(), '2026-11-18T23:15:00.000Z'); assert.equal(expected, message.runAt); return []; };
  await deliverAutoBench(message, new Date(message.runAt), run);
  assert.equal(calls, 1);
  for (const patch of [{ leagueId: 'wrong' }, { seasonId: 2026 }, { date: '2026-11-19' }, { runAt: 'invalid' }]) await deliverAutoBench({ ...message, ...patch }, new Date(message.runAt), run);
  await deliverAutoBench(message, new Date('2026-11-18T23:00:00Z'), run);
  await deliverAutoBench(message, new Date('2026-11-18T23:30:00Z'), run);
  assert.equal(calls, 1);
});
test('auto-bench has a daily planner and private delayed consumer, with no LM-clock invocation', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons.filter((entry: { path: string }) => entry.path.includes('auto-bench')), [{ path: '/api/notify/auto-bench-schedule', schedule: '0 7 * * *' }]);
  assert.deepEqual(config.functions['api/auto-bench.ts'].experimentalTriggers, [{ type: 'queue/v2beta', topic: 'daily-waiver-auto-bench' }]);
  const notify = readFileSync(new URL('../server/routes/notify.ts', import.meta.url), 'utf8');
  assert.equal(notify.includes('runAutoBench('), false);
});
