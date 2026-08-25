import axios from 'axios';
import type { KeeperSelection, LeagueDynamicState } from '../keeper/types.js';

export interface StateMeta {
  draftAt: string;
  revealed: boolean;
  /** Keeper counts per owner — always visible even while selections are secret. */
  keeperStatus: Record<string, number>;
  viewer: string | null;
  isCommissioner: boolean;
}

export interface StateResponse {
  state: LeagueDynamicState;
  version: number;
  updatedAt?: string;
  meta?: StateMeta;
}

export interface Credentials {
  owner: string;
  pin: string;
}

const authHeaders = (c: Credentials) => ({ 'x-owner': c.owner, 'x-pin': c.pin });

/* ── Commissioner TEST MODE (sandbox) ────────────────────────────────────────
 * While active, keeper/draft reads and writes stay entirely in localStorage —
 * nothing touches the server — so the commissioner can fill in anyone's
 * keepers and run a fake draft. Pins/overrides remain live. */
const SANDBOX_KEY = 'fbb-sandbox';

interface SandboxDoc {
  state: LeagueDynamicState;
  version: number;
  meta: StateMeta;
}

function readSandbox(): SandboxDoc | null {
  try {
    const raw = localStorage.getItem(SANDBOX_KEY);
    return raw ? (JSON.parse(raw) as SandboxDoc) : null;
  } catch {
    return null;
  }
}

function sandboxResponse(doc: SandboxDoc): StateResponse {
  const keeperStatus: Record<string, number> = {};
  for (const [o, sels] of Object.entries(doc.state.keepers)) keeperStatus[o] = sels.length;
  // In the sandbox the commissioner sees everything, secrecy off
  return {
    state: doc.state,
    version: doc.version,
    meta: { ...doc.meta, revealed: true, isCommissioner: true, keeperStatus },
  };
}

function mutateSandbox(doc: SandboxDoc, fn: (state: LeagueDynamicState) => void): StateResponse {
  fn(doc.state);
  doc.version += 1;
  try {
    localStorage.setItem(SANDBOX_KEY, JSON.stringify(doc));
  } catch {
    /* ignore */
  }
  return sandboxResponse(doc);
}

export function sandboxActive(): boolean {
  return readSandbox() !== null;
}

/** Enter test mode, seeded from the current live state. */
export async function enterSandbox(c: Credentials): Promise<void> {
  const live = await fetchLiveState(c);
  const doc: SandboxDoc = {
    state: structuredClone(live.state),
    version: 1,
    meta: live.meta ?? {
      draftAt: '2026-10-18T14:00:00-07:00',
      revealed: true,
      keeperStatus: {},
      viewer: c.owner,
      isCommissioner: true,
    },
  };
  localStorage.setItem(SANDBOX_KEY, JSON.stringify(doc));
}

export function exitSandbox(): void {
  try {
    localStorage.removeItem(SANDBOX_KEY);
  } catch {
    /* ignore */
  }
}

async function fetchLiveState(credentials?: Credentials | null): Promise<StateResponse> {
  const { data } = await axios.get<StateResponse>('/api/league/state', {
    headers: credentials ? authHeaders(credentials) : undefined,
  });
  return data;
}

/** Pass credentials so the server can un-redact your own (or, as commissioner,
 * everyone's) keepers before draft day. In test mode, returns the sandbox. */
export async function fetchLeagueState(credentials?: Credentials | null): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) return sandboxResponse(sandbox);
  return fetchLiveState(credentials);
}

export async function fetchPinStatus(): Promise<Array<{ owner: string; claimed: boolean }>> {
  const { data } = await axios.get('/api/league/pin-status');
  return data;
}

export async function claimPin(owner: string, pin: string): Promise<void> {
  await axios.post('/api/league/claim-pin', { owner, pin });
}

export async function verifyPin(c: Credentials): Promise<{ ok: boolean; isCommissioner: boolean }> {
  try {
    const { data } = await axios.post('/api/league/verify', {}, { headers: authHeaders(c) });
    return { ok: data.ok === true, isCommissioner: data.isCommissioner === true };
  } catch {
    return { ok: false, isCommissioner: false };
  }
}

export async function saveKeepers(
  c: Credentials,
  owner: string,
  selections: KeeperSelection[],
): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.keepers[owner] = selections;
    });
  }
  const { data } = await axios.put(
    `/api/league/keepers/${encodeURIComponent(owner)}`,
    { selections },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function submitDraftPick(
  c: Credentials,
  pick: { overallPick: number; playerKey: string; playerName: string; isKeeper?: boolean },
): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.draft.picks[String(pick.overallPick)] = {
        playerKey: pick.playerKey,
        playerName: pick.playerName,
        isKeeper: pick.isKeeper === true,
        enteredBy: c.owner,
        timestamp: new Date().toISOString(),
      };
    });
  }
  const { data } = await axios.post('/api/league/draft/pick', pick, { headers: authHeaders(c) });
  return data;
}

export async function clearDraftPick(c: Credentials, overallPick: number): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      delete s.draft.picks[String(overallPick)];
    });
  }
  const { data } = await axios.delete(`/api/league/draft/pick/${overallPick}`, {
    headers: authHeaders(c),
  });
  return data;
}

export async function startDraft(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      if (s.draft.startedAt === null) s.draft.startedAt = new Date().toISOString();
    });
  }
  const { data } = await axios.post('/api/league/draft/start', {}, { headers: authHeaders(c) });
  return data;
}

export async function resetDraft(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.draft.picks = {};
      s.draft.startedAt = null;
    });
  }
  const { data } = await axios.post('/api/league/draft/reset', {}, { headers: authHeaders(c) });
  return data;
}

export async function setLocks(c: Credentials, keepersLocked: boolean): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.locks.keepersLocked = keepersLocked;
    });
  }
  const { data } = await axios.post('/api/league/locks', { keepersLocked }, { headers: authHeaders(c) });
  return data;
}

export async function setOverrides(
  c: Credentials,
  overrides: { cap?: number | null; playerRounds?: Record<string, number | null> },
): Promise<StateResponse> {
  const { data } = await axios.post('/api/league/overrides', overrides, { headers: authHeaders(c) });
  return data;
}

export async function fetchPins(c: Credentials): Promise<Array<{ owner: string; pin: string }>> {
  const { data } = await axios.get('/api/league/pins', { headers: authHeaders(c) });
  return data;
}

export async function setPin(c: Credentials, owner: string, pin: string): Promise<void> {
  await axios.post(`/api/league/pins/${encodeURIComponent(owner)}`, { pin }, { headers: authHeaders(c) });
}

export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string } | undefined;
    return data?.error ?? e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
