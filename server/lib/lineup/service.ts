import { validateMove, type LineupSnapshot, type MoveRequest } from '../../../src/lib/league/lineup.js';
import type { LineupProvider, TeamBinding } from './provider.js';

export interface LineupGrant extends TeamBinding { owner: string; enabled: boolean }
export type OperationStatus = 'REQUESTED' | 'VALIDATING' | 'EXECUTING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export interface LineupOperation extends TeamBinding {
  id: string; owner: string; request: MoveRequest; status: OperationStatus;
  createdAt: string; updatedAt: string; message: string;
  before?: LineupSnapshot; after?: LineupSnapshot;
  history: Array<{ status: OperationStatus; at: string }>;
}
export interface LineupState {
  grants: Record<string, LineupGrant>;
  operations: Record<string, LineupOperation>;
  /** Never expire an uncertain write's lock on a timer. Reconcile first. */
  rosterLocks: Record<string, string>;
}
export interface LineupRepository {
  read(): Promise<LineupState>;
  mutate(fn: (state: LineupState) => void): Promise<void>;
}
export function emptyLineupState(): LineupState { return { grants: {}, operations: {}, rosterLocks: {} }; }
const teamKey = (team: TeamBinding) => `${team.leagueId}:${team.teamId}`;
function rosterContent(snapshot: LineupSnapshot): string {
  return JSON.stringify({ ...snapshot, fetchedAt: undefined,
    slots: [...snapshot.slots].sort((a, b) => a.id.localeCompare(b.id)),
    players: snapshot.players.map(player => ({ ...player, eligibleSlotIds: [...player.eligibleSlotIds].sort((a, b) => a - b) })).sort((a, b) => a.id - b.id),
  });
}
function authorized(state: LineupState, owner: string, team: TeamBinding): void {
  const grant = state.grants[owner];
  if (!grant?.enabled || grant.leagueId !== team.leagueId || grant.teamId !== team.teamId) throw new Error('Lineup access is not enabled for this team.');
}
function sameTeam(snapshot: LineupSnapshot, team: TeamBinding): void {
  if (snapshot.leagueId !== team.leagueId || snapshot.teamId !== team.teamId) throw new Error('ESPN returned a different team.');
}
export class LineupService {
  constructor(privateRepo: LineupRepository, privateProvider: LineupProvider, cutoffMinutes = 10, clock = () => new Date()) {
    this.repo = privateRepo; this.provider = privateProvider; this.cutoff = cutoffMinutes; this.clock = clock;
    if (!Number.isFinite(cutoffMinutes) || cutoffMinutes < 10) throw new Error('Lineup cutoff must be at least ten minutes.');
  }
  private repo: LineupRepository;
  private provider: LineupProvider;
  private cutoff: number;
  private clock: () => Date;

  async submit(owner: string, id: string, request: MoveRequest): Promise<LineupOperation> {
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new Error('Invalid operation id.');
    let claimed = false;
    await this.repo.mutate(state => {
      const existing = state.operations[id];
      if (existing) {
        if (existing.owner !== owner || JSON.stringify(existing.request) !== JSON.stringify(request)) throw new Error('Operation id was already used.');
        return;
      }
      const grant = state.grants[owner];
      if (!grant) throw new Error('Lineup access is not enabled.');
      authorized(state, owner, grant);
      if (!this.provider.executionEnabled) throw new Error(this.provider.reason);
      if (state.rosterLocks[teamKey(grant)]) throw new Error('This roster has an operation awaiting completion or verification.');
      if (Object.keys(state.operations).length >= 2000) throw new Error('Archive confirmed lineup audit records before continuing.');
      const at = this.clock().toISOString();
      state.operations[id] = { id, owner, leagueId: grant.leagueId, teamId: grant.teamId, request,
        status: 'REQUESTED', createdAt: at, updatedAt: at, message: 'Move requested.', history: [{ status: 'REQUESTED', at }] };
      state.rosterLocks[teamKey(grant)] = id;
    });
    // An atomic compare-and-set makes duplicate requests return the same job.
    await this.repo.mutate(state => {
      claimed = false;
      const op = state.operations[id];
      if (op?.owner === owner && op.status === 'REQUESTED') {
        this.transition(op, 'VALIDATING', 'Checking the ESPN lineup.'); claimed = true;
      }
    });
    if (!claimed) return this.get(owner, id);
    let started = false;
    try {
      let op = await this.get(owner, id);
      const before = await this.provider.read(op);
      sameTeam(before, op);
      validateMove(before, request, this.clock(), this.cutoff);
      if (!await this.provider.canExecute(before, request)) throw new Error('ESPN provider cannot safely execute this move.');
      // Refresh immediately before execution. The revision covers eligibility,
      // scoring period, lock configuration, and all slot assignments.
      const fresh = await this.provider.read(op);
      sameTeam(fresh, op);
      validateMove(fresh, request, this.clock(), this.cutoff);
      if (rosterContent(fresh) !== rosterContent(before)) throw new Error('ESPN roster changed. Refresh and select again.');
      if (!await this.provider.canExecute(fresh, request)) throw new Error('ESPN no longer offers this move.');
      await this.repo.mutate(state => {
        op = state.operations[id];
        authorized(state, owner, op);
        if (!this.provider.executionEnabled) throw new Error(this.provider.reason);
        if (op.status !== 'VALIDATING' || state.rosterLocks[teamKey(op)] !== id) throw new Error('Operation is no longer executable.');
        validateMove(fresh, request, this.clock(), this.cutoff);
        op.before = fresh;
        this.transition(op, 'EXECUTING', 'Moving…');
      });
      started = true;
      await this.provider.execute(fresh, request);
      await this.repo.mutate(state => {
        const current = state.operations[id];
        if (current.status === 'SUCCEEDED' || current.status === 'FAILED') return;
        this.transition(current, 'VERIFYING', 'Checking the saved ESPN lineup.');
      });
      await this.verify(owner, id);
    } catch {
      // Never store raw provider errors, which can contain cookies or HTTP config.
      await this.repo.mutate(state => {
        const op = state.operations[id];
        if (op.status === 'SUCCEEDED' || op.status === 'FAILED') return;
        this.transition(op, started ? 'UNKNOWN' : 'FAILED', started
          ? 'ESPN outcome is unknown. Refresh to verify; do not repeat the move.'
          : 'Move was not submitted. Access, lineup, session, or lock validation failed.');
        if (!started) delete state.rosterLocks[teamKey(op)];
      });
    }
    return this.get(owner, id);
  }

  async get(owner: string, id: string): Promise<LineupOperation> {
    const op = (await this.repo.read()).operations[id];
    if (!op || op.owner !== owner) throw new Error('Lineup operation not found.');
    return op;
  }

  /** Read-only reconciliation. Never repeats an execution, even after a crash. */
  async verify(owner: string, id: string): Promise<LineupOperation> {
    const op = await this.get(owner, id);
    // A live executor still owns its mutex even if a concurrent read happens
    // to match. It may still be sending input. Only settle/reconcile afterward.
    if (!['VERIFYING', 'UNKNOWN'].includes(op.status) || !op.before) return op;
    let after: LineupSnapshot;
    try { after = await this.provider.read(op); sameTeam(after, op); }
    catch { return this.unresolved(owner, id); }
    const age = this.clock().getTime() - Date.parse(after.fetchedAt);
    if (!Number.isFinite(age) || age < -5000 || age > 30000) return this.unresolved(owner, id);
    const expected = validateMove(op.before, op.request, new Date(op.before.fetchedAt), 0).assignments;
    // Confirm the entire roster, including all unchanged slots and the period.
    const expectedSlots = op.before.slots.map(slot => {
      const incoming = expected.find(move => move.toSlotId === slot.id);
      const outgoing = expected.some(move => move.fromSlotId === slot.id);
      return { id: slot.id, playerId: incoming?.playerId ?? (outgoing ? null : slot.playerId) };
    });
    const confirmed = after.scoringPeriodId === op.before.scoringPeriodId && after.slots.length === expectedSlots.length
      && expectedSlots.every(slot => after.slots.some(actual => actual.id === slot.id && actual.playerId === slot.playerId));
    await this.repo.mutate(state => {
      const current = state.operations[id];
      // A completed result cannot be downgraded by a concurrent reconciliation.
      if (current.status === 'SUCCEEDED' || current.status === 'FAILED') return;
      current.after = after;
      this.transition(current, confirmed ? 'SUCCEEDED' : 'UNKNOWN', confirmed
        ? 'ESPN confirmed the saved lineup.' : 'ESPN differs from the requested lineup. Further moves are blocked pending review.');
      if (confirmed) delete state.rosterLocks[teamKey(current)];
    });
    return this.get(owner, id);
  }
  private transition(op: LineupOperation, status: OperationStatus, message: string): void {
    const changed = op.status !== status;
    op.status = status; op.updatedAt = this.clock().toISOString(); op.message = message;
    if (changed) op.history.push({ status, at: op.updatedAt });
  }
  private async unresolved(owner: string, id: string): Promise<LineupOperation> {
    await this.repo.mutate(state => {
      const op = state.operations[id];
      if (op.status === 'SUCCEEDED' || op.status === 'FAILED' || op.status === 'UNKNOWN') return;
      this.transition(op, 'UNKNOWN', 'Could not verify the ESPN outcome. Further moves remain blocked.');
    });
    return this.get(owner, id);
  }
}
