import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchLeagueState,
  fetchKeeperScenario,
  fetchPlayerPool,
  fetchPublishedHistory,
  sandboxActive,
  actAsOwner,
  apiErrorMessage,
  signOutServer,
  verifyPin,
  type Credentials,
  type LoginSession,
  type StateResponse,
} from '../lib/league/api.js';
import { applyOverrides } from '../lib/keeper/engine.js';
import { datasetWithTransfers, transfersOf } from '../lib/league/pickTrades.js';
import { leagueDataset } from '../lib/league/data.js';
import { leagueHistorySeed } from '../lib/league/historyData.js';
import { applyPlayerPoolToDataset } from '../lib/league/playerPool.js';
import type { LeagueDynamicState } from '../lib/keeper/types.js';
import type { KeeperScenario } from '../lib/league/keeperScenario.js';

const EMPTY_KEEPER_SCENARIO: KeeperScenario = {};

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
  // Accepted pick trades are layered on here, so every page that reads pick
  // ownership through this hook sees the same board.
  const transfers = q.state.pickTransfers;
  const dataset = useMemo(
    () => datasetWithTransfers(applyOverrides(leagueDataset, overrides), transfersOf({ pickTransfers: transfers })),
    [overrides, transfers],
  );
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

export function useKeeperScenario() {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const owner = identity?.owner ?? 'anon';
  const queryKey = useMemo(() => ['keeper-scenario', owner] as const, [owner]);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchKeeperScenario(identity!),
    enabled: identity !== null && !sandboxActive(),
    staleTime: 1000,
    refetchOnWindowFocus: true,
  });
  const setScenario = useCallback((scenario: KeeperScenario) => {
    queryClient.setQueryData(queryKey, {
      season: query.data?.season ?? 2027,
      scenario,
    });
  }, [query.data?.season, queryClient, queryKey]);
  return {
    ...query,
    scenario: query.data?.scenario ?? EMPTY_KEEPER_SCENARIO,
    setScenario,
  };
}

/**
 * The published league history, starting from the committed seed.
 *
 * The seed means the record book is on screen at once and still reads if the
 * API is down, the same fallback the player pool, schedule, and rule book use.
 */
export function useLeagueHistory() {
  const query = useQuery({
    queryKey: ['league-history'],
    queryFn: fetchPublishedHistory,
    staleTime: 60_000,
  });
  return {
    ...query,
    history: query.data?.history ?? leagueHistorySeed,
    published: query.data?.published ?? false,
    revision: query.data?.revision ?? leagueHistorySeed.revision,
    publishedAt: query.data?.publishedAt ?? null,
  };
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
/** Where the commissioner's own identity waits while they act as someone else. */
const REAL_ID_KEY = 'fbb-identity-real';

export interface Identity extends Credentials {
  isCommissioner: boolean;
  /** The address the link went to. Only set on a link sign-in. */
  email?: string;
  /** The commissioner behind this seat, when they are acting as this owner. */
  impersonatedBy?: string;
}

/**
 * A phone signed in on the old build stored an owner and a PIN and no session.
 * We read it back as is and keep using the PIN, so nobody gets thrown out the
 * day links land. Their next link sign-in writes the session over the top.
 */
function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (raw) return JSON.parse(raw) as Identity;
  } catch {
    /* ignore */
  }
  return null;
}

function storeIdentity(id: Identity): void {
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    /* ignore */
  }
}

let listeners: Array<() => void> = [];
function notify() {
  for (const l of listeners) l();
}

/**
 * Device identity: which owner this phone belongs to, plus the session from
 * their sign-in link or, on older phones, their PIN.
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
    storeIdentity(id);
    setIdentityState(id);
    notify();
    return { ok: true };
  }, []);

  /** Sign in from a used link. The server has already checked the token. */
  const signInWithSession = useCallback((result: LoginSession) => {
    const id: Identity = {
      owner: result.owner,
      session: result.session,
      email: result.email,
      isCommissioner: result.isCommissioner,
    };
    storeIdentity(id);
    setIdentityState(id);
    notify();
  }, []);

  /**
   * Take another owner's seat. The commissioner's own identity is parked, not
   * thrown away, so stopping is one tap and never needs another sign-in link.
   */
  const actAs = useCallback(async (target: string): Promise<{ ok: boolean; error?: string }> => {
    const current = loadIdentity();
    if (!current?.isCommissioner) return { ok: false, error: 'Commissioner access required' };
    try {
      const result = await actAsOwner(current, target);
      try {
        localStorage.setItem(REAL_ID_KEY, JSON.stringify(current));
      } catch {
        /* a phone with no storage still gets the seat, it just cannot park */
      }
      const id: Identity = {
        owner: result.owner,
        session: result.session,
        email: result.email,
        isCommissioner: result.isCommissioner,
        impersonatedBy: result.impersonatedBy,
      };
      storeIdentity(id);
      setIdentityState(id);
      notify();
      return { ok: true };
    } catch (caught) {
      return { ok: false, error: apiErrorMessage(caught) };
    }
  }, []);

  /** Give the seat back and become yourself again. */
  const stopActingAs = useCallback(() => {
    let real: Identity | null = null;
    try {
      const raw = localStorage.getItem(REAL_ID_KEY);
      if (raw) real = JSON.parse(raw) as Identity;
      localStorage.removeItem(REAL_ID_KEY);
    } catch {
      /* ignore */
    }
    if (real) {
      storeIdentity(real);
      setIdentityState(real);
    } else {
      // Nothing parked. Signing out is the honest fallback: better a fresh
      // sign-in than leaving somebody stuck in another owner's seat.
      try {
        localStorage.removeItem(ID_KEY);
      } catch {
        /* ignore */
      }
      setIdentityState(null);
    }
    notify();
  }, []);

  const signOut = useCallback(async () => {
    const current = loadIdentity();
    // Drop the local copy first. If the server call hangs or fails, this phone
    // is still signed out, which is the whole point of tapping the button.
    try {
      localStorage.removeItem(ID_KEY);
      // Signing out while acting as someone else must not strand the parked
      // identity for the next person to pick up.
      localStorage.removeItem(REAL_ID_KEY);
    } catch {
      /* ignore */
    }
    setIdentityState(null);
    notify();
    // A PIN sign-in has no session for the server to throw away.
    if (current?.session) {
      try {
        await signOutServer(current);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return { identity, signIn, signInWithSession, signOut, actAs, stopActingAs };
}
