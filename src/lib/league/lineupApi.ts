import axios from 'axios';
import { sandboxActive, type Credentials } from './api.js';
import type { LineupSnapshot, MoveRequest } from './lineup.js';

export interface LineupOperation {
  id: string;
  status: 'REQUESTED' | 'VALIDATING' | 'EXECUTING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  message?: string;
  undo?: MoveRequest;
}
export interface MyTeamResponse {
  enabled: boolean;
  executionEnabled: boolean;
  reason: string;
  snapshot: LineupSnapshot | null;
  operation: LineupOperation | null;
  safetyCutoffMinutes?: number;
  /** Server provider-approved slot instances, keyed by player id. Missing means deny. */
  destinations?: Record<string, string[]>;
}
export interface MoveResponse { operation: LineupOperation; snapshot?: LineupSnapshot | null }
export interface LineupGrant { owner: string; enabled: boolean; leagueId: string; teamId: number }
export interface LineupAccessResponse { grants: LineupGrant[]; owners: string[] }
const headers = (credentials: Credentials) => credentials.session
  ? { 'x-session': credentials.session }
  : { 'x-owner': credentials.owner, 'x-pin': credentials.pin ?? '' };
function options(credentials: Credentials) {
  if (sandboxActive()) throw new Error('Lineup management is unavailable in test mode.');
  return { headers: headers(credentials) };
}
export async function fetchMyTeam(credentials: Credentials): Promise<MyTeamResponse> {
  const response = await axios.get<MyTeamResponse>('/api/league/my-team', options(credentials));
  return response.data;
}
export async function submitLineupMove(credentials: Credentials, request: MoveRequest & { id: string }): Promise<MoveResponse> {
  const response = await axios.post<MoveResponse>('/api/league/my-team/moves', request, options(credentials));
  return response.data;
}
export async function fetchLineupOperation(credentials: Credentials, id: string): Promise<MoveResponse> {
  const response = await axios.get<MoveResponse>(`/api/league/my-team/moves/${encodeURIComponent(id)}`, options(credentials));
  return response.data;
}
export async function fetchLineupAccess(credentials: Credentials): Promise<LineupAccessResponse> {
  const response = await axios.get<LineupAccessResponse>('/api/league/lineup-access', options(credentials));
  return response.data;
}
export async function saveLineupAccess(credentials: Credentials, grant: LineupGrant): Promise<void> {
  await axios.put(`/api/league/lineup-access/${encodeURIComponent(grant.owner)}`, {
    enabled: grant.enabled, leagueId: grant.leagueId, teamId: grant.teamId,
  }, options(credentials));
}
