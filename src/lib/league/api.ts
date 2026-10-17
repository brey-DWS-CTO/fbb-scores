import type { ProjectionEdit } from './projectionEdits.js';
import type { MockResultRecord } from './mockGrade.js';
import type { MockStatRow } from './mockStats.js';
import type { MockTrade } from './mockTrades.js';
import type { NbaWatch } from './nbaWatch.js';
import axios from 'axios';
import { TEST_DRAFT_HEADER, type TestDraftMeta } from './testDraft.js';
import { callClock, clockExpired, isPaused, pauseClock, pickTiming, resumeClock, startPickClock, yieldPick } from './draftClock.js';
import type {
  KeeperSelection,
  LeagueDynamicState,
  PickRef,
  PickTradeProposal,
  PickTransfer,
} from '../keeper/types.js';
import type { TradePreview } from './pickTrades.js';
import type {
  EspnPlayerPoolPlayer,
  PlayerPoolRefreshPreview,
  PlayerPoolSnapshot,
} from './playerPool.js';
import type {
  DraftRankingRefreshPreview,
  DraftRankingSnapshot,
  EspnDraftRankingPlayer,
  ScoringItem,
} from './draftRankings.js';
import type { KeeperScenario } from './keeperScenario.js';
import type { Rulebook } from './rulebook.js';
import type {
  HistoryConflict,
  HistoryDiff,
  HistoryProblem,
  LeagueHistory,
} from './history.js';
import type { ImportProblem, TeamMapping } from './historyImport.js';
import type { RulebookSignature } from './rulebookSignatures.js';
import type { DuesAction, DuesBoard } from './dues.js';
import type { Poll, PollKind } from './polls.js';
import type {
  AchievementId,
  AchievementStanding,
  OwnerFacts,
  RevealCheck,
} from './achievements.js';
import type { PropBet, PropInput, PropSide } from './propBets.js';
import type {
  LeagueScheduleMapping,
  RawScheduleSource,
  ScheduleRefreshPreview,
  ScheduleSourceStatus,
  StoredScheduleSnapshot,
} from './schedule.js';
import type { EspnTeamName, TeamNameRefreshPreview } from './teamNames.js';

export interface StateMeta {
  /** Pending pick-trade offers waiting on this viewer. Drives the nav badge. */
  pendingTrades?: number;
  /** Keeper reveals this viewer has earned and not spent. Drives the VAULT badge. */
  revealsReady?: number;
  /** The commissioner turned off his view of other teams' keepers. */
  commishBlind?: boolean;
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
  draftRankings?: {
    activeSnapshotId: string;
  };
  viewer: string | null;
  isCommissioner: boolean;
  /** Whether a shared test draft is open, and whether this reply is it. */
  testDraft?: TestDraftMeta;
}

export interface StateResponse {
  state: LeagueDynamicState;
  version: number;
  updatedAt?: string;
  meta?: StateMeta;
}

export interface Credentials {
  owner: string;
  /** Old PIN sign-in. Kept until every owner has used an emailed link once. */
  pin?: string;
  /** Token from an emailed sign-in link. Preferred when we have one. */
  session?: string;
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

export interface TeamNameCandidateInput {
  sourceSeason: number;
  fetchedAt: string;
  teams: EspnTeamName[];
}

export interface DraftRankingCandidateInput {
  sourceSeason: number;
  /** `espn-kona` from the fetch; `manual` for a set loaded by hand. */
  source: 'espn-kona' | 'manual';
  sourceUrl: string | null;
  fetchedAt: string;
  scoringItems: ScoringItem[];
  players: EspnDraftRankingPlayer[];
}

export interface DraftRankingPreviewResponse {
  currentSnapshotId: string;
  candidateSnapshotId: string;
  fingerprint: string;
  preview: DraftRankingRefreshPreview;
}

export interface FetchedDraftRankingPreviewResponse extends DraftRankingPreviewResponse {
  candidate: DraftRankingCandidateInput;
}

export interface TeamNamePreviewResponse {
  candidate: TeamNameCandidateInput;
  fingerprint: string;
  preview: TeamNameRefreshPreview;
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

/* The server takes either header pair. A session wins when we have one, so a
 * phone that has used a link stops sending the PIN around. */
const authHeaders = (c: Credentials): Record<string, string> =>
  c.session ? { 'x-session': c.session } : { 'x-owner': c.owner, 'x-pin': c.pin ?? '' };

/* ── The shared test draft ──────────────────────────────────────────────────
 * A copy of the league on the server that every member can join. A device
 * that joins sends the test header only from the draft and TV screens, on
 * their state reads and draft writes. Every other page, keepers and trades
 * above all, reads and writes the real league.
 * The commissioner's on-device sandbox below wins when both are on. */
const TEST_DRAFT_KEY = 'fbb-test-draft';

/** True when this device has joined the shared test draft. */
export function testDraftJoined(): boolean {
  if (readSandbox()) return false;
  try {
    return localStorage.getItem(TEST_DRAFT_KEY) === '1';
  } catch {
    return false;
  }
}

export function joinTestDraft(): void {
  try {
    localStorage.setItem(TEST_DRAFT_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function leaveTestDraft(): void {
  try {
    localStorage.removeItem(TEST_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

const testDraftHeader = (): Record<string, string> => (testDraftJoined() ? { [TEST_DRAFT_HEADER]: '1' } : {});
const draftHeaders = (c: Credentials): Record<string, string> => ({ ...authHeaders(c), ...testDraftHeader() });

/** Open the shared test draft, or start it over. Joins this device. */
export async function startTestDraft(c: Credentials): Promise<StateResponse> {
  const { data } = await axios.post<StateResponse>('/api/league/test-draft/start', {}, { headers: authHeaders(c) });
  joinTestDraft();
  return data;
}

/** Close the shared test draft for everyone. */
export async function endTestDraft(c: Credentials): Promise<void> {
  await axios.post('/api/league/test-draft/end', {}, { headers: authHeaders(c) });
  leaveTestDraft();
}

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

async function fetchLiveState(credentials?: Credentials | null, test = false): Promise<StateResponse> {
  const { data } = await axios.get<StateResponse>('/api/league/state', {
    headers: { ...(credentials ? authHeaders(credentials) : {}), ...(test ? testDraftHeader() : {}) },
  });
  return data;
}

/** Pass credentials so the server can un-redact your own (or, as commissioner,
 * everyone's) keepers before draft day. In test mode, returns the sandbox.
 * `test` asks for the shared test draft; only the draft screens ask. */
export async function fetchLeagueState(credentials?: Credentials | null, test = false): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) return sandboxResponse(sandbox);
  return fetchLiveState(credentials, test);
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
    /** The player is not in the pool; name, team and position were typed in. */
    writeIn?: boolean;
  },
): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      const timestamp = new Date().toISOString();
      const yielded = s.draft.skipped?.[String(pick.overallPick)];
      s.draft.picks[String(pick.overallPick)] = {
        playerKey: pick.playerKey,
        playerName: pick.playerName,
        proTeam: pick.proTeam,
        positions: pick.positions,
        isKeeper: pick.isKeeper === true,
        enteredBy: c.owner,
        timestamp,
        ...(yielded ? { skipped: true, clockCalledBy: yielded.calledBy || null } : pickTiming(s.draft.clock, timestamp)),
      };
      if (yielded) {
        if (s.draft.skipped) delete s.draft.skipped[String(pick.overallPick)];
      } else {
        s.draft.clock = startPickClock(timestamp, isPaused(s.draft.clock));
      }
    });
  }
  const { data } = await axios.post('/api/league/draft/pick', pick, { headers: draftHeaders(c) });
  return data;
}

export async function clearDraftPick(c: Credentials, overallPick: number): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      const was = s.draft.picks[String(overallPick)];
      delete s.draft.picks[String(overallPick)];
      if (was?.skipped) {
        s.draft.skipped = { ...(s.draft.skipped ?? {}), [String(overallPick)]: { at: new Date().toISOString(), calledBy: was.clockCalledBy ?? '' } };
      } else if (s.draft.startedAt !== null) {
        s.draft.clock = startPickClock(new Date().toISOString(), isPaused(s.draft.clock));
      }
    });
  }
  const { data } = await axios.delete(`/api/league/draft/pick/${overallPick}`, {
    headers: draftHeaders(c),
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
        s.draft.clock = startPickClock(s.draft.startedAt);
      }
    });
  }
  const { data } = await axios.post('/api/league/draft/start', {}, { headers: authHeaders(c) });
  return data;
}

/** Call CLOCK on the team picking (rule 2.3.1). The screen checks `canCallClock` first; the server checks again. */
export async function callDraftClock(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      if (s.draft.clock && !s.draft.clock.call) s.draft.clock = callClock(s.draft.clock, c.owner, new Date().toISOString());
    });
  }
  const { data } = await axios.post('/api/league/draft/clock/call', {}, { headers: draftHeaders(c) });
  return data;
}

/**
 * The countdown hit zero on this screen. The server checks its own clock and
 * yields the pick on the clock if time really is up. `onClockOverall` is
 * only for test mode, which has no server to ask.
 */
export async function expireDraftClock(c: Credentials, onClockOverall: number): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      const now = new Date().toISOString();
      if (s.draft.clock && clockExpired(s.draft.clock, now)) {
        const next = yieldPick({ clock: s.draft.clock, skipped: s.draft.skipped }, onClockOverall, now);
        s.draft.clock = next.clock;
        s.draft.skipped = next.skipped;
      }
    });
  }
  const { data } = await axios.post('/api/league/draft/clock/expire', {}, { headers: draftHeaders(c) });
  return data;
}

export async function pauseDraftClock(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      if (s.draft.clock) s.draft.clock = pauseClock(s.draft.clock, new Date().toISOString());
    });
  }
  const { data } = await axios.post('/api/league/draft/clock/pause', {}, { headers: draftHeaders(c) });
  return data;
}

export async function resumeDraftClock(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      if (s.draft.clock) s.draft.clock = resumeClock(s.draft.clock, new Date().toISOString());
    });
  }
  const { data } = await axios.post('/api/league/draft/clock/resume', {}, { headers: draftHeaders(c) });
  return data;
}

/**
 * Call the draft finished. This is what opens next season's picks for trading,
 * so the commissioner does it once the last pick is in.
 */
export async function closeDraft(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      if (!s.draft.closedAt) s.draft.closedAt = new Date().toISOString();
    });
  }
  const { data } = await axios.post('/api/league/draft/close', {}, { headers: authHeaders(c) });
  return data;
}

/** Undo closing the draft. A mistake must not cost anybody a trade window. */
export async function reopenDraft(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.draft.closedAt = null;
    });
  }
  const { data } = await axios.post('/api/league/draft/reopen', {}, { headers: authHeaders(c) });
  return data;
}

export async function resetDraft(c: Credentials): Promise<StateResponse> {
  const sandbox = readSandbox();
  if (sandbox) {
    return mutateSandbox(sandbox, (s) => {
      s.draft.picks = {};
      s.draft.startedAt = null;
      s.draft.closedAt = null;
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

/** Commissioner: stop (or start) seeing other teams' keepers, so reveals work for you. */
export async function setCommishBlind(c: Credentials, blind: boolean): Promise<StateResponse> {
  const { data } = await axios.post('/api/league/commish-blind', { blind }, { headers: authHeaders(c) });
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

/** Ask ESPN what every team is called now. Writes nothing. */
export async function fetchEspnTeamNamePreview(
  c: Credentials,
): Promise<TeamNamePreviewResponse> {
  const { data } = await axios.post('/api/league/team-names/fetch-preview', {}, {
    headers: authHeaders(c),
  });
  return data;
}

/** Store the exact names that were previewed. */
export async function acceptTeamNames(
  c: Credentials,
  preview: TeamNamePreviewResponse,
): Promise<StateResponse & { preview: TeamNameRefreshPreview }> {
  const { data } = await axios.post(
    '/api/league/team-names/accept',
    { ...preview.candidate, fingerprint: preview.fingerprint },
    { headers: authHeaders(c) },
  );
  return data;
}

/** Your saved mock drafts, newest first. */
export async function fetchMockResults(c: Credentials): Promise<MockResultRecord[]> {
  const { data } = await axios.get('/api/league/mock-results', { headers: authHeaders(c) });
  return data.results as MockResultRecord[];
}

/** Commish only: award odds from Kalshi and depth charts from ESPN. `fresh` reads them again. */
export async function fetchNbaWatch(c: Credentials, fresh = false): Promise<NbaWatch> {
  const { data } = await axios.get<NbaWatch>(`/api/league/nba-watch${fresh ? '?fresh=1' : ''}`, { headers: authHeaders(c) });
  return data;
}

/** Every owner's finished mocks and best grade. */
export async function fetchMockStats(c: Credentials): Promise<MockStatRow[]> {
  const { data } = await axios.get('/api/league/mock-stats', { headers: authHeaders(c) });
  return data.stats as MockStatRow[];
}

/** Save a finished mock draft. Saving the same draft twice is a no-op. */
export async function saveMockResult(
  c: Credentials,
  result: Pick<MockResultRecord, 'id' | 'seed' | 'mode' | 'grade' | 'board' | 'tradesOn'>,
): Promise<MockResultRecord> {
  const { data } = await axios.post('/api/league/mock-results', result, { headers: authHeaders(c) });
  return data.result as MockResultRecord;
}

/** One finished mock by its shared link's id. No sign-in needed. */
export async function fetchSharedMockResult(id: string): Promise<MockResultRecord> {
  const { data } = await axios.get(`/api/league/mock-results/${encodeURIComponent(id)}`);
  return data.result as MockResultRecord;
}

/** Forget one saved mock draft. */
export async function deleteMockResult(c: Credentials, id: string): Promise<void> {
  await axios.delete(`/api/league/mock-results/${encodeURIComponent(id)}`, { headers: authHeaders(c) });
}

/** The commissioner's edits to ESPN's projections. */
export async function fetchProjectionEdits(c: Credentials): Promise<ProjectionEdit[]> {
  const { data } = await axios.get('/api/league/projection-edits', { headers: authHeaders(c) });
  return data.edits as ProjectionEdit[];
}

/** Save one player's edit. */
export async function saveProjectionEdit(
  c: Credentials,
  espnId: number,
  edit: Pick<ProjectionEdit, 'name' | 'games' | 'perGame' | 'note'>,
): Promise<ProjectionEdit> {
  const { data } = await axios.put(`/api/league/projection-edits/${espnId}`, edit, { headers: authHeaders(c) });
  return data.edit as ProjectionEdit;
}

/** Drop a player's edit, back to ESPN's projection. */
export async function deleteProjectionEdit(c: Credentials, espnId: number): Promise<void> {
  await axios.delete(`/api/league/projection-edits/${espnId}`, { headers: authHeaders(c) });
}

/** The accepted ESPN draft rankings, or the empty fallback. Commissioner-only for now. */
export async function fetchDraftRankings(
  c: Credentials,
): Promise<{ snapshot: DraftRankingSnapshot; fallback: boolean }> {
  const { data } = await axios.get('/api/league/draft-rankings', { headers: authHeaders(c) });
  return data;
}

/** Ask ESPN for its draft numbers and see what would change. Writes nothing. */
export async function fetchEspnDraftRankingPreview(
  c: Credentials,
): Promise<FetchedDraftRankingPreviewResponse> {
  const { data } = await axios.post('/api/league/draft-rankings/fetch-preview', {}, {
    headers: authHeaders(c),
  });
  return data;
}

/** Store the exact rankings that were previewed. */
export async function acceptDraftRankings(
  c: Credentials,
  candidate: DraftRankingCandidateInput,
  preview: Pick<DraftRankingPreviewResponse, 'currentSnapshotId' | 'fingerprint'>,
): Promise<StateResponse & { snapshot: DraftRankingSnapshot }> {
  const { data } = await axios.post(
    '/api/league/draft-rankings/accept',
    {
      ...candidate,
      expectedCurrentSnapshotId: preview.currentSnapshotId,
      fingerprint: preview.fingerprint,
    },
    { headers: authHeaders(c) },
  );
  return data;
}

/** Whether an owner has a PIN. The commissioner never gets the value. */
export type PinState = 'set' | 'temp' | 'none';

export async function fetchPins(c: Credentials): Promise<Array<{ owner: string; state: PinState }>> {
  const { data } = await axios.get('/api/league/pins', { headers: authHeaders(c) });
  return data;
}

export interface SetPinResult {
  ok: boolean;
  /** The new PIN went to the owner's inbox. */
  emailed: boolean;
  /** The server wrote it to its log instead, which is local work. */
  logged?: boolean;
  /** Why nothing went out, when nothing did. */
  reason?: string;
}

/** Set an owner's PIN and mail it to them, or "" to clear it. */
export async function setPin(c: Credentials, owner: string, pin: string): Promise<SetPinResult> {
  const { data } = await axios.post<SetPinResult>(
    `/api/league/pins/${encodeURIComponent(owner)}`,
    { pin },
    { headers: authHeaders(c) },
  );
  return data;
}

// ─── Sign-in links ───────────────────────────────────────────────────────────

export interface LoginLinkResult {
  sent: boolean;
  /** The server wrote the link to its log instead of mailing it. */
  logged?: boolean;
}

/**
 * Ask for a sign-in link. The server answers the same way whether or not the
 * address belongs to an owner, so this never tells a stranger who is in the
 * league. Nothing here means the link is on its way.
 */
export async function requestLoginLink(email: string): Promise<LoginLinkResult> {
  const { data } = await axios.post<LoginLinkResult>('/api/auth/request-link', { email });
  return data;
}

export interface LoginSession {
  session: string;
  owner: string;
  email: string;
  isCommissioner: boolean;
  expiresAt: string;
}

/** Trade the token out of an emailed link for a session. Works once. */
export async function consumeLoginToken(token: string): Promise<LoginSession> {
  const { data } = await axios.post<LoginSession>('/api/auth/consume', { token });
  return data;
}

export interface MeResponse {
  owner: string;
  email: string;
  isCommissioner: boolean;
}

/** Who the server thinks we are. Throws 401 once a session has run out. */
export async function fetchMe(c: Credentials): Promise<MeResponse> {
  const { data } = await axios.get<MeResponse>('/api/auth/me', { headers: authHeaders(c) });
  return data;
}

/** Kill the session on the server. A PIN sign-in has nothing to kill. */
export async function signOutServer(c: Credentials): Promise<void> {
  await axios.post('/api/auth/sign-out', {}, { headers: authHeaders(c) });
}

export interface OwnerEmail {
  owner: string;
  /** Empty when nobody has set an address for this owner yet. */
  email: string;
  /** When the owner last used a link. Null means the address is untested. */
  confirmedAt: string | null;
}

export async function fetchOwnerEmails(c: Credentials): Promise<OwnerEmail[]> {
  const { data } = await axios.get<OwnerEmail[]>('/api/league/emails', { headers: authHeaders(c) });
  return data;
}

/** Save one owner's address. The server hands back the whole list again. */
export async function saveOwnerEmail(
  c: Credentials,
  owner: string,
  email: string,
): Promise<OwnerEmail[]> {
  const { data } = await axios.post<OwnerEmail[]>(
    `/api/league/emails/${encodeURIComponent(owner)}`,
    { email },
    { headers: authHeaders(c) },
  );
  return data;
}

export interface ActAsSession extends LoginSession {
  impersonatedBy: string;
}

/**
 * Take another owner's seat, commissioner only. The session it hands back
 * carries only what that owner can do, and every write through it names both
 * people in the audit log.
 */
export async function actAsOwner(c: Credentials, owner: string): Promise<ActAsSession> {
  const { data } = await axios.post<ActAsSession>(
    `/api/league/act-as/${encodeURIComponent(owner)}`,
    {},
    { headers: authHeaders(c) },
  );
  return data;
}

/**
 * Send one member their sign-in link. It goes to their inbox, not yours, so
 * this checks that mail reaches them rather than letting you in as them.
 */
export async function sendOwnerLink(c: Credentials, owner: string): Promise<void> {
  await axios.post(
    `/api/league/emails/${encodeURIComponent(owner)}/send-link`,
    {},
    { headers: authHeaders(c) },
  );
}

/** Seconds to wait after too many link requests. Null when that wasn't it. */
export function retryAfterSeconds(e: unknown): number | null {
  if (!axios.isAxiosError(e) || e.response?.status !== 429) return null;
  const data = e.response.data as { retryAfterSeconds?: number } | undefined;
  return typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null;
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

// ─── Dues ────────────────────────────────────────────────────────────────────

export interface DuesResponse extends DuesBoard {
  season: number;
  full: number;
  half: number;
  halfMaxTeams: number;
  /** Venmo username that collects. Empty until a commissioner sets it. */
  venmo: string;
  /** The owner who collects. Empty until a commissioner sets it. */
  payee: string;
}

/** Anyone may read who has paid. */
export async function fetchDues(): Promise<DuesResponse> {
  const { data } = await axios.get<DuesResponse>('/api/league/dues');
  return data;
}

/** One change to one team's dues. The server checks who may make it. */
export async function changeDues(c: Credentials, owner: string, action: DuesAction): Promise<DuesResponse> {
  const { data } = await axios.post<DuesResponse>(
    `/api/league/dues/${encodeURIComponent(owner)}`,
    { action },
    { headers: authHeaders(c) },
  );
  return data;
}

/** Mail every team that has not paid (commissioner only). */
export async function sendDuesShame(c: Credentials): Promise<{ sent: string[]; noAddress: string[] }> {
  const { data } = await axios.post<{ sent: string[]; noAddress: string[] }>(
    '/api/league/dues/shame',
    {},
    { headers: authHeaders(c) },
  );
  return data;
}

/** Who collects and their Venmo (commissioner only). */
export async function saveDuesSettings(
  c: Credentials,
  settings: { venmo: string; payee: string },
): Promise<DuesResponse> {
  const { data } = await axios.put<DuesResponse>('/api/league/dues/settings', settings, {
    headers: authHeaders(c),
  });
  return data;
}

// ─── Signatures ──────────────────────────────────────────────────────────────

export interface RulebookSignaturesResponse {
  versionId: string | null;
  currentVersionId: string | null;
  revision: number | null;
  fingerprint: string | null;
  acknowledgement: string;
  members: string[];
  signed: Array<Omit<RulebookSignature, 'drawing'> & { drawn: boolean }>;
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
/**
 * Where the printed constitution lives. Public, like the book: a member opens
 * it in a new tab and the browser shows, saves, or prints it from there.
 */
export function rulebookPdfUrl(options: { rev?: string | null; copyFor?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (options.rev) params.set('rev', options.rev);
  if (options.copyFor) params.set('for', options.copyFor);
  const query = params.toString();
  return `/api/league/rulebook/pdf${query ? `?${query}` : ''}`;
}

/** The working draft as a PDF, for the commissioner to look at before publishing. */
export async function fetchDraftRulebookPdf(c: Credentials): Promise<Blob> {
  const { data } = await axios.get<Blob>('/api/league/rulebook/draft/pdf', {
    headers: authHeaders(c),
    responseType: 'blob',
  });
  return data;
}

export interface SignRequestResponse {
  versionId: string;
  revision: number;
  sent: string[];
  noAddress: string[];
}

/** Mail the picked members a "read it, sign it" note (commissioner only). */
export async function requestRulebookSignatures(
  c: Credentials,
  owners: string[],
): Promise<SignRequestResponse> {
  const { data } = await axios.post<SignRequestResponse>(
    '/api/league/rulebook/sign-request',
    { owners },
    { headers: authHeaders(c) },
  );
  return data;
}

/** The commissioner withdraws one member's signature so they can sign again. */
/** Fold the newest rule book revision into the one before it (commissioner). */
export async function foldRulebookVersion(
  c: Credentials,
  versionId: string,
): Promise<{ kept: { id: string; revision: number }; removed: { id: string; revision: number } }> {
  const { data } = await axios.post('/api/league/rulebook/fold', { versionId }, { headers: authHeaders(c) });
  return data;
}

export async function withdrawRulebookSignature(c: Credentials, owner: string): Promise<void> {
  await axios.delete(`/api/league/rulebook/signatures/${encodeURIComponent(owner)}`, {
    headers: authHeaders(c),
  });
}

export async function signRulebook(
  c: Credentials,
  versionId: string,
  fingerprint: string,
  /** A hand-drawn signature as a PNG data URL, or nothing to sign with the name. */
  drawing: string | null = null,
): Promise<{
  signature: RulebookSignature;
  signed: RulebookSignature[];
  missing: string[];
  complete: boolean;
}> {
  const { data } = await axios.post(
    '/api/league/rulebook/sign',
    { versionId, fingerprint, drawing },
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

// ─── League history (readable by anyone) ─────────────────────────────────────

export interface PublishedHistoryResponse {
  history: LeagueHistory;
  versionId: string | null;
  revision: number;
  publishedAt: string | null;
  publishedBy: string | null;
  notes: string;
  reason: string;
  published: boolean;
}

export async function fetchPublishedHistory(): Promise<PublishedHistoryResponse> {
  const { data } = await axios.get<PublishedHistoryResponse>('/api/league/history');
  return data;
}

export interface HistoryVersionSummary {
  id: string;
  season: number;
  revision: number;
  fingerprint: string;
  notes: string;
  reason: string;
  publishedAt: string;
  publishedBy: string;
}

export async function fetchHistoryVersions(): Promise<HistoryVersionSummary[]> {
  const { data } = await axios.get<HistoryVersionSummary[]>('/api/league/history/versions');
  return data;
}

export async function fetchHistoryVersion(
  id: string,
): Promise<HistoryVersionSummary & { history: LeagueHistory }> {
  const { data } = await axios.get(`/api/league/history/versions/${encodeURIComponent(id)}`);
  return data;
}

export interface HistoryDraftResponse {
  history: LeagueHistory;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** True when nothing is stored yet and this is the published or committed copy. */
  seeded: boolean;
}

export async function fetchHistoryDraft(c: Credentials): Promise<HistoryDraftResponse> {
  const { data } = await axios.get<HistoryDraftResponse>('/api/league/history/draft', {
    headers: authHeaders(c),
  });
  return data;
}

export async function saveHistoryDraft(
  c: Credentials,
  history: LeagueHistory,
  expectedVersion: number,
): Promise<{ version: number; updatedAt: string; updatedBy: string }> {
  const { data } = await axios.put(
    '/api/league/history/draft',
    { history, expectedVersion },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function resetHistoryDraft(c: Credentials): Promise<HistoryDraftResponse> {
  const { data } = await axios.delete<HistoryDraftResponse>('/api/league/history/draft', {
    headers: authHeaders(c),
  });
  return data;
}

export interface HistoryImportRequest {
  seasonNumber: number;
  espnSeasonId: number;
  teamMap: TeamMapping[];
  /** A pasted ESPN response. Left out, the server pulls the season live. */
  payload?: unknown;
}

export interface HistoryImportPreviewResponse {
  fingerprint: string;
  blocked: boolean;
  diff: HistoryDiff;
  conflicts: HistoryConflict[];
  problems: HistoryProblem[];
  importProblems: ImportProblem[];
  espnTeams: Array<{ espnTeamId: number; name: string; finalRank: number | null }>;
  candidate: LeagueHistory;
}

/** No write. Shows what an ESPN season would change. */
export async function previewHistoryImport(
  c: Credentials,
  request: HistoryImportRequest,
): Promise<HistoryImportPreviewResponse> {
  const { data } = await axios.post<HistoryImportPreviewResponse>(
    '/api/league/history/import/preview',
    request,
    { headers: authHeaders(c) },
  );
  return data;
}

/** Save the exact previewed import into the draft. Publishing is a second step. */
export async function applyHistoryImport(
  c: Credentials,
  request: HistoryImportRequest & { fingerprint: string; expectedVersion: number },
): Promise<{ version: number; changes: number; conflicts: HistoryConflict[] }> {
  const { data } = await axios.post('/api/league/history/import/apply', request, {
    headers: authHeaders(c),
  });
  return data;
}

export async function publishHistory(
  c: Credentials,
  fingerprint: string,
  reason: string,
  notes: string,
): Promise<{ versionId: string; revision: number; publishedAt: string; publishedBy: string }> {
  const { data } = await axios.post(
    '/api/league/history/publish',
    { fingerprint, reason, notes },
    { headers: authHeaders(c) },
  );
  return data;
}

// ─── Votes ───────────────────────────────────────────────────────────────────

export interface PollsResponse {
  polls: Poll[];
  you: { owner: string; isCommissioner: boolean; hasLaunched: boolean; canLaunch: boolean };
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

/** Commissioner only: rewrite an open vote. */
export async function editPollById(
  c: Credentials,
  pollId: string,
  input: { title: string; detail: string; affects: string[] },
): Promise<Poll> {
  const { data } = await axios.post<Poll>(
    `/api/league/polls/${encodeURIComponent(pollId)}/edit`,
    input,
    { headers: authHeaders(c) },
  );
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

// ─── Draft pick trades ───────────────────────────────────────────────────────

export interface PickTradesResponse {
  season: number;
  /** The one draft whose picks can move right now. */
  tradeableSeason: number;
  /** When the commissioner closed the draft, which is what opens next season. */
  draftClosedAt: string | null;
  proposals: PickTradeProposal[];
  transfers: PickTransfer[];
  you: { owner: string; inbox: number; sent: number };
}

export interface PickTradeDraft {
  recipient: string;
  offer: PickRef[];
  request: PickRef[];
  note: string;
}

export async function fetchPickTrades(c: Credentials): Promise<PickTradesResponse> {
  const { data } = await axios.get<PickTradesResponse>('/api/league/pick-trades', {
    headers: authHeaders(c),
  });
  return data;
}

/** Review a trade without sending anything. Pass an id, or a whole draft offer. */
export async function previewPickTrade(
  c: Credentials,
  input: { id: string } | Omit<PickTradeDraft, 'note'>,
): Promise<TradePreview> {
  const { data } = await axios.post<TradePreview>('/api/league/pick-trades/preview', input, {
    headers: authHeaders(c),
  });
  return data;
}

export async function sendPickTrade(
  c: Credentials,
  input: PickTradeDraft,
): Promise<{ proposal: PickTradeProposal } & StateResponse> {
  const { data } = await axios.post('/api/league/pick-trades', input, { headers: authHeaders(c) });
  return data;
}

export async function acceptPickTrade(
  c: Credentials,
  id: string,
  version: number,
): Promise<{ proposal: PickTradeProposal } & StateResponse> {
  const { data } = await axios.post(
    `/api/league/pick-trades/${encodeURIComponent(id)}/accept`,
    { version },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function rejectPickTrade(
  c: Credentials,
  id: string,
): Promise<{ proposal: PickTradeProposal } & StateResponse> {
  const { data } = await axios.post(
    `/api/league/pick-trades/${encodeURIComponent(id)}/reject`,
    {},
    { headers: authHeaders(c) },
  );
  return data;
}

/** Your mock trades: built on the trade page, never sent. */
export async function fetchMockTrades(c: Credentials): Promise<MockTrade[]> {
  const { data } = await axios.get('/api/league/pick-trades/mock', { headers: authHeaders(c) });
  return data.trades as MockTrade[];
}

/** Keep a trade as a mock. Nobody else sees it and nothing is sent. */
export async function saveMockTrade(
  c: Credentials,
  input: { recipient: string; offer: PickRef[]; request: PickRef[]; note: string },
): Promise<MockTrade> {
  const { data } = await axios.post('/api/league/pick-trades/mock', input, { headers: authHeaders(c) });
  return data.trade as MockTrade;
}

export async function deleteMockTrade(c: Credentials, id: string): Promise<void> {
  await axios.delete(`/api/league/pick-trades/mock/${encodeURIComponent(id)}`, { headers: authHeaders(c) });
}

/** Change an offer you sent and send it again. `version` is the one you saw. */
export async function revisePickTrade(
  c: Credentials,
  id: string,
  input: { version: number; offer: PickRef[]; request: PickRef[]; note: string },
): Promise<{ proposal: PickTradeProposal } & StateResponse> {
  const { data } = await axios.post(
    `/api/league/pick-trades/${encodeURIComponent(id)}/revise`,
    input,
    { headers: authHeaders(c) },
  );
  return data;
}

export async function cancelPickTrade(
  c: Credentials,
  id: string,
): Promise<{ proposal: PickTradeProposal } & StateResponse> {
  const { data } = await axios.post(
    `/api/league/pick-trades/${encodeURIComponent(id)}/cancel`,
    {},
    { headers: authHeaders(c) },
  );
  return data;
}

/**
 * True only when the server says this sign-in is gone (a 401). A network
 * blip or a database hiccup answers false, so it never signs anyone out.
 */
export async function sessionExpired(c: Credentials): Promise<boolean> {
  try {
    await fetchMe(c);
    return false;
  } catch (e) {
    return axios.isAxiosError(e) && e.response?.status === 401;
  }
}

/**
 * True only when the server refuses this owner-and-PIN pair (a 401): the PIN
 * was reset, or cleared. Anything else answers false and keeps them signed in.
 */
export async function pinDead(c: Credentials): Promise<boolean> {
  try {
    await axios.post('/api/league/verify', {}, { headers: authHeaders(c) });
    return false;
  } catch (e) {
    return axios.isAxiosError(e) && e.response?.status === 401;
  }
}

export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    // A phone can hold a sign-in the server no longer accepts: a PIN that was
    // reset, or a link that ran out. "Invalid owner" reads like an insult;
    // say what to do instead.
    if (e.response?.status === 401) {
      return 'Your sign-in is out of date. Sign in again from the home page, then try that once more.';
    }
    const data = e.response?.data as { error?: string } | undefined;
    return data?.error ?? e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

/* ── Achievements and prop bets ─────────────────────────────────────────── */

export interface AchievementsResponse {
  you: {
    owner: string;
    earned: Partial<Record<AchievementId, string>>;
    facts: OwnerFacts;
    left: number;
    check: RevealCheck;
    /** Teams you have seen keepers on, with only the keepers shown to you. */
    teams: Array<{
      target: string;
      /** How many keepers that team has in now. */
      keeping: number;
      /** playerName is null when the team has since dropped him. */
      shown: Array<{ playerKey: string; playerName: string | null; at: string }>;
      lastAt: string;
    }>;
  };
  standings: AchievementStanding[];
  keepersPublic: boolean;
  /** Set on a reveal: the keeper just shown. */
  revealed?: { target: string; playerKey: string };
}

export async function fetchAchievements(c: Credentials): Promise<AchievementsResponse> {
  const { data } = await axios.get<AchievementsResponse>('/api/league/achievements', { headers: authHeaders(c) });
  return data;
}

/** Spend one reveal. The server picks the team. */
export async function revealKeeper(c: Credentials): Promise<AchievementsResponse> {
  const { data } = await axios.post<AchievementsResponse>('/api/league/achievements/reveal', {}, { headers: authHeaders(c) });
  return data;
}

export interface PropBetsResponse {
  /** Never one about the viewer. The server filters them out. */
  props: PropBet[];
  locked: boolean;
  owners: string[];
}

export async function fetchPropBets(c: Credentials): Promise<PropBetsResponse> {
  const { data } = await axios.get<PropBetsResponse>('/api/league/prop-bets', { headers: authHeaders(c) });
  return data;
}

/** Enter the final count, or null to clear it. */
export async function settlePropBet(c: Credentials, id: string, result: number | null): Promise<PropBetsResponse> {
  const { data } = await axios.post<PropBetsResponse>(
    `/api/league/prop-bets/${encodeURIComponent(id)}/result`,
    { result },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function createPropBet(c: Credentials, input: PropInput): Promise<PropBetsResponse> {
  const { data } = await axios.post<PropBetsResponse>('/api/league/prop-bets', input, { headers: authHeaders(c) });
  return data;
}

export async function takePropSide(c: Credentials, id: string, side: PropSide | null): Promise<PropBetsResponse> {
  const { data } = await axios.post<PropBetsResponse>(
    `/api/league/prop-bets/${encodeURIComponent(id)}/take`,
    { side },
    { headers: authHeaders(c) },
  );
  return data;
}

export async function removePropBet(c: Credentials, id: string): Promise<PropBetsResponse> {
  const { data } = await axios.delete<PropBetsResponse>(`/api/league/prop-bets/${encodeURIComponent(id)}`, {
    headers: authHeaders(c),
  });
  return data;
}

export interface AchievementNews {
  /** Earned and not yet shown in a toast, in list order. */
  fresh: AchievementId[];
  left: number;
  canReveal: boolean;
}

/** Anything new since the last toast. Checks only the signed-in member. */
export async function fetchAchievementNews(c: Credentials): Promise<AchievementNews> {
  const { data } = await axios.get<AchievementNews>('/api/league/achievements/news', { headers: authHeaders(c) });
  return data;
}

/** The toast for these went up; do not show them again. */
export async function markAchievementsSeen(c: Credentials, ids: AchievementId[]): Promise<void> {
  await axios.post('/api/league/achievements/seen', { ids }, { headers: authHeaders(c) });
}
