import { useCallback } from 'react';
import { teamByOwner } from '../lib/league/data.js';
import { teamNameOf } from '../lib/league/teamNames.js';
import { useLeagueState } from './useLeague.js';

/**
 * The team name to show for an owner: the name ESPN last reported, else the
 * committed one. Every screen that shows a team name calls this, so a name is
 * never fresh in one place and stale in another.
 */
export function useTeamName(): (owner: string | null | undefined) => string {
  const { state } = useLeagueState();
  const overrides = state.teamNames;
  return useCallback(
    (owner: string | null | undefined) =>
      owner ? teamNameOf(teamByOwner.get(owner), overrides) : '',
    [overrides],
  );
}
