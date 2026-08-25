import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLeagueState, verifyPin, type Credentials, type StateResponse } from '../lib/league/api.js';
import type { LeagueDynamicState } from '../lib/keeper/types.js';

const EMPTY_STATE: LeagueDynamicState = {
  season: 2027,
  keepers: {},
  draft: { picks: {}, startedAt: null },
  locks: { keepersLocked: false },
};

/** Poll the shared league state. `fast` = 3s (TV/draft mode), default 5s. */
export function useLeagueState(fast = false) {
  const query = useQuery<StateResponse>({
    queryKey: ['league-state'],
    queryFn: fetchLeagueState,
    refetchInterval: fast ? 3000 : 5000,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });
  return {
    ...query,
    state: query.data?.state ?? EMPTY_STATE,
    version: query.data?.version ?? 0,
  };
}

/** Push a fresh state response (from a mutation) straight into the cache. */
export function useApplyStateResponse() {
  const qc = useQueryClient();
  return useCallback(
    (res: StateResponse) => {
      qc.setQueryData(['league-state'], res);
    },
    [qc],
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

  const signIn = useCallback(async (owner: string, pin: string): Promise<{ ok: boolean; error?: string }> => {
    const res = await verifyPin({ owner, pin });
    if (!res.ok) return { ok: false, error: 'Wrong PIN. Ask the commissioner if you lost yours.' };
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
