import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from './useLeague.js';
import { fetchWatch, type WatchResponse } from '../lib/league/api.js';
import type { FavoritesByOwner, HouseParty } from '../lib/league/houseParty.js';

/**
 * The WATCH read: games, favorites, rosters and parties in one answer. Every
 * party or favorites write puts its answer straight into this cache, so the
 * screen moves before the next poll.
 */
export function useWatch(enabled = true) {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const owner = identity?.owner ?? 'anon';
  const queryKey = useMemo(() => ['watch', owner] as const, [owner]);
  const query = useQuery<WatchResponse>({
    queryKey,
    queryFn: () => fetchWatch(identity as NonNullable<typeof identity>),
    enabled: enabled && identity !== null,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: true,
  });

  const putParty = useCallback((party: HouseParty) => {
    queryClient.setQueryData<WatchResponse>(queryKey, (current) => {
      if (!current) return current;
      const others = current.parties.filter((row) => row.id !== party.id);
      return { ...current, parties: [party, ...others] };
    });
  }, [queryClient, queryKey]);

  const putFavorites = useCallback((favorites: FavoritesByOwner) => {
    queryClient.setQueryData<WatchResponse>(queryKey, (current) => (current ? { ...current, favorites } : current));
    queryClient.setQueryData<FavoritesByOwner>(['favorites'], favorites);
  }, [queryClient, queryKey]);

  const replace = useCallback((data: WatchResponse) => {
    queryClient.setQueryData<WatchResponse>(queryKey, data);
  }, [queryClient, queryKey]);

  return { ...query, putParty, putFavorites, replace };
}
