import assert from 'node:assert/strict';
import test from 'node:test';
import { myTeamReadView, LineupReadRevokedError } from '../server/lib/lineup/readView.js';
import { DisabledEspnLineupProvider } from '../server/lib/lineup/provider.js';
import { emptyLineupState, type LineupRepository } from '../server/lib/lineup/service.js';
import type { LineupSnapshot } from '../src/lib/league/lineup.js';

const binding = { leagueId: '123456', teamId: 7 };
function snapshot(): LineupSnapshot {
  return { ...binding, scoringPeriodId: 6, revision: 'test', fetchedAt: new Date().toISOString(),
    lockMode: 'individual', periodLockAt: null, slots: [{ id: '5:0', label: 'G', eligibilityId: 5, playerId: 1 }],
    players: [{ id: 1, name: 'Fixture Player', eligibleSlotIds: [5], locked: false, lockAt: null }] };
}
function setup() {
  const state = emptyLineupState();
  state.grants.Owner = { ...binding, owner: 'Owner', enabled: true };
  const repo: LineupRepository = { async read() { return structuredClone(state); }, async mutate(fn) { fn(state); } };
  class ReadProvider extends DisabledEspnLineupProvider {
    reads = 0;
    result = snapshot();
    beforeReturn?: () => void;
    fail = false;
    override async read(): Promise<LineupSnapshot> {
      this.reads++; this.beforeReturn?.();
      if (this.fail) throw new Error('secret-cookie-must-not-escape');
      return this.result;
    }
  }
  return { state, repo, provider: new ReadProvider() };
}
test('fresh read is available only with grant, configured binding, and read opt-in', async () => {
  const { state, repo, provider } = setup();
  const result = await myTeamReadView(repo, provider, 'Owner', binding, true);
  assert.equal(result.enabled, true);
  assert.equal(result.readEnabled, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.snapshot?.teamId, 7);
  assert.deepEqual(result.destinations, {});
  for (const [owner, configured, enabled] of [
    ['Other', binding, true], ['Owner', null, true], ['Owner', { ...binding, teamId: 8 }, true],
    ['Owner', { ...binding, leagueId: 'other' }, true], ['Owner', binding, false],
  ] as const) {
    const before = provider.reads;
    const denied = await myTeamReadView(repo, provider, owner, configured, enabled);
    assert.equal(denied.snapshot, null);
    assert.equal(provider.reads, before);
  }
  state.grants.Owner.enabled = false;
  assert.equal((await myTeamReadView(repo, provider, 'Owner', binding, true)).snapshot, null);
});
test('revocation or team reassignment during an ESPN read prevents returning its private data', async () => {
  for (const change of ['revoke', 'reassign', 'owner']) {
    const { state, repo, provider } = setup();
    provider.beforeReturn = () => {
      if (change === 'revoke') state.grants.Owner.enabled = false;
      if (change === 'reassign') state.grants.Owner.teamId = 8;
      if (change === 'owner') state.grants.Owner.owner = 'Other';
    };
    await assert.rejects(myTeamReadView(repo, provider, 'Owner', binding, true), LineupReadRevokedError);
  }
});
test('failed or wrong-team reads return no roster and never expose provider exceptions', async () => {
  const { repo, provider } = setup();
  provider.fail = true;
  const failed = await myTeamReadView(repo, provider, 'Owner', binding, true);
  assert.equal(failed.snapshot, null);
  assert.ok(failed.readError);
  assert.equal(JSON.stringify(failed).includes('secret-cookie'), false);
  provider.fail = false;
  provider.result.teamId = 8;
  assert.equal((await myTeamReadView(repo, provider, 'Owner', binding, true)).snapshot, null);
});
