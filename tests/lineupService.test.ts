import assert from 'node:assert/strict';
import test from 'node:test';
import { LineupService, emptyLineupState, type LineupRepository, type LineupState } from '../server/lib/lineup/service.js';
import { DisabledEspnLineupProvider, type LineupProvider } from '../server/lib/lineup/provider.js';
import type { LineupSnapshot, MoveRequest } from '../src/lib/league/lineup.js';

const time = new Date('2026-10-24T20:00:00Z');
const id = 'operation-00000001';
const request: MoveRequest = { playerId: 1, destinationSlotId: 'starter', revision: 'r1' };
function snapshot(): LineupSnapshot {
  return {
    leagueId: 'league', teamId: 5, scoringPeriodId: 4, revision: 'r1', fetchedAt: time.toISOString(),
    lockMode: 'individual', periodLockAt: null,
    slots: [
      { id: 'starter', label: 'PG', eligibilityId: 0, playerId: 2 },
      { id: 'bench', label: 'Bench', eligibilityId: 12, playerId: 1 },
      { id: 'other', label: 'Bench', eligibilityId: 12, playerId: 3 },
    ],
    players: [1, 2, 3].map(id => ({ id, name: `Player ${id}`, eligibleSlotIds: [0, 12],
      lockAt: '2026-10-24T21:00:00Z', locked: false })),
  };
}
function saved(): LineupSnapshot {
  const result = snapshot();
  result.revision = 'r2';
  result.slots[0].playerId = 1;
  result.slots[1].playerId = 2;
  return result;
}
class MemoryRepo implements LineupRepository {
  state = emptyLineupState();
  private pending = Promise.resolve();
  constructor() { this.state.grants.Owner = { owner: 'Owner', enabled: true, leagueId: 'league', teamId: 5 }; }
  async read(): Promise<LineupState> { await this.pending; return structuredClone(this.state); }
  mutate(fn: (state: LineupState) => void): Promise<void> {
    const operation = this.pending.then(() => {
      const draft = structuredClone(this.state);
      fn(draft);
      this.state = draft;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
class FakeProvider implements LineupProvider {
  executionEnabled = true;
  reason = 'Disabled';
  reads = 0;
  executions = 0;
  checks = 0;
  didExecute = false;
  onRead?: (count: number) => LineupSnapshot;
  onCheck?: (count: number) => Promise<boolean>;
  onExecute?: () => Promise<void>;
  async read(): Promise<LineupSnapshot> {
    this.reads++;
    return this.onRead ? this.onRead(this.reads) : this.didExecute ? saved() : snapshot();
  }
  async canExecute(): Promise<boolean> { this.checks++; return this.onCheck ? this.onCheck(this.checks) : true; }
  async execute(): Promise<void> {
    this.executions++;
    if (this.onExecute) await this.onExecute();
    this.didExecute = true;
  }
}
function setup() {
  const repo = new MemoryRepo();
  const provider = new FakeProvider();
  return { repo, provider, service: new LineupService(repo, provider, 10, () => time) };
}
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release };
}

test('successful move follows full lifecycle and confirms ESPN roster before releasing lock', async () => {
  const { service, repo, provider } = setup();
  const operation = await service.submit('Owner', id, request);
  assert.equal(operation.status, 'SUCCEEDED');
  assert.deepEqual(operation.history.map(item => item.status),
    ['REQUESTED', 'VALIDATING', 'EXECUTING', 'VERIFYING', 'SUCCEEDED']);
  assert.deepEqual(operation.before, snapshot());
  assert.deepEqual(operation.after, saved());
  assert.equal(provider.executions, 1);
  assert.equal(provider.reads, 3);
  assert.deepEqual(repo.state.rosterLocks, {});
});
test('an unexpected unchanged slot or period prevents success and blocks future moves', async () => {
  for (const field of ['unchanged-slot', 'period', 'team', 'stale'] as const) {
    const { service, repo, provider } = setup();
    provider.onRead = count => {
      if (count <= 2) return snapshot();
      const after = saved();
      if (field === 'unchanged-slot') after.slots[2].playerId = null;
      if (field === 'period') after.scoringPeriodId++;
      if (field === 'team') after.teamId++;
      if (field === 'stale') after.fetchedAt = '2026-10-24T19:59:00Z';
      return after;
    };
    const result = await service.submit('Owner', id, request);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(repo.state.rosterLocks['league:5'], id);
    await assert.rejects(service.submit('Owner', 'operation-00000002', request), /awaiting/);
    assert.equal(provider.executions, 1);
  }
});
test('execute timeout is UNKNOWN, duplicate does not retry, read-only reconciliation can confirm', async () => {
  const { service, repo, provider } = setup();
  provider.onExecute = async () => { throw new Error('secret HTTP cookie timeout'); };
  const first = await service.submit('Owner', id, request);
  assert.equal(first.status, 'UNKNOWN');
  assert.ok(!JSON.stringify(first).includes('secret'));
  assert.equal((await service.submit('Owner', id, request)).status, 'UNKNOWN');
  assert.equal(provider.executions, 1);
  provider.onRead = () => saved();
  assert.equal((await service.verify('Owner', id)).status, 'SUCCEEDED');
  assert.equal(provider.executions, 1);
  assert.deepEqual(repo.state.rosterLocks, {});
});
test('read/session errors before submission fail safely and release the roster', async () => {
  const { service, repo, provider } = setup();
  provider.onRead = () => { throw new Error('session expired Cookie: secret'); };
  const result = await service.submit('Owner', id, request);
  assert.equal(result.status, 'FAILED');
  assert.equal(provider.executions, 0);
  assert.deepEqual(repo.state.rosterLocks, {});
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('revoking access during provider validation prevents execution', async () => {
  const { service, repo, provider } = setup();
  provider.onCheck = async count => {
    if (count === 2) await repo.mutate(state => { state.grants.Owner.enabled = false; });
    return true;
  };
  assert.equal((await service.submit('Owner', id, request)).status, 'FAILED');
  assert.equal(provider.executions, 0);
  assert.deepEqual(repo.state.rosterLocks, {});
});
test('ESPN changes between validation reads prevent submission', async () => {
  const { service, provider } = setup();
  provider.onRead = count => {
    const result = snapshot();
    if (count === 2) result.revision = 'changed';
    return result;
  };
  assert.equal((await service.submit('Owner', id, request)).status, 'FAILED');
  assert.equal(provider.executions, 0);
});
test('lock cutoff and provider capability failures do not execute', async () => {
  for (const failure of ['lock', 'capability', 'team'] as const) {
    const { service, provider } = setup();
    provider.onRead = () => {
      const result = snapshot();
      if (failure === 'lock') result.players[1].lockAt = '2026-10-24T20:10:00Z';
      if (failure === 'team') result.teamId = 6;
      return result;
    };
    provider.onCheck = async () => failure !== 'capability';
    assert.equal((await service.submit('Owner', id, request)).status, 'FAILED');
    assert.equal(provider.executions, 0);
  }
});
test('operation records and IDs are isolated by owner and request', async () => {
  const { service, repo } = setup();
  await service.submit('Owner', id, request);
  await assert.rejects(service.get('Other', id), /not found/);
  await assert.rejects(service.verify('Other', id), /not found/);
  await assert.rejects(service.submit('Other', id, request), /already used/);
  await assert.rejects(service.submit('Owner', id, { ...request, playerId: 2 }), /already used/);
  assert.equal(Object.keys(repo.state.operations).length, 1);
});
test('concurrent duplicate requests claim execution once', async () => {
  const { service, provider } = setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => service.submit('Owner', id, request)));
  assert.equal(provider.executions, 1);
  assert.ok(results.every(result => result.id === id));
  assert.equal((await service.get('Owner', id)).status, 'SUCCEEDED');
});
test('different operation IDs cannot execute concurrently on the same roster', async () => {
  const { service, provider } = setup();
  const executing = gate();
  const finish = gate();
  provider.onExecute = async () => { executing.release(); await finish.waiting; };
  const first = service.submit('Owner', id, request);
  await executing.waiting;
  await assert.rejects(service.submit('Owner', 'operation-00000002', request), /awaiting/);
  finish.release();
  assert.equal((await first).status, 'SUCCEEDED');
  assert.equal(provider.executions, 1);
});
test('disabled provider and default-denied users cannot create jobs or write', async () => {
  const repo = new MemoryRepo();
  const service = new LineupService(repo, new DisabledEspnLineupProvider(), 10, () => time);
  await assert.rejects(service.submit('Owner', id, request), /not verified/);
  assert.deepEqual(repo.state.operations, {});
  const enabled = setup();
  await assert.rejects(enabled.service.submit('Other', id, request), /not enabled/);
  assert.equal(enabled.provider.executions, 0);
});
test('the service cannot weaken the initial safety cutoff', () => {
  for (const cutoff of [0, 9, NaN, Infinity]) {
    assert.throws(() => new LineupService(new MemoryRepo(), new FakeProvider(), cutoff), /at least ten/);
  }
});
test('failed read-back is UNKNOWN and retains its lock until a fresh confirmation', async () => {
  const { service, repo, provider } = setup();
  provider.onRead = count => {
    if (count <= 2) return snapshot();
    throw new Error('ESPN session expired');
  };
  assert.equal((await service.submit('Owner', id, request)).status, 'UNKNOWN');
  assert.equal(repo.state.rosterLocks['league:5'], id);
  assert.equal((await service.verify('Owner', id)).status, 'UNKNOWN');
  assert.equal(provider.executions, 1);
  provider.onRead = () => saved();
  assert.equal((await service.verify('Owner', id)).status, 'SUCCEEDED');
  assert.deepEqual(repo.state.rosterLocks, {});
});
test('stale and malformed read-back times are UNKNOWN and preserve the lock', async () => {
  for (const fetchedAt of ['2026-10-24T19:59:00Z', '2026-10-24T20:00:06Z', 'invalid']) {
    const { service, repo, provider } = setup();
    provider.onRead = count => count <= 2 ? snapshot() : { ...saved(), fetchedAt };
    assert.equal((await service.submit('Owner', id, request)).status, 'UNKNOWN');
    assert.equal(repo.state.rosterLocks['league:5'], id);
    assert.equal(provider.executions, 1);
  }
});
test('read-back cannot release the mutex while an executor is still sending input', async () => {
  const { service, repo, provider } = setup();
  const executing = gate();
  const finish = gate();
  provider.onExecute = async () => {
    executing.release();
    await finish.waiting;
    throw new Error('late timeout after ESPN saved the move');
  };
  const submission = service.submit('Owner', id, request);
  await executing.waiting;
  provider.onRead = () => saved();
  assert.equal((await service.verify('Owner', id)).status, 'EXECUTING');
  assert.equal(repo.state.rosterLocks['league:5'], id);
  finish.release();
  const final = await submission;
  assert.equal(final.status, 'UNKNOWN');
  assert.equal((await service.verify('Owner', id)).status, 'SUCCEEDED');
  assert.deepEqual(repo.state.rosterLocks, {});
  assert.equal(provider.executions, 1);
});
test('a retried atomic claim callback cannot retain a discarded execution claim', async () => {
  class RetriedClaimRepo extends MemoryRepo {
    mutations = 0;
    override mutate(fn: (state: LineupState) => void): Promise<void> {
      this.mutations++;
      if (this.mutations !== 2) return super.mutate(fn);
      return super.mutate(state => {
        // First optimistic trial succeeds, then a competing worker wins the
        // database compare-and-set. The callback runs again on its new state.
        fn(structuredClone(state));
        state.operations[id].status = 'VALIDATING';
        fn(state);
      });
    }
  }
  const repo = new RetriedClaimRepo();
  const provider = new FakeProvider();
  const service = new LineupService(repo, provider, 10, () => time);
  assert.equal((await service.submit('Owner', id, request)).status, 'VALIDATING');
  assert.equal(provider.reads, 0);
  assert.equal(provider.executions, 0);
});
test('an in-flight matching roster cannot substitute for independent post-execution verification', async () => {
  const { service, repo, provider } = setup();
  const executing = gate();
  const finish = gate();
  provider.onExecute = async () => { executing.release(); await finish.waiting; };
  const submission = service.submit('Owner', id, request);
  await executing.waiting;
  provider.onRead = () => saved();
  assert.equal((await service.verify('Owner', id)).status, 'EXECUTING');
  provider.onRead = () => { throw new Error('session expired after confirmation'); };
  finish.release();
  const final = await submission;
  assert.equal(final.status, 'UNKNOWN');
  assert.equal(final.history.at(-1)?.status, 'UNKNOWN');
  assert.equal(repo.state.rosterLocks['league:5'], id);
});
test('wrong team ESPN reads fail before execution and stay unknown after execution', async () => {
  for (const wrongOnRead of [1, 2, 3]) {
    const { service, repo, provider } = setup();
    provider.onRead = count => {
      const result = count <= 2 ? snapshot() : saved();
      if (count === wrongOnRead) result.teamId = 99;
      return result;
    };
    const result = await service.submit('Owner', id, request);
    assert.equal(result.status, wrongOnRead <= 2 ? 'FAILED' : 'UNKNOWN');
    assert.equal(provider.executions, wrongOnRead <= 2 ? 0 : 1);
    assert.equal(repo.state.rosterLocks['league:5'], wrongOnRead <= 2 ? undefined : id);
  }
});
