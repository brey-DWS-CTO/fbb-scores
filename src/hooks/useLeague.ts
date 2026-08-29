import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchLeagueState,
  fetchPlayerPool,
  verifyPin,
  type Credentials,
  type StateResponse,
} from '../lib/league/api.js';
import { applyOverrides } from '../lib/keeper/engine.js';
import { leagueDataset } from '../lib/league/data.js';
import { applyPlayerPoolToDataset } from '../lib/league/playerPool.js';
import type { LeagueDynamicState } from '../lib/keeper/types.js';

const EMPTY_STATE: LeagueDynamicState = {
  season: 2027,
  keepers: {},
  keepersRevealed: false,
  draft: { picks: {}, startedAt: null },
  locks: { keepersLocked: false },
};

/**
 * Poll the shared league state. `fast` = 3s (TV/draft mode), default 5s.
 * Sends the signed-in identity so the server can un-redact what this viewer
 * is allowed to see (own keepers; everything for the commissioner).
 */
export function useLeagueState(fast = false) {
  const { identity } = useIdentity();
  const query = useQuery<StateResponse>({
    queryKey: ['league-state', identity?.owner ?? 'anon'],
    queryFn: () => fetchLeagueState(identity),
    refetchInterval: fast ? 3000 : 5000,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
  return {
    ...query,
    state: query.data?.state ?? EMPTY_STATE,
    version: query.data?.version ?? 0,
    meta: query.data?.meta ?? null,
  };
}

/**
 * League state + the static dataset with commissioner overrides applied.
 * Use this (not the raw leagueDataset import) anywhere rules are computed.
 */
export function useLeagueData(fast = false) {
  const q = useLeagueState(fast);
  const overrides = q.state.overrides;
  const dataset = useMemo(() => applyOverrides(leagueDataset, overrides), [overrides]);
  return { ...q, dataset };
}

/** Draft-only metadata layered over the keeper dataset from an immutable pool. */
export function useDraftData(fast = false) {
  const league = useLeagueData(fast);
  const poolId = league.state.draft.playerPoolSnapshotId
    ?? league.meta?.playerPool?.activeSnapshotId
    ?? `dataset-${league.dataset.season}`;
  const playerPoolQuery = useQuery({
    queryKey: ['player-pool', poolId],
    queryFn: () => fetchPlayerPool(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const players = playerPoolQuery.data?.snapshot.players;
  const dataset = useMemo(
    () => players ? applyPlayerPoolToDataset(league.dataset, players) : league.dataset,
    [league.dataset, players],
  );
  return { ...league, dataset, playerPoolQuery };
}

/** Push a fresh state response (from a mutation) straight into the cache. */
export function useApplyStateResponse() {
  const qc = useQueryClient();
  const { identity } = useIdentity();
  return useCallback(
    (res: StateResponse) => {
      qc.setQueryData(['league-state', identity?.owner ?? 'anon'], res);
    },
    [qc, identity?.owner],
  );
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

const ID_KEY = 'fbb-identity';

export interface Identity extends Credentials {
  isCommissioner: boolean;
}

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    /* ignore */
  }
  return null;
}

let listeners: Array<() => void> = [];
function notify() {
  for (const l of listeners) l();
}

/**
 * Device identity: which owner this phone belongs to + their PIN.
 * Stored in localStorage, verified against the server on sign-in.
 */
export function useIdentity() {
  const [identity, setIdentityState] = useState<Identity | null>(loadIdentity);

  useEffect(() => {
    const cb = () => setIdentityState(loadIdentity());
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  }, []);

  const signIn = useCallback(async (
    owner: string,
    pin: string,
  ): Promise<{ ok: boolean; error?: string; mustChangePin?: boolean }> => {
    const res = await verifyPin({ owner, pin });
    if (!res.ok) return { ok: false, error: 'Wrong PIN. Ask the commish if you lost yours.' };
    // Temporary PIN: valid, but the caller must run the change-PIN step first
    if (res.mustChangePin) return { ok: false, mustChangePin: true };
    const id: Identity = { owner, pin, isCommissioner: res.isCommissioner };
    try {
      localStorage.setItem(ID_KEY, JSON.stringify(id));
    } catch {
      /* ignore */
    }
    setIdentityState(id);
    notify();
    return { ok: true };
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(ID_KEY);
    } catch {
      /* ignore */
    }
    setIdentityState(null);
    notify();
  }, []);

  return { identity, signIn, signOut };
}
