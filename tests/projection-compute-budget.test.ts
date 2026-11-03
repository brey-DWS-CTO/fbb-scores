import { loadWeek } from '../server/lib/scoresWeekService.ts';
import type { EspnClient } from '../src/lib/espn/client.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { evaluationRunDate, evaluationPhase, READONLY_TEAM_REFRESH_MS } from '../src/lib/league/projectionComputePolicy.ts';
import { fileEvaluationStore } from '../server/lib/projectionEvaluationStore.ts';
import { readEvaluationDay } from '../server/lib/evaluationDayService.ts';
import { createProjectionReportReader } from '../server/lib/projectionReportReader.ts';
import { projectionEvaluationReport } from '../src/lib/league/projectionEvaluation.ts';
import type { NbaGame } from '../src/lib/league/houseParty.ts';

test('daily clock gate runs at 07:00 Pacific across DST, not on the other 23 hourly ticks', () => {
  assert.equal(evaluationRunDate(new Date('2026-10-31T14:00:00Z')), '2026-10-31');
  assert.equal(evaluationRunDate(new Date('2026-11-01T15:00:00Z')), '2026-11-01');
  for (let hour = 0; hour < 24; hour++) {
    const date = new Date(`2026-11-02T${String(hour).padStart(2, '0')}:00:00Z`);
    assert.equal(evaluationRunDate(date) !== null, hour === 15);
  }
  assert.equal(READONLY_TEAM_REFRESH_MS, 300000);
});
test('durable claims prevent duplicate runs across fresh instances and enforce 28 + 14 days', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'fbb-compute-'));
  try {
    const first = fileEvaluationStore(folder), second = fileEvaluationStore(folder);
    const claims = await Promise.all([first.claimRun(2027, '2026-11-01'), second.claimRun(2027, '2026-11-01')]);
    assert.equal(claims.filter(Boolean).length, 1);
    let captures = 1, settlements = 0;
    for (let day = 1; day < 60; day++) {
      const date = new Date(Date.parse('2026-11-01T00:00:00Z') + day * 86400000).toISOString().slice(0, 10);
      const phase = await fileEvaluationStore(folder).claimRun(2027, date);
      if (phase === 'capture') captures++;
      if (phase === 'settle') settlements++;
    }
    assert.equal(captures, 28); assert.equal(settlements, 14);
    assert.equal(evaluationPhase('2026-11-01', '2026-10-31'), null);
    assert.equal(evaluationPhase('2026-11-01', '2026-12-13'), null);
    const report = projectionEvaluationReport([]);
    await first.saveReport(2027, report);
    first.read = async () => { throw new Error('Raw archives must not be read by pages'); };
    assert.deepEqual(await first.readReport(2027), report);
    assert.deepEqual(await fileEvaluationStore(folder).readReport(2027), report);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('result collection asks for one scoreboard and at most 15 final-game summaries', async () => {
  let boards = 0, ids: readonly string[] = [];
  const games = Array.from({ length: 35 }, (_, index) => ({ id: String(index), state: index < 30 ? 'post' : 'in' })) as NbaGame[];
  await readEvaluationDay('2026-11-01', async () => { boards++; return games; }, async requested => { ids = requested; return { boxScores: [], error: null }; });
  assert.equal(boards, 1); assert.equal(ids.length, 15);
  assert.ok(ids.every(id => Number(id) < 30));
});
test('page report shares a tiny saved summary and never accepts a raw-archive reader', async () => {
  let seasons = 0, reads = 0, now = 0;
  const report = projectionEvaluationReport([]);
  const reader = createProjectionReportReader(async () => { seasons++; return 2027; }, async () => { reads++; return report; }, () => now);
  await Promise.all(Array.from({ length: 20 }, () => reader()));
  assert.equal(reads, 1); assert.equal(seasons, 1);
  now = 60000; await reader(); assert.equal(reads, 2);
  assert.ok(JSON.stringify(report).length < 2048);
});

test('unexpected weeks over 14 days are rejected before any daily source fan-out', async () => {
  let settings = 0, days = 0;
  const client = {
    fetchWeekSettings: async () => { settings++; return { seasonId: 2027, scoringPeriodId: 1, status: { currentMatchupPeriod: 1 }, settings: {
      scheduleSettings: { matchupPeriods: { '1': Array.from({ length: 30 }, (_, i) => i + 1) } },
      proTeams: [{ id: 7, proGamesByScoringPeriod: { '1': [{ date: Date.parse('2026-10-20T20:00:00Z') }] } }],
    } }; },
    fetchDailyBoxScore: async () => { days++; throw new Error('Over-budget source calls must not happen'); },
  } as unknown as EspnClient;
  await assert.rejects(() => loadWeek(client, null, 14), /exceeds evaluation read budget/);
  assert.equal(settings, 1); assert.equal(days, 0);
});
