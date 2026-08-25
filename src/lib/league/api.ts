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

/** Pass credentials so the server can un-redact your own (or, as commissioner,
 * everyone's) keepers before draft day. */
export async function fetchLeagueState(credentials?: Credentials | null): Promise<StateResponse> {
  const { data } = await axios.get<StateResponse>('/api/league/state', {
    headers: credentials ? authHeaders(credentials) : undefined,
  });
  return data;
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
  const { data } = await axios.post('/api/league/draft/pick', pick, { headers: authHeaders(c) });
  return data;
}

export async function clearDraftPick(c: Credentials, overallPick: number): Promise<StateResponse> {
  const { data } = await axios.delete(`/api/league/draft/pick/${overallPick}`, {
    headers: authHeaders(c),
  });
  return data;
}

export async function startDraft(c: Credentials): Promise<StateResponse> {
  const { data } = await axios.post('/api/league/draft/start', {}, { headers: authHeaders(c) });
  return data;
}

export async function resetDraft(c: Credentials): Promise<StateResponse> {
  const { data } = await axios.post('/api/league/draft/reset', {}, { headers: authHeaders(c) });
  return data;
}

export async function setLocks(c: Credentials, keepersLocked: boolean): Promise<StateResponse> {
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
