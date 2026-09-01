import axios from 'axios';
import type { KeeperSelection, LeagueDynamicState } from '../keeper/types.js';
import type {
  EspnPlayerPoolPlayer,
  PlayerPoolRefreshPreview,
  PlayerPoolSnapshot,
} from './playerPool.js';
import type { KeeperScenario } from './keeperScenario.js';
import type { Rulebook } from './rulebook.js';
import type { RulebookSignature } from './rulebookSignatures.js';
import type { Poll, PollKind } from './polls.js';
import type {
  LeagueScheduleMapping,
  RawScheduleSource,
  ScheduleRefreshPreview,
  ScheduleSourceStatus,
  StoredScheduleSnapshot,
} from './schedule.js';

export interface StateMeta {
  draftAt: string;
  revealed: boolean;
  /** Keeper counts per owner — always visible even while selections are secret. */
  keeperStatus: Record<string, number>;
  playerPool?: {
    activeSnapshotId: string;
    draftSnapshotId: string | null;
  };
  schedule?: {
    activeSnapshotId: string;
  };
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

export interface PlayerPoolCandidateInput {
  sourceSeason: number;
  fetchedAt: string;
  players: EspnPlayerPoolPlayer[];
}

export interface PlayerPoolPreviewResponse {
  currentSnapshotId: string;
  candidateSnapshotId: string;
  fingerprint: string;
  preview: PlayerPoolRefreshPreview;
}

export interface FetchedPlayerPoolPreviewResponse extends PlayerPoolPreviewResponse {
  candidate: PlayerPoolCandidateInput;
}

export interface KeeperScenarioResponse {
  season: number;
  scenario: KeeperScenario;
}

export interface ScheduleCandidateInput {
  source: RawScheduleSource;
  mapping: LeagueScheduleMapping[];
  status: ScheduleSourceStatus;
}

export interface SchedulePreviewResponse {
  currentSnapshotId: string;
  candidateSnapshotId: string;
  fingerprint: string;
  preview: ScheduleRefreshPreview;
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

export async function verifyPin(
  c: Credentials,
): Promise<{ ok: boolean; isCommissioner: boolean; mustChangePin: boolean }> {
  try {
    const { data } = await axios.post('/api/league/verify', {}, { headers: authHeaders(c) });
    return {
      ok: data.ok === true,
      isCommissioner: data.isCommissioner === true,
      mustChangePin: data.mustChangePin === true,
    };
  } catch {
    return { ok: false, isCommissioner: false, mustChangePin: false };
  }
}

/** Replace your own PIN (used for the forced change on a temporary PIN). */
export async function changePin(c: Credentials, newPin: string): Promise<void> {
  await axios.post('/api/league/change-pin', { pin: newPin }, { headers: authHeaders(c) });
}

export async function fetchKeeperScenario(c: Credentials): Promise<KeeperScenarioResponse> {
  const { data } = await axios.get<KeeperScenarioResponse>('/api/league/keeper-scenario', {
    headers: authHeaders(c),
  });
  return data;
}

export async function saveKeeperScenarioTarget(
  c: Credentials,
  target: string,
  selections: KeeperSelection[],
): Promise<KeeperScenarioResponse> {
  const { data } = await axios.put<KeeperScenarioResponse>(
    `/api/league/keeper-scenario/${encodeURIComponent(target)}`,
    { selections },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function resetKeeperScenarioTarget(
  c: Credentials,
  target: string,
): Promise<KeeperScenarioResponse> {
  const { data } = await axios.delete<KeeperScenarioResponse>(
    `/api/league/keeper-scenario/${encodeURIComponent(target)}`,
    { headers: authHeaders(c) },
  );
  return data;
}

export async function clearKeeperScenario(c: Credentials): Promise<KeeperScenarioResponse> {
  const { data } = await axios.delete<KeeperScenarioResponse>('/api/league/keeper-scenario', {
    headers: authHeaders(c),
  });
  return data;
}

export async function fetchSchedule(
  c: Credentials,
): Promise<{ snapshot: StoredScheduleSnapshot; fallback: boolean }> {
  const { data } = await axios.get('/api/league/schedule', { headers: authHeaders(c) });
  return data;
}

export async function previewSchedule(
  c: Credentials,
  candidate: ScheduleCandidateInput,
): Promise<SchedulePreviewResponse> {
  const { data } = await axios.post('/api/league/schedule/preview', candidate, {
    headers: authHeaders(c),
  });
  return data;
}

export async function acceptSchedule(
  c: Credentials,
  candidate: ScheduleCandidateInput,
  preview: Pick<SchedulePreviewResponse, 'currentSnapshotId' | 'fingerprint'>,
): Promise<StateResponse & { snapshot: StoredScheduleSnapshot }> {
  const { data } = await axios.post(
    '/api/league/schedule/accept',
    {
      ...candidate,
      expectedCurrentSnapshotId: preview.currentSnapshotId,
      fingerprint: preview.fingerprint,
    },
    { headers: authHeaders(c) },
  );
  return data;
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

export async function setKeeperVisibility(
  c: Credentials,
  revealed: boolean,
): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.keepersRevealed = revealed;
    });
  }
  const { data } = await axios.post(
    '/api/league/keeper-visibility',
    { revealed },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function submitDraftPick(
  c: Credentials,
  pick: {
    overallPick: number;
    playerKey: string;
    playerName: string;
    proTeam?: string;
    positions?: string[];
    isKeeper?: boolean;
  },
): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.draft.picks[String(pick.overallPick)] = {
        playerKey: pick.playerKey,
        playerName: pick.playerName,
        proTeam: pick.proTeam,
        positions: pick.positions,
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
      if (s.draft.startedAt === null) {
        s.draft.playerPoolSnapshotId =
          s.playerPool?.activeSnapshotId ?? `dataset-${s.season}`;
        s.draft.startedAt = new Date().toISOString();
      }
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
      s.draft.playerPoolSnapshotId = null;
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

export async function fetchPlayerPool(
  c?: Credentials | null,
): Promise<{ snapshot: PlayerPoolSnapshot; fallback: boolean; draftSnapshotId: string | null }> {
  const { data } = await axios.get('/api/league/player-pool', {
    headers: c ? authHeaders(c) : undefined,
  });
  return data;
}

export async function fetchEspnPlayerPoolPreview(
  c: Credentials,
): Promise<FetchedPlayerPoolPreviewResponse> {
  const { data } = await axios.post('/api/league/player-pool/fetch-preview', {}, {
    headers: authHeaders(c),
  });
  return data;
}

export async function previewPlayerPool(
  c: Credentials,
  candidate: PlayerPoolCandidateInput,
): Promise<PlayerPoolPreviewResponse> {
  const { data } = await axios.post('/api/league/player-pool/preview', candidate, {
    headers: authHeaders(c),
  });
  return data;
}

export async function acceptPlayerPool(
  c: Credentials,
  candidate: PlayerPoolCandidateInput,
  preview: Pick<PlayerPoolPreviewResponse, 'currentSnapshotId' | 'fingerprint'>,
): Promise<StateResponse & { snapshot: PlayerPoolSnapshot }> {
  const { data } = await axios.post(
    '/api/league/player-pool/accept',
    {
      ...candidate,
      expectedCurrentSnapshotId: preview.currentSnapshotId,
      fingerprint: preview.fingerprint,
    },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function fetchPins(
  c: Credentials,
): Promise<Array<{ owner: string; pin: string; temp?: boolean }>> {
  const { data } = await axios.get('/api/league/pins', { headers: authHeaders(c) });
  return data;
}

export async function setPin(c: Credentials, owner: string, pin: string): Promise<void> {
  await axios.post(`/api/league/pins/${encodeURIComponent(owner)}`, { pin }, { headers: authHeaders(c) });
}

// ─── Rule book draft (commissioner only) ─────────────────────────────────────

export interface RulebookDraftResponse {
  book: Rulebook;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** True when no draft is stored yet and this is the committed seed. */
  seeded: boolean;
}

export async function fetchRulebookDraft(c: Credentials): Promise<RulebookDraftResponse> {
  const { data } = await axios.get<RulebookDraftResponse>('/api/league/rulebook/draft', {
    headers: authHeaders(c),
  });
  return data;
}

export interface RulebookSaveResponse {
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export async function saveRulebookDraft(
  c: Credentials,
  book: Rulebook,
  expectedVersion: number,
): Promise<RulebookSaveResponse> {
  const { data } = await axios.put<RulebookSaveResponse>(
    '/api/league/rulebook/draft',
    { book, expectedVersion },
    { headers: authHeaders(c) },
  );
  return data;
}

/** Throw the draft away and go back to the committed rule book. */
export async function resetRulebookDraft(c: Credentials): Promise<RulebookDraftResponse> {
  const { data } = await axios.delete<RulebookDraftResponse>('/api/league/rulebook/draft', {
    headers: authHeaders(c),
  });
  return { ...data, updatedAt: null, updatedBy: null };
}

/** True when a save was refused because someone else saved first. */
export function isStaleDraftError(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 409;
}

// ─── Published rule book (readable by anyone) ────────────────────────────────

export interface PublishedRulebookResponse {
  book: Rulebook;
  versionId: string | null;
  revision: number;
  publishedAt: string | null;
  publishedBy: string | null;
  notes: string;
  published: boolean;
}

export async function fetchPublishedRulebook(): Promise<PublishedRulebookResponse> {
  const { data } = await axios.get<PublishedRulebookResponse>('/api/league/rulebook');
  return data;
}

export interface RulebookVersionSummary {
  id: string;
  season: number;
  revision: number;
  fingerprint: string;
  notes: string;
  publishedAt: string;
  publishedBy: string;
}

export async function fetchRulebookVersions(): Promise<RulebookVersionSummary[]> {
  const { data } = await axios.get<RulebookVersionSummary[]>('/api/league/rulebook/versions');
  return data;
}

export async function fetchRulebookVersion(
  id: string,
): Promise<RulebookVersionSummary & { book: Rulebook }> {
  const { data } = await axios.get(`/api/league/rulebook/versions/${encodeURIComponent(id)}`);
  return data;
}

export interface PublishRulebookResponse {
  versionId: string;
  revision: number;
  publishedAt: string;
  publishedBy: string;
  /** Passed votes that were already in the draft and went out with it. */
  polls: string[];
}

// ─── Signatures ──────────────────────────────────────────────────────────────

export interface RulebookSignaturesResponse {
  versionId: string | null;
  currentVersionId: string | null;
  revision: number | null;
  fingerprint: string | null;
  acknowledgement: string;
  members: string[];
  signed: RulebookSignature[];
  missing: string[];
  complete: boolean;
}

/** Anyone may read this, signed in or not, like the book itself. */
export async function fetchRulebookSignatures(
  versionId?: string,
): Promise<RulebookSignaturesResponse> {
  const { data } = await axios.get<RulebookSignaturesResponse>('/api/league/rulebook/signatures', {
    params: versionId ? { versionId } : undefined,
  });
  return data;
}

/** Sign the published revision. The server takes the signer from the PIN. */
export async function signRulebook(
  c: Credentials,
  versionId: string,
  fingerprint: string,
): Promise<{
  signature: RulebookSignature;
  signed: RulebookSignature[];
  missing: string[];
  complete: boolean;
}> {
  const { data } = await axios.post(
    '/api/league/rulebook/sign',
    { versionId, fingerprint },
    { headers: authHeaders(c) },
  );
  return data;
}

/**
 * Freeze the stored draft as a new published version.
 * `fingerprint` must be the one the commissioner previewed, so the server can
 * refuse if the draft moved underneath them.
 */
export async function publishRulebook(
  c: Credentials,
  fingerprint: string,
  notes: string,
): Promise<PublishRulebookResponse> {
  const { data } = await axios.post<PublishRulebookResponse>(
    '/api/league/rulebook/publish',
    { fingerprint, notes },
    { headers: authHeaders(c) },
  );
  return data;
}

// ─── Votes ───────────────────────────────────────────────────────────────────

export interface PollsResponse {
  polls: Poll[];
  you: { owner: string; hasLaunched: boolean; canLaunch: boolean };
}

export async function fetchPolls(c: Credentials): Promise<PollsResponse> {
  const { data } = await axios.get<PollsResponse>('/api/league/polls', {
    headers: authHeaders(c),
  });
  return data;
}

export async function openPoll(
  c: Credentials,
  input: { kind: PollKind; title: string; detail: string; affects: string[] },
): Promise<Poll> {
  const { data } = await axios.post<Poll>('/api/league/polls', input, {
    headers: authHeaders(c),
  });
  return data;
}

export interface AmendmentDraftResponse {
  book: Rulebook;
  version: number;
  /** The rules the commissioner now has to write. */
  focusIds: string[];
  note: string;
}

/** Commissioner only: seed the rule book draft from a vote that passed. */
export async function amendFromPoll(
  c: Credentials,
  pollId: string,
): Promise<AmendmentDraftResponse> {
  const { data } = await axios.post<AmendmentDraftResponse>(
    `/api/league/polls/${encodeURIComponent(pollId)}/amend`,
    {},
    { headers: authHeaders(c) },
  );
  return data;
}

export async function castPollVote(
  c: Credentials,
  pollId: string,
  choice: 'yes' | 'no',
): Promise<Poll> {
  const { data } = await axios.post<Poll>(
    `/api/league/polls/${encodeURIComponent(pollId)}/vote`,
    { choice },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function closePollById(
  c: Credentials,
  pollId: string,
  cancel = false,
): Promise<Poll> {
  const { data } = await axios.post<Poll>(
    `/api/league/polls/${encodeURIComponent(pollId)}/close`,
    { cancel },
    { headers: authHeaders(c) },
  );
  return data;
}

export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string } | undefined;
    return data?.error ?? e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
