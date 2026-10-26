import type { LineupSnapshot } from '../../../src/lib/league/lineup.js';
import type { LineupProvider, TeamBinding } from './provider.js';
import type { LineupOperation, LineupRepository, LineupGrant } from './service.js';

export interface MyTeamReadView {
  enabled: boolean; readEnabled: boolean; executionEnabled: boolean; reason: string;
  snapshot: LineupSnapshot | null; operation: LineupOperation | null; readError?: string;
  destinations: Record<string, string[]>;
}
export class LineupReadRevokedError extends Error {}
function matches(grant: LineupGrant | undefined, owner: string, binding: TeamBinding | null): boolean {
  return grant?.enabled === true && grant.owner === owner && binding !== null
    && grant.leagueId === binding.leagueId && grant.teamId === binding.teamId;
}
/** Authenticated route passes the server-owned binding; no client team input. */
export async function myTeamReadView(repo: LineupRepository, provider: LineupProvider,
  owner: string, binding: TeamBinding | null, readsEnabled: boolean): Promise<MyTeamReadView> {
  const state = await repo.read();
  const grant = state.grants[owner];
  const enabled = matches(grant, owner, binding);
  const readEnabled = enabled && readsEnabled;
  const operation = Object.values(state.operations).filter(op => op.owner === owner)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  let snapshot: LineupSnapshot | null = null;
  let readError: string | undefined;
  if (readEnabled && grant) {
    try {
      snapshot = await provider.read(grant);
      if (snapshot.leagueId !== grant.leagueId || snapshot.teamId !== grant.teamId) {
        snapshot = null; throw new Error('Provider returned a different team.');
      }
    }
    catch { readError = 'Could not refresh the ESPN roster. Check the server session and read configuration. Moves remain disabled.'; }
    if (!matches((await repo.read()).grants[owner], owner, binding)) {
      throw new LineupReadRevokedError('Lineup access was revoked. Refresh your account.');
    }
  }
  // No stale audit snapshot fallback: this response represents a fresh read,
  // or an explicit failure. An old confirmed lineup is not the current roster.
  return { enabled, readEnabled, readError, executionEnabled: provider.executionEnabled,
    reason: provider.reason, snapshot, operation, destinations: {} };
}
