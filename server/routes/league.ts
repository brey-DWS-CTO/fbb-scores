/**
 * League draft-hub API — keepers, live draft picks, locks, PINs, audit log.
 * Mounted at /api/league.
 *
 * Auth: `x-owner` + `x-pin` headers, verified against the pin store.
 * Owner names are case-sensitive exact matches to the league config.
 * Commissioner status comes from src/data/source/league-2027-config.json.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import {
  applyOverrides,
  availablePlayers,
  buildDraftBoard,
  resolveTeamKeepers,
} from '../../src/lib/keeper/engine.js';
import {
  callClock,
  canCallClock,
  clockExpired,
  isPaused,
  pauseClock,
  pickTiming,
  resumeClock,
  startPickClock,
  yieldPick,
} from '../../src/lib/league/draftClock.js';
import { nameTaken, parseWriteIn } from '../../src/lib/league/writeIn.js';
import type {
  LeagueDataset,
  PickRef,
  PickTradeProposal,
} from '../../src/lib/keeper/types.js';
import {
  canAnswer,
  canRevise,
  reviseProposal,
  checkProposalAgainstState,
  checkProposalShape,
  datasetForState,
  describeTrade,
  expireStale,
  expiresAtFrom,
  inboxCount,
  involves,
  MAX_TRADE_NOTE,
  normalizeProposal,
  ownersResetByTrade,
  previewProposal,
  proposalInput,
  proposalsOf,
  touchesRef,
  tradeableSeason,
  tradeWindow,
  transfersForProposal,
  transfersOf,
  visibleProposals,
  type ProposalInput,
} from '../../src/lib/league/pickTrades.js';
import {
  getState,
  mutateState,
  verifyPin,
  verifySession,
  getOwnerEmails,
  setOwnerEmail,
  issueLoginToken,
  startImpersonation,
  getPinStates,
  setPin,
  getPinStatus,
  claimPin,
  appendAudit,
  acceptPlayerPoolSnapshot,
  acceptScheduleSnapshot,
  acceptDraftRankingSnapshot,
  DraftRankingAcceptError,
  clearKeeperScenario,
  clearKeeperScenariosForSeason,
  getKeeperScenario,
  readAudit,
  isKnownOwner,
  isCommissionerOwner,
  setKeeperScenarioTarget,
  DRAFT_AT_ISO,
  PlayerPoolAcceptError,
  ScheduleAcceptError,
  RulebookSaveError,
  RulebookPublishError,
  getRulebookDraft,
  saveRulebookDraft,
  deleteRulebookDraft,
  publishRulebookVersion,
  getLatestRulebookVersion,
  getRulebookVersion,
  listRulebookVersions,
  HistoryPublishError,
  HistorySaveError,
  deleteHistoryDraft,
  getHistoryDraft,
  getHistoryVersion,
  getLatestHistoryVersion,
  listHistoryVersions,
  publishHistoryVersion,
  saveHistoryDraft,
  PollWriteError,
  RulebookSignError,
  CONFIG_TEAMS,
  deleteRulebookSignature,
  foldLatestRulebookVersion,
  listRulebookSignatures,
  insertRulebookSignature,
  listDues,
  saveDues,
  getDuesSettings,
  saveDuesSettings,
  listPolls,
  getPoll,
  insertPoll,
  updatePoll,
  OWNERS,
  claimSentNotice,
  deleteProjectionEdit,
  listProjectionEdits,
  saveProjectionEdit,
  deleteMockResult,
  listMockResults,
  findMockResult,
  saveMockResult,
  listMockFinishes,
  listMockTrades,
  saveMockTrade,
  deleteMockTrade,
  getTestDraft,
  listPresence,
  touchPresence,
  getDraftQueues,
  setDraftQueue,
  mutateTestDraft,
  setTestDraft,
  TestDraftMissingError,
  getSharedMock,
  listSharedMocks,
  listOpenSharedMocks,
  insertSharedMock,
  updateSharedMock,
  SharedMockWriteError,
  type KeeperSelection,
  type LeagueDynamicState,
  type MutateResult,
  type StateResult,
} from '../lib/leagueStore.js';
import { TEST_DRAFT_HEADER, TEST_DRAFT_SESSION_HEADER, testDraftState } from '../../src/lib/league/testDraft.js';
import { inRoom, PRESENCE_WINDOW_MS } from '../../src/lib/league/presence.js';
import { cleanQueue, firstQueued } from '../../src/lib/league/draftQueue.js';
import { SEED_EDITS, parseProjectionEdit, type ProjectionEdit } from '../../src/lib/league/projectionEdits.js';
import { MEMBER_MOCK_LIMIT, parseMockResult, type MockResultRecord } from '../../src/lib/league/mockGrade.js';
import {
  MAX_PEOPLE,
  clockHasRunOut,
  joinSharedMock,
  namesOf,
  newSharedMock,
  openSharedMock,
  othersAt,
  parseSharedMockRoom,
  pickInSharedMock,
  quitSharedMock,
  sharedMockBoard,
  sharedMockId,
  sharedMockPhase,
  showsFor,
  startOpenSharedMock,
  type SharedMockRoom,
} from '../../src/lib/league/sharedMock.js';
import {
  NO_FACTS,
  canReveal,
  coversAllProps,
  earnedCount,
  earnedFrom,
  firstGuessToRecord,
  markSeen,
  unseenAchievements,
  guessHit,
  guessNear,
  hiddenCount,
  hiddenKeepers,
  ledgerOf,
  pickReveal,
  revealsLeft,
  revealsReady,
  stampEarned,
  standings,
  type AchievementLedger,
  type OwnerFacts,
} from '../../src/lib/league/achievements.js';
import {
  canRemoveProp,
  canSettleProp,
  normalizeProp,
  parsePropInput,
  parseResult,
  propsLocked,
  sameProp,
  takeSide,
  visibleProps,
  type PropBet,
  type PropSide,
} from '../../src/lib/league/propBets.js';
import { mockStats } from '../../src/lib/league/mockStats.js';
import { MAX_MOCK_TRADES, mockTradeId, type MockTrade } from '../../src/lib/league/mockTrades.js';
import { LINK_TTL_MINUTES } from '../../src/lib/league/auth.js';
import {
  DUES_ACTIONS,
  DUES_FULL,
  DUES_HALF,
  DUES_HALF_MAX_TEAMS,
  applyDuesAction,
  blankDuesRow,
  duesBoard,
  parseVenmoHandle,
  shameList,
  type DuesAction,
  type DuesSettings,
} from '../../src/lib/league/dues.js';
import { sendLoginLink, sendPinEmail } from '../lib/mailer.js';
import {
  notifyKeepersRevealed,
  sendRulebookSignRequest,
  sendDuesShame,
  notifyTradeAccepted,
  notifyTradeOffered,
  notifyTradeSettled,
} from '../lib/notifier.js';
import { appOrigin } from './auth.js';
import {
  canEditPoll,
  canLaunchPoll,
  canVote,
  castVote,
  closePoll,
  editPoll,
  pollEditChanges,
  thresholdFor,
  unknownClauses,
  type Poll,
  type PollEditInput,
  type PollKind,
  type VoteChoice,
} from '../../src/lib/league/polls.js';
import seedRulebook from '../../src/data/source/rulebook-2027.json' with { type: 'json' };
import hashtagProjections from '../data/hashtag-projections-2027.json' with { type: 'json' };
import { validateDraft } from '../../src/lib/league/rulebookEdit.js';
import { rulebookFingerprint } from '../../src/lib/league/rulebookDiff.js';
import type { Rulebook } from '../../src/lib/league/rulebook.js';
import {
  ACKNOWLEDGEMENT,
  canSign,
  checkDrawing,
  makeSignature,
  publicSignature,
  signatureStatus,
} from '../../src/lib/league/rulebookSignatures.js';
import { pdfFileName } from '../../src/lib/league/rulebookFront.js';
import { renderRulebookPdf } from '../lib/rulebookPdf.js';
import { AmendmentError, canSeedAmendment, seedAmendment } from '../../src/lib/league/rulebookAmendment.js';
import {
  FALLBACK_PLAYER_POOL,
  fetchEspnPlayerPoolCandidate,
  makePlayerPoolSnapshot,
  parsePlayerPoolCandidate,
  preparePlayerPoolCandidate,
  resolveDraftDataset,
  resolveDraftPlayerPool,
} from '../lib/playerPoolService.js';
import {
  historyFingerprint,
  validateHistory,
  type LeagueHistory,
} from '../../src/lib/league/history.js';
import {
  FALLBACK_HISTORY,
  HISTORY_SEASON,
  fetchEspnSeasonPayload,
  parseHistoryDocument,
  parseImportRequest,
  prepareSeasonImport,
  resolveHistoryDraft,
  resolvePublishedHistory,
} from '../lib/historyService.js';
import {
  FALLBACK_SCHEDULE,
  makeScheduleSnapshot,
  parseScheduleCandidate,
  prepareScheduleCandidate,
  resolveCurrentSchedule,
} from '../lib/scheduleService.js';
import {
  fetchEspnTeamNameCandidate,
  parseTeamNameCandidate,
  prepareTeamNameCandidate,
} from '../lib/teamNameService.js';
import {
  FALLBACK_DRAFT_RANKINGS,
  fetchEspnDraftRankingCandidate,
  makeDraftRankingSnapshot,
  parseDraftRankingCandidate,
  prepareDraftRankingCandidate,
  resolveCurrentDraftRankings,
} from '../lib/draftRankingService.js';
import { getNbaWatch } from '../lib/nbaWatchService.js';
import { rankBoard, type DraftRankingSnapshot } from '../../src/lib/league/draftRankings.js';
import { DRAFT_LIST_MAX_CHARS, buildDraftList, isOnAuto, nextAutoPick, withAuto } from '../../src/lib/league/autoDraft.js';
import { draftListOwners, getDraftList, setDraftList } from '../lib/leagueStore.js';

const router = Router();
const leagueDataset = rawDataset as unknown as LeagueDataset;

const routeParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

/** Error carrying an HTTP status, mapped to a JSON body by the error handler. */
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function cleanKeeperSelections(value: unknown): KeeperSelection[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Body must include a selections array');
  }
  if (value.length > leagueDataset.maxKeepersPerTeam) {
    throw new HttpError(
      400,
      `A team may keep at most ${leagueDataset.maxKeepersPerTeam} players`,
    );
  }

  const clean: KeeperSelection[] = [];
  const seen = new Set<string>();
  for (const selection of value as Array<Record<string, unknown>>) {
    if (
      !selection
      || typeof selection.playerKey !== 'string'
      || selection.playerKey.length === 0
      || typeof selection.playerName !== 'string'
      || selection.playerName.length === 0
    ) {
      throw new HttpError(400, 'Each selection needs a playerKey and playerName');
    }
    if (seen.has(selection.playerKey)) {
      throw new HttpError(400, 'A player can only be selected once');
    }
    const player = leagueDataset.players.find((candidate) => candidate.key === selection.playerKey);
    if (!player) throw new HttpError(400, `Unknown player: ${selection.playerKey}`);
    seen.add(player.key);
    clean.push({ playerKey: player.key, playerName: player.name });
  }
  return clean;
}

/**
 * The keeper dataset as the league actually stands: commissioner overrides
 * first, then every accepted pick transfer. Anything that reads pick ownership
 * must go through here, or a traded pick shows up under the wrong team.
 */
function currentDataset(state: LeagueDynamicState, base: LeagueDataset = leagueDataset): LeagueDataset {
  return datasetForState(applyOverrides(base, state.overrides), state);
}

function validateKeeperSelections(
  state: LeagueDynamicState,
  target: string,
  selections: KeeperSelection[],
): void {
  const dataset = currentDataset(state);
  const validation = resolveTeamKeepers(dataset, target, selections);
  if (!validation.capOk) {
    throw new HttpError(
      400,
      `Keeper cap exceeded: ${validation.capUsed.toFixed(1)} / ${validation.capLimit.toFixed(1)} FPPG`,
    );
  }
  if (!validation.valid) {
    throw new HttpError(400, validation.errors[0] ?? 'Invalid keeper selection');
  }
}

// ─── Auth middleware ─────────────────────────────────────────────────────────

/**
 * Two ways in while the league changes over: an emailed sign-in link, which
 * leaves a session, or the old owner and PIN pair. PINs go once everyone has
 * used a link at least once, and not a day before the draft.
 */
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = req.header('x-session');
  const owner = req.header('x-owner');
  const pin = req.header('x-pin');
  if (!session && (!owner || !pin)) {
    res.status(401).json({ error: 'Sign in to do that' });
    return;
  }
  try {
    if (session) {
      const check = await verifySession(session, new Date());
      if (!check.ok || !check.owner) {
        res.status(401).json({ error: 'Your sign-in has expired' });
        return;
      }
      res.locals.owner = check.owner;
      res.locals.isCommissioner = check.isCommissioner === true;
      res.locals.mustChangePin = false;
      res.locals.actingBy = check.impersonatedBy ?? null;
      next();
      return;
    }
    const result = await verifyPin(owner as string, pin as string);
    if (!result.ok) {
      res.status(401).json({ error: 'Invalid owner or PIN' });
      return;
    }
    res.locals.owner = owner;
    res.locals.isCommissioner = result.isCommissioner;
    res.locals.mustChangePin = result.mustChangePin;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Who to blame in the audit log.
 *
 * When the commissioner is acting as someone else, both names go in. Without
 * this, impersonation would quietly destroy the one thing the log is for:
 * answering who actually did it.
 */
function actor(res: Response): string {
  const owner = res.locals.owner as string;
  const by = res.locals.actingBy as string | null | undefined;
  return by ? `${by} as ${owner}` : owner;
}

/** Must run after requireAuth in the middleware chain. */
function requireCommissioner(_req: Request, res: Response, next: NextFunction): void {
  if (res.locals.isCommissioner !== true) {
    res.status(403).json({ error: 'Commissioner access required' });
    return;
  }
  next();
}

// ─── Keeper secrecy ──────────────────────────────────────────────────────────
//
// The commissioner sees every keeper unless he has gone blind (Commish Mode),
// which makes him a member for keeper secrecy so achievement reveals work for
// him too. Every check below asks this, never isCommissioner alone.

function seesAllKeepers(state: LeagueDynamicState, isCommissioner: boolean): boolean {
  return isCommissioner && state.commishBlind !== true;
}

//
// Until draft day (DRAFT_AT), each owner may see only their OWN keepers; the
// commissioner sees everything. Enforced here — every response that carries
// league state passes through redactState() so the raw payload never leaks.

interface Viewer {
  owner: string | null;
  isCommissioner: boolean;
}

/** Best-effort identity from an optional session or PIN header (never throws). */
async function optionalViewer(req: Request): Promise<Viewer> {
  const session = req.header('x-session');
  if (session) {
    try {
      const check = await verifySession(session, new Date());
      if (check.ok && check.owner) {
        return { owner: check.owner, isCommissioner: check.isCommissioner === true };
      }
    } catch {
      return { owner: null, isCommissioner: false };
    }
    return { owner: null, isCommissioner: false };
  }
  const owner = req.header('x-owner');
  const pin = req.header('x-pin');
  if (!owner || !pin) return { owner: null, isCommissioner: false };
  try {
    const v = await verifyPin(owner, pin);
    return v.ok ? { owner, isCommissioner: v.isCommissioner } : { owner: null, isCommissioner: false };
  } catch {
    return { owner: null, isCommissioner: false };
  }
}

function stateMeta(state: LeagueDynamicState, viewer: Viewer) {
  const revealed = state.keepersRevealed === true;
  const keeperStatus: Record<string, number> = {};
  for (const [owner, sels] of Object.entries(state.keepers)) {
    keeperStatus[owner] = sels.length;
  }
  const proposals = expireStale(proposalsOf(state), new Date().toISOString()).proposals;
  return {
    pendingTrades: inboxCount(proposals, viewer.owner),
    draftAt: DRAFT_AT_ISO,
    /** The one draft whose picks can be traded right now. */
    tradeableSeason: tradeableSeason(state, leagueDataset),
    draftClosedAt: state.draft.closedAt ?? null,
    revealed,
    keeperStatus,
    playerPool: {
      activeSnapshotId: state.playerPool?.activeSnapshotId ?? FALLBACK_PLAYER_POOL.id,
      draftSnapshotId: state.draft.playerPoolSnapshotId ?? null,
    },
    schedule: {
      activeSnapshotId: state.schedule?.activeSnapshotId ?? FALLBACK_SCHEDULE.id,
    },
    draftRankings: {
      activeSnapshotId: state.draftRankings?.activeSnapshotId ?? FALLBACK_DRAFT_RANKINGS.id,
    },
    viewer: viewer.owner,
    isCommissioner: viewer.isCommissioner,
    revealsReady: revealsReadyFor(state, viewer),
    /** The commissioner chose not to see other teams' keepers. Only ever true for him. */
    commishBlind: viewer.isCommissioner && state.commishBlind === true,
  };
}

/** Keeper reveals this viewer could spend now. Drives the VAULT badge. */
function revealsReadyFor(state: LeagueDynamicState, viewer: Viewer): number {
  if (!viewer.owner || seesAllKeepers(state, viewer.isCommissioner) || state.keepersRevealed === true) return 0;
  const ledger = ledgerOf(state.achievements);
  const reveals = ledger.reveals[viewer.owner] ?? [];
  const left = revealsLeft(earnedCount(ledger.earned[viewer.owner]), reveals.length);
  return revealsReady(left, hiddenCount(hiddenKeepers(viewer.owner, OWNERS, state.keepers, reveals)));
}

/**
 * The keepers this owner has revealed, team by team, as they stand now. A
 * revealed player the team has since dropped is left out.
 */
function revealedKeepersFor(state: LeagueDynamicState, owner: string): Record<string, KeeperSelection[]> {
  const shown = ledgerOf(state.achievements).reveals[owner] ?? [];
  const out: Record<string, KeeperSelection[]> = {};
  for (const target of new Set(shown.map((r) => r.target))) {
    if (target === owner) continue;
    const keys = new Set(shown.filter((r) => r.target === target).map((r) => r.playerKey));
    const kept = (state.keepers[target] ?? []).filter((k) => keys.has(k.playerKey));
    if (kept.length > 0) out[target] = kept;
  }
  return out;
}

function redactState<T extends { state: LeagueDynamicState }>(result: T, viewer: Viewer) {
  const meta = stateMeta(result.state, viewer);
  let keepers = result.state.keepers;
  if (!meta.revealed && !seesAllKeepers(result.state, viewer.isCommissioner)) {
    // Your own keepers, plus only the ones you have revealed with achievements.
    keepers = viewer.owner ? revealedKeepersFor(result.state, viewer.owner) : {};
    if (viewer.owner && result.state.keepers[viewer.owner]) {
      keepers[viewer.owner] = result.state.keepers[viewer.owner];
    }
  }
  // Pending offers are between two members. Accepted trades are league news,
  // so the ledger itself is never redacted.
  const proposals = expireStale(proposalsOf(result.state), new Date().toISOString()).proposals;
  const state: LeagueDynamicState = {
    ...result.state,
    keepers,
    pickTransfers: transfersOf(result.state),
    pickTradeProposals: visibleProposals(proposals, viewer.owner, viewer.isCommissioner),
  };
  // Whose keepers each owner has revealed is theirs alone. Prop bets have
  // their own route, so they stay out of the poll payload.
  delete state.achievements;
  delete state.propBets;
  return { ...result, state, meta };
}

// ─── The shared test draft ───────────────────────────────────────────────────
//
// A device that has joined the test sends x-test-draft: 1. On the draft
// routes below that header swaps the league for the test copy, which lives in
// its own row and writes nothing to the audit log. Any other write carrying it
// is refused, so a joined device can never touch the real league by mistake.

const TEST_DRAFT_ROUTES = [
  /^\/state$/,
  /^\/draft\/pick(\/\d+)?$/,
  /^\/draft\/clock\/(expire|call|pause|resume)$/,
  /^\/draft\/auto(\/[^/]+)?$/,
  /^\/test-draft\/(start|end)$/,
  /^\/draft-room$/,
  /^\/draft\/queue$/,
];

router.use((req, res, next) => {
  if (req.header(TEST_DRAFT_HEADER) !== '1') {
    next();
    return;
  }
  if (TEST_DRAFT_ROUTES.some((route) => route.test(req.path))) {
    res.locals.testDraft = true;
    res.locals.testDraftStartedAt = req.header(TEST_DRAFT_SESSION_HEADER);
    next();
    return;
  }
  if (req.method === 'GET') {
    next();
    return;
  }
  res.status(409).json({ error: 'Leave the test draft before you change the league' });
});

const inTestDraft = (res: Response): boolean => res.locals.testDraft === true;

/** The league, or the test draft for a device in the test. */
async function draftState(res: Response): Promise<StateResult> {
  if (!inTestDraft(res)) return getState();
  const test = await getTestDraft();
  if (!test) throw new HttpError(410, 'The test draft has ended');
  return test;
}

/** Change the league, or the test draft for a device in the test. */
async function mutateDraft(res: Response, fn: (draft: LeagueDynamicState) => void): Promise<MutateResult> {
  if (!inTestDraft(res)) return mutateState(fn);
  try {
    return await mutateTestDraft((draft) => {
      if (!res.locals.testDraftStartedAt || draft.draft.startedAt !== res.locals.testDraftStartedAt) {
        throw new HttpError(409, 'The test draft changed. Refresh before making a pick.');
      }
      fn(draft);
    });
  } catch (error) {
    if (error instanceof TestDraftMissingError) throw new HttpError(410, 'The test draft has ended');
    throw error;
  }
}

/** Test picks stay out of the league's audit log. */
async function auditDraft(res: Response, action: string, detail: unknown): Promise<void> {
  if (!inTestDraft(res)) await appendAudit(actor(res), action, detail);
}

/** A state reply that says whether it came from the test draft. */
function draftReply<T extends { state: LeagueDynamicState }>(res: Response, result: T, viewer: Viewer) {
  const body = redactState(result, viewer);
  if (!inTestDraft(res)) return body;
  return { ...body, meta: { ...body.meta, testDraft: { running: true, serving: true } } };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/league/state — poll target. Auth headers optional; they control
 * how much of the keeper map the caller may see (see redactState).
 */
router.get('/state', async (req, res) => {
  const viewer = await optionalViewer(req);
  const league = await getState();
  // Once the real draft starts there is no test draft: every joined device
  // gets the league back and leaves. It also spares every poll a lookup.
  const test = league.state.draft.startedAt === null ? await getTestDraft() : null;
  if (inTestDraft(res) && test) {
    res.json(draftReply(res, test, viewer));
    return;
  }
  const body = redactState(league, viewer);
  res.json({ ...body, meta: { ...body.meta, testDraft: { running: test !== null, serving: false } } });
});

/** GET /api/league/player-pool — active or draft-pinned pool. */
router.get('/player-pool', async (_req, res) => {
  const { state } = await getState();
  const snapshot = await resolveDraftPlayerPool(state);
  res.json({
    snapshot,
    fallback: snapshot.id === FALLBACK_PLAYER_POOL.id,
    draftSnapshotId: state.draft.playerPoolSnapshotId ?? null,
  });
});

/** GET /api/league/schedule — current immutable schedule snapshot. */
router.get('/schedule', requireAuth, requireCommissioner, async (_req, res) => {
  const { state } = await getState();
  const snapshot = await resolveCurrentSchedule(state);
  res.json({
    snapshot,
    fallback: snapshot.id === FALLBACK_SCHEDULE.id,
  });
});

/** POST /api/league/schedule/preview — validate and diff a candidate without writing. */
router.post('/schedule/preview', requireAuth, requireCommissioner, async (req, res) => {
  let candidate;
  try {
    candidate = parseScheduleCandidate(req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid schedule' });
    return;
  }
  const { state } = await getState();
  const prepared = await prepareScheduleCandidate(state, candidate);
  res.json({
    currentSnapshotId: prepared.currentSnapshot.id,
    candidateSnapshotId: prepared.snapshotId,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/** POST /api/league/schedule/accept — accept the exact previewed candidate. */
router.post('/schedule/accept', requireAuth, requireCommissioner, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.expectedCurrentSnapshotId !== 'string' || body.expectedCurrentSnapshotId === '') {
    res.status(400).json({ error: 'expectedCurrentSnapshotId is required' });
    return;
  }
  if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
    res.status(400).json({ error: 'fingerprint is required' });
    return;
  }

  let candidate;
  try {
    candidate = parseScheduleCandidate(body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid schedule' });
    return;
  }
  const { state } = await getState();
  const prepared = await prepareScheduleCandidate(state, candidate);
  if (body.expectedCurrentSnapshotId !== prepared.currentSnapshot.id) {
    res.status(409).json({ error: 'The active schedule changed; preview again' });
    return;
  }
  if (body.fingerprint !== prepared.fingerprint) {
    res.status(409).json({ error: 'The candidate no longer matches the preview; preview again' });
    return;
  }
  if (state.schedule?.activeSnapshotId === prepared.snapshotId) {
    res.status(409).json({ error: 'The candidate already matches the active schedule' });
    return;
  }

  const acceptedAt = new Date().toISOString();
  const acceptedBy = res.locals.owner as string;
  const snapshot = makeScheduleSnapshot(prepared, acceptedAt, acceptedBy);
  const result = await acceptScheduleSnapshot(
    snapshot,
    body.expectedCurrentSnapshotId,
    FALLBACK_SCHEDULE.id,
    acceptedAt,
    acceptedBy,
  );
  await appendAudit(actor(res), 'schedule.accepted', {
    snapshotId: snapshot.id,
    baseSnapshotId: snapshot.baseSnapshotId,
    status: snapshot.status,
    changedTeamPeriods: prepared.preview.changedTeamPeriods.length,
    changedMappings: prepared.preview.changedMappings.length,
  });
  res.json({
    ...redactState(result, { owner: acceptedBy, isCommissioner: true }),
    snapshot,
  });
});

/** Fetch every ESPN player page and preview it without writing. */
router.post('/player-pool/fetch-preview', requireAuth, requireCommissioner, async (_req, res) => {
  const candidate = await fetchEspnPlayerPoolCandidate();
  const { state } = await getState();
  const prepared = await preparePlayerPoolCandidate(state, candidate);
  res.json({
    candidate,
    currentSnapshotId: prepared.currentSnapshot.id,
    candidateSnapshotId: prepared.snapshotId,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/**
 * POST /api/league/player-pool/preview — normalize a full ESPN pool and return
 * its exact no-write diff against the active pool.
 */
router.post('/player-pool/preview', requireAuth, requireCommissioner, async (req, res) => {
  let candidate;
  try {
    candidate = parsePlayerPoolCandidate(req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid player pool' });
    return;
  }
  const { state } = await getState();
  const prepared = await preparePlayerPoolCandidate(state, candidate);
  res.json({
    currentSnapshotId: prepared.currentSnapshot.id,
    candidateSnapshotId: prepared.snapshotId,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/**
 * POST /api/league/player-pool/accept — accept the exact candidate that was
 * previewed. The store changes the active pointer only if the base is still
 * current and the draft has not started.
 */
router.post('/player-pool/accept', requireAuth, requireCommissioner, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.expectedCurrentSnapshotId !== 'string' || body.expectedCurrentSnapshotId === '') {
    res.status(400).json({ error: 'expectedCurrentSnapshotId is required' });
    return;
  }
  if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
    res.status(400).json({ error: 'fingerprint is required' });
    return;
  }

  let candidate;
  try {
    candidate = parsePlayerPoolCandidate(body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid player pool' });
    return;
  }

  const { state } = await getState();
  const prepared = await preparePlayerPoolCandidate(state, candidate);
  if (body.expectedCurrentSnapshotId !== prepared.currentSnapshot.id) {
    res.status(409).json({ error: 'The active player pool changed; preview again' });
    return;
  }
  if (body.fingerprint !== prepared.fingerprint) {
    res.status(409).json({ error: 'The candidate no longer matches the preview; preview again' });
    return;
  }
  if (prepared.snapshotId === prepared.currentSnapshot.id) {
    res.status(409).json({ error: 'The candidate already matches the active player pool' });
    return;
  }

  const acceptedAt = new Date().toISOString();
  const acceptedBy = res.locals.owner as string;
  const snapshot = makePlayerPoolSnapshot(candidate, prepared, acceptedAt, acceptedBy);
  const result = await acceptPlayerPoolSnapshot(
    snapshot,
    body.expectedCurrentSnapshotId,
    FALLBACK_PLAYER_POOL.id,
    acceptedAt,
    acceptedBy,
  );
  await appendAudit(actor(res), 'player_pool.accepted', {
    snapshotId: snapshot.id,
    baseSnapshotId: snapshot.baseSnapshotId,
    sourceSeason: snapshot.sourceSeason,
    playerCount: snapshot.players.length,
    added: prepared.preview.added.length,
    removed: prepared.preview.removed.length,
    retainedMissing: prepared.preview.retainedMissing.length,
    nameChanged: prepared.preview.nameChanged.length,
    teamChanged: prepared.preview.teamChanged.length,
    positionChanged: prepared.preview.positionChanged.length,
  });
  res.json({
    ...redactState(result, { owner: acceptedBy, isCommissioner: true }),
    snapshot,
  });
});

/**
 * POST /api/league/team-names/fetch-preview — read the team names ESPN has
 * right now and show what would change. Writes nothing.
 */
router.post('/team-names/fetch-preview', requireAuth, requireCommissioner, async (_req, res) => {
  const candidate = await fetchEspnTeamNameCandidate();
  const { state } = await getState();
  const prepared = prepareTeamNameCandidate(state, candidate);
  res.json({
    candidate,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/**
 * POST /api/league/team-names/accept — store the exact names that were
 * previewed. The fingerprint has to still match, so a stale tab cannot write
 * names nobody looked at.
 */
router.post('/team-names/accept', requireAuth, requireCommissioner, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
    res.status(400).json({ error: 'fingerprint is required' });
    return;
  }

  let candidate;
  try {
    candidate = parseTeamNameCandidate(body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid team names' });
    return;
  }

  const { state } = await getState();
  const prepared = prepareTeamNameCandidate(state, candidate);
  if (body.fingerprint !== prepared.fingerprint) {
    res.status(409).json({ error: 'The names changed since the preview; fetch them again' });
    return;
  }
  if (prepared.preview.changes.length === 0) {
    res.status(409).json({ error: 'Nothing changed, so nothing was saved' });
    return;
  }

  const owner = res.locals.owner as string;
  const result = await mutateState((draft) => {
    draft.teamNames = { ...prepared.preview.nextNames };
  });
  await appendAudit(actor(res), 'team_names.accepted', {
    sourceSeason: candidate.sourceSeason,
    fetchedAt: candidate.fetchedAt,
    changed: prepared.preview.changes.length,
    unchanged: prepared.preview.unchanged.length,
    missing: prepared.preview.missing.length,
    unknownEspnTeamIds: prepared.preview.unknownEspnTeamIds.length,
  });
  res.json({
    ...redactState(result, { owner, isCommissioner: true }),
    preview: prepared.preview,
  });
});

// ─── Draft rankings ──────────────────────────────────────────────────────────
//
// ESPN's ADP, draft ranks and projections, frozen the same way as the player
// pool. Any signed-in owner reads them, for the mock draft and projections.
// Only the commissioner fetches or accepts new ones.

// ─── Award odds and depth charts ─────────────────────────────────────────────

/** GET /api/league/nba-watch — Kalshi award odds and ESPN depth charts. `?fresh=1` reads them again. */
router.get('/nba-watch', requireAuth, requireCommissioner, async (req, res) => {
  try {
    res.json(await getNbaWatch(req.query.fresh === '1'));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Could not read the odds or depth charts.' });
  }
});

// ─── Mock draft history ──────────────────────────────────────────────────────
//
// Each signed-in member keeps their own finished, graded mocks. The owner
// comes from the sign-in, never the body. The commissioner keeps every one;
// everyone else keeps their latest ten.

/** GET /api/league/mock-stats — every owner's finished mocks and best grade. Everyone sees it. */
router.get('/mock-stats', requireAuth, async (_req, res) => {
  const finishes = await listMockFinishes(leagueDataset.season);
  res.json({ stats: mockStats(OWNERS, finishes) });
});

/** GET /api/league/mock-results — your saved mocks, newest first. */
router.get('/mock-results', requireAuth, async (_req, res) => {
  const rows = await listMockResults(leagueDataset.season, res.locals.owner as string);
  res.json({ results: rows.map((row) => row.result) });
});

/** POST /api/league/mock-results — save a finished mock. The same draft saves once. */
router.post('/mock-results', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  let record;
  try {
    record = parseMockResult(owner, req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'That result is not valid' });
    return;
  }
  const keep = res.locals.isCommissioner === true ? null : MEMBER_MOCK_LIMIT;
  await saveMockResult({ season: leagueDataset.season, owner, id: record.id, result: record, createdAt: record.finishedAt }, keep);
  res.json({ result: record });
});

/**
 * GET /api/league/mock-results/:id — one finished mock, for a shared link.
 * No sign-in: the link is the ticket. The id is a hash, so it cannot be guessed.
 */
router.get('/mock-results/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^mock-[a-z0-9]+-\d+$/.test(id)) {
    res.status(404).json({ error: 'No such mock.' });
    return;
  }
  const row = await findMockResult(leagueDataset.season, id);
  if (!row) {
    res.status(404).json({ error: 'No such mock. It may have been forgotten.' });
    return;
  }
  res.json({ result: row.result });
});

/** DELETE /api/league/mock-results/:id — forget one of your mocks. */
router.delete('/mock-results/:id', requireAuth, async (req, res) => {
  await deleteMockResult(leagueDataset.season, res.locals.owner as string, String(req.params.id));
  res.json({ ok: true });
});

// ─── Projection edits ────────────────────────────────────────────────────────
//
// Each owner's own changes to ESPN's projections, one row per owner and
// player. Nobody sees another owner's edits; with none, you see ESPN's line.
// The owner comes from the sign-in, never the body. The client lays the edits
// over the accepted rankings snapshot; the snapshot itself is never touched,
// so a fresh ESPN fetch keeps every edit on top.

/** The commissioner's two games estimates made before edits had a screen, written once. */
async function seedProjectionEdits(season: number, by: string): Promise<void> {
  if (!(await claimSentNotice(`projection-edits-seed-${season}`, season))) return;
  const at = new Date().toISOString();
  for (const seed of SEED_EDITS) {
    const edit: ProjectionEdit = { ...seed, editedAt: at, editedBy: by };
    await saveProjectionEdit({ season, owner: by, espnId: seed.espnId, edit, updatedAt: at, updatedBy: by });
  }
}

/** GET /api/league/projection-edits — your own edits this season. */
router.get('/projection-edits', requireAuth, async (_req, res) => {
  const season = leagueDataset.season;
  const owner = res.locals.owner as string;
  if (res.locals.isCommissioner === true) await seedProjectionEdits(season, owner);
  const rows = await listProjectionEdits(season, owner);
  res.json({ season, edits: rows.map((row) => row.edit) });
});

/** PUT /api/league/projection-edits/:espnId — save one player's edit, for you alone. */
router.put('/projection-edits/:espnId', requireAuth, async (req, res) => {
  const season = leagueDataset.season;
  let parsed;
  try {
    parsed = parseProjectionEdit(Number(req.params.espnId), req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'That edit is not valid' });
    return;
  }
  const at = new Date().toISOString();
  const by = res.locals.owner as string;
  const edit: ProjectionEdit = { ...parsed, editedAt: at, editedBy: by };
  await saveProjectionEdit({ season, owner: by, espnId: edit.espnId, edit, updatedAt: at, updatedBy: by });
  await appendAudit(actor(res), 'projection_edit.saved', { espnId: edit.espnId, name: edit.name });
  res.json({ edit });
});

/** DELETE /api/league/projection-edits/:espnId — your line back to ESPN's projection. */
router.delete('/projection-edits/:espnId', requireAuth, async (req, res) => {
  const espnId = Number(req.params.espnId);
  if (!Number.isInteger(espnId) || espnId <= 0) {
    res.status(400).json({ error: 'That is not a player.' });
    return;
  }
  await deleteProjectionEdit(leagueDataset.season, res.locals.owner as string, espnId);
  await appendAudit(actor(res), 'projection_edit.removed', { espnId });
  res.json({ ok: true });
});

/**
 * GET /api/league/expert-projections — Hashtag Basketball's lines, for the
 * commissioner's ESPN, Hashtag or Blend switch. Nobody else sees them.
 */
router.get('/expert-projections', requireAuth, requireCommissioner, (_req, res) => {
  res.json(hashtagProjections);
});

/** GET /api/league/draft-rankings — the accepted snapshot, or the empty fallback. */
router.get('/draft-rankings', requireAuth, async (_req, res) => {
  const { state } = await getState();
  const snapshot = await resolveCurrentDraftRankings(state);
  res.json({
    snapshot,
    fallback: snapshot.id === FALLBACK_DRAFT_RANKINGS.id,
  });
});

/** Read ESPN's draft numbers right now and preview them without writing. */
router.post('/draft-rankings/fetch-preview', requireAuth, requireCommissioner, async (_req, res) => {
  const candidate = await fetchEspnDraftRankingCandidate();
  const { state } = await getState();
  const prepared = await prepareDraftRankingCandidate(state, candidate);
  res.json({
    candidate,
    currentSnapshotId: prepared.currentSnapshot.id,
    candidateSnapshotId: prepared.snapshotId,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/** POST /api/league/draft-rankings/preview — diff a candidate, write nothing. */
router.post('/draft-rankings/preview', requireAuth, requireCommissioner, async (req, res) => {
  let candidate;
  try {
    candidate = parseDraftRankingCandidate(req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid draft rankings' });
    return;
  }
  const { state } = await getState();
  const prepared = await prepareDraftRankingCandidate(state, candidate);
  res.json({
    currentSnapshotId: prepared.currentSnapshot.id,
    candidateSnapshotId: prepared.snapshotId,
    fingerprint: prepared.fingerprint,
    preview: prepared.preview,
  });
});

/**
 * POST /api/league/draft-rankings/accept — store the exact candidate that was
 * previewed. The base has to still be current; the draft may have started.
 */
router.post('/draft-rankings/accept', requireAuth, requireCommissioner, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.expectedCurrentSnapshotId !== 'string' || body.expectedCurrentSnapshotId === '') {
    res.status(400).json({ error: 'expectedCurrentSnapshotId is required' });
    return;
  }
  if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
    res.status(400).json({ error: 'fingerprint is required' });
    return;
  }

  let candidate;
  try {
    candidate = parseDraftRankingCandidate(body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid draft rankings' });
    return;
  }

  const { state } = await getState();
  const prepared = await prepareDraftRankingCandidate(state, candidate);
  if (body.expectedCurrentSnapshotId !== prepared.currentSnapshot.id) {
    res.status(409).json({ error: 'The active draft rankings changed; preview again' });
    return;
  }
  if (body.fingerprint !== prepared.fingerprint) {
    res.status(409).json({ error: 'The candidate no longer matches the preview; preview again' });
    return;
  }
  if (prepared.snapshotId === prepared.currentSnapshot.id) {
    res.status(409).json({ error: 'The candidate already matches the active draft rankings' });
    return;
  }

  const acceptedAt = new Date().toISOString();
  const acceptedBy = res.locals.owner as string;
  const snapshot = makeDraftRankingSnapshot(candidate, prepared, acceptedAt, acceptedBy);
  const result = await acceptDraftRankingSnapshot(
    snapshot,
    body.expectedCurrentSnapshotId,
    FALLBACK_DRAFT_RANKINGS.id,
    acceptedAt,
    acceptedBy,
  );
  await appendAudit(actor(res), 'draft_rankings.accepted', {
    snapshotId: snapshot.id,
    baseSnapshotId: snapshot.baseSnapshotId,
    sourceSeason: snapshot.sourceSeason,
    counts: prepared.preview.counts,
    added: prepared.preview.added.length,
    removed: prepared.preview.removed.length,
    moved: prepared.preview.moved.length,
    projectionArrived: prepared.preview.projectionArrived,
    scoringChanged: prepared.preview.scoringChanged,
  });
  res.json({
    ...redactState(result, { owner: acceptedBy, isCommissioner: true }),
    snapshot,
  });
});

/**
 * POST /api/league/verify — validate an owner/PIN pair.
 */
router.post('/verify', requireAuth, (_req, res) => {
  res.json({
    ok: true,
    owner: res.locals.owner,
    isCommissioner: res.locals.isCommissioner,
    mustChangePin: res.locals.mustChangePin === true,
  });
});

/**
 * POST /api/league/change-pin — the authed owner replaces their own PIN
 * (works with a temporary PIN too — that's the forced first-login change).
 * Body: { pin: string } — the NEW pin, 4-8 digits.
 */
router.post('/change-pin', requireAuth, async (req, res) => {
  const pin = (req.body as { pin?: unknown } | undefined)?.pin;
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4-8 digits' });
    return;
  }
  const owner = res.locals.owner as string;
  await setPin(owner, pin, false);
  await appendAudit(actor(res), 'pin.changed', { owner });
  res.json({ ok: true });
});

/** GET /api/league/keeper-scenario — the signed-in member's private scenario. */
router.get('/keeper-scenario', requireAuth, async (_req, res) => {
  const viewer = res.locals.owner as string;
  const { state } = await getState();
  if (state.keepersRevealed === true) {
    await clearKeeperScenario(state.season, viewer);
    res.json({ season: state.season, scenario: {} });
    return;
  }
  res.json({
    season: state.season,
    scenario: await getKeeperScenario(state.season, viewer),
  });
});

/** PUT /api/league/keeper-scenario/:target — save one private projected team. */
router.put('/keeper-scenario/:target', requireAuth, async (req, res) => {
  const viewer = res.locals.owner as string;
  const target = routeParam(req.params.target);
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  if (target === viewer) {
    res.status(400).json({ error: 'Use your real keeper worksheet for your own team' });
    return;
  }

  const current = await getState();
  if (current.state.keepersRevealed === true) {
    res.status(409).json({ error: 'Real keepers have been revealed; projections are closed' });
    return;
  }
  const selections = cleanKeeperSelections(
    (req.body as { selections?: unknown } | undefined)?.selections,
  );
  validateKeeperSelections(current.state, target, selections);
  // SCOUT counts the first guess only, so keep it before this save can replace it.
  if (!ledgerOf(current.state.achievements).firstGuesses[viewer]?.[target]) {
    const saved = (await getKeeperScenario(current.state.season, viewer))[target] ?? [];
    const at = new Date().toISOString();
    await mutateState((draft) => {
      const ledger = ledgerOf(draft.achievements);
      const guess = firstGuessToRecord(
        ledger.firstGuesses[viewer]?.[target],
        saved.map((sel) => sel.playerKey),
        selections.map((sel) => sel.playerKey),
        at,
      );
      if (!guess) return;
      ledger.firstGuesses[viewer] = { ...(ledger.firstGuesses[viewer] ?? {}), [target]: guess };
      draft.achievements = ledger;
    });
  }
  const scenario = await setKeeperScenarioTarget(
    current.state.season,
    viewer,
    target,
    selections,
  );

  const latest = await getState();
  if (latest.state.keepersRevealed === true) {
    await clearKeeperScenario(latest.state.season, viewer);
    res.status(409).json({ error: 'Real keepers were revealed while this projection was saving' });
    return;
  }
  res.json({ season: current.state.season, scenario });
});

/** DELETE /api/league/keeper-scenario/:target — reset one projected team. */
router.delete('/keeper-scenario/:target', requireAuth, async (req, res) => {
  const viewer = res.locals.owner as string;
  const target = routeParam(req.params.target);
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  const { state } = await getState();
  const scenario = await setKeeperScenarioTarget(state.season, viewer, target, []);
  res.json({ season: state.season, scenario });
});

/** DELETE /api/league/keeper-scenario — clear the signed-in member's scenario. */
router.delete('/keeper-scenario', requireAuth, async (_req, res) => {
  const viewer = res.locals.owner as string;
  const { state } = await getState();
  await clearKeeperScenario(state.season, viewer);
  res.json({ season: state.season, scenario: {} });
});

/**
 * PUT /api/league/keepers/:owner — set an owner's keeper selections (max 2).
 * The authed owner must match :owner, or be the commissioner.
 */
router.put('/keepers/:owner', requireAuth, async (req, res) => {
  const target = routeParam(req.params.owner);
  const authedOwner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner as boolean;

  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  if (authedOwner !== target && !isCommissioner) {
    res.status(403).json({ error: 'You can only set your own keepers' });
    return;
  }

  const clean = cleanKeeperSelections(
    (req.body as { selections?: unknown } | undefined)?.selections,
  );

  const result = await mutateState((draft) => {
    // Blind, he cannot see what he would overwrite.
    if (authedOwner !== target && !seesAllKeepers(draft, isCommissioner)) {
      throw new HttpError(409, "Turn off blind mode in Commish Mode to edit another team's keepers");
    }
    if (draft.locks.keepersLocked && !isCommissioner) {
      throw new HttpError(423, 'Keepers are locked');
    }
    validateKeeperSelections(draft, target, clean);
    draft.keepers[target] = clean;
  });
  await appendAudit(actor(res), 'keepers.set', { target, selections: clean });
  res.json(redactState(result, { owner: authedOwner, isCommissioner }));
});

/**
 * POST /api/league/commish-blind — the commissioner stops (or starts) seeing
 * other teams' keepers, so achievement reveals work for him too.
 */
router.post('/commish-blind', requireAuth, requireCommissioner, async (req, res) => {
  const blind = (req.body as { blind?: unknown } | undefined)?.blind;
  if (typeof blind !== 'boolean') {
    res.status(400).json({ error: 'Send blind: true or false' });
    return;
  }
  const result = await mutateState((draft) => {
    draft.commishBlind = blind;
  });
  await appendAudit(actor(res), 'commish.blind', { blind });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/** POST /api/league/keeper-visibility — reveal or hide all keeper names. */
router.post('/keeper-visibility', requireAuth, requireCommissioner, async (req, res) => {
  const revealed = (req.body as { revealed?: unknown } | undefined)?.revealed;
  if (typeof revealed !== 'boolean') {
    res.status(400).json({ error: 'revealed must be a boolean' });
    return;
  }
  const result = await mutateState((draft) => {
    if (!revealed && draft.draft.startedAt !== null) {
      throw new HttpError(409, 'Keeper names cannot be hidden after the draft starts');
    }
    draft.keepersRevealed = revealed;
  });
  if (revealed) await clearKeeperScenariosForSeason(result.state.season);
  await appendAudit(actor(res), revealed ? 'keepers.revealed' : 'keepers.hidden', {
    revealed,
  });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
  // Hiding them again is housekeeping. Opening them is league news.
  if (revealed) notifyKeepersRevealed(appOrigin(req));
});

/**
 * A called clock that has run out yields the pick on the clock (rule
 * 2.3.2.1) and moves the clock to the next team. Runs before every draft
 * change and when a screen reports the countdown hit zero. Returns the
 * yielded pick, or null when nothing changed.
 */
function settleClock(
  draft: LeagueDynamicState,
  dataset: LeagueDataset,
  now: string,
  queues: Readonly<Record<string, string[]>>,
): { overall: number; playerKey: string | null } | null {
  const clock = draft.draft.clock;
  if (!clock || draft.draft.startedAt === null || !clockExpired(clock, now)) return null;
  const onClock = buildDraftBoard(dataset, draft).find((cell) => cell.onClock);
  if (!onClock) return null;
  // Time is up: the team takes the top player in its queue who is still there.
  const owner = onClock.pick.currentOwner;
  const available = availablePlayers(dataset, draft);
  const key = firstQueued(queues[owner], new Set(available.map((player) => player.key)));
  const player = key ? available.find((entry) => entry.key === key) ?? null : null;
  if (player) {
    draft.draft.picks[String(onClock.pick.overall)] = {
      playerKey: player.key,
      playerName: player.name,
      proTeam: player.proTeam,
      positions: player.positions,
      isKeeper: false,
      enteredBy: `${owner} (queue)`,
      timestamp: now,
      ...pickTiming(clock, now),
    };
    draft.draft.clock = startPickClock(now);
    return { overall: onClock.pick.overall, playerKey: player.key };
  }
  // An empty queue yields the pick, rule 2.3.2.1.
  const next = yieldPick({ clock, skipped: draft.draft.skipped }, onClock.pick.overall, now);
  draft.draft.clock = next.clock;
  draft.draft.skipped = next.skipped;
  return { overall: onClock.pick.overall, playerKey: null };
}

/** Every queue in the room this request is for. */
const queuesFor = (res: Response) => getDraftQueues(inTestDraft(res) ? 'test' : 'league');

/** Audit what a clock running out did. */
async function auditSettled(res: Response, settled: { overall: number; playerKey: string | null } | null, at: string): Promise<void> {
  if (!settled) return;
  if (settled.playerKey) await auditDraft(res, 'draft.pick_from_queue', { overallPick: settled.overall, playerKey: settled.playerKey, at });
  else await auditDraft(res, 'draft.pick_yielded', { overallPick: settled.overall, at });
}

// ─── Auto picks from private lists ───────────────────────────────────────────
//
// A member saves a list of names, best first. Nobody else reads it: not another
// member, not the commissioner, not the commissioner acting as that member.
// When the commissioner puts a team on auto, the server makes its picks from
// that list, and from the board's own order once the list runs dry. The test
// draft is a copy everybody watches, so lists stay out of it: an auto pick
// there takes the board's order only.

/** The signed-in member, and never the commissioner wearing their seat. */
function listOwner(res: Response): string {
  if (res.locals.actingBy) {
    throw new HttpError(403, "A member's rankings are theirs alone. They stay closed while you act as them.");
  }
  return res.locals.owner as string;
}

/** GET /api/league/draft-list — your own private list. */
router.get('/draft-list', requireAuth, async (_req, res) => {
  const owner = listOwner(res);
  const { state } = await getState();
  res.json({ season: state.season, list: await getDraftList(state.season, owner) });
});

/** PUT /api/league/draft-list — save your list. Body: { text: string }, one name a line. */
router.put('/draft-list', requireAuth, async (req, res) => {
  const owner = listOwner(res);
  const text = (req.body as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string') {
    res.status(400).json({ error: 'Send the list as text, one name a line' });
    return;
  }
  if (text.length > DRAFT_LIST_MAX_CHARS) {
    res.status(400).json({ error: 'That list is too long. Names only, one a line.' });
    return;
  }
  const { state } = await getState();
  const dataset = currentDataset(state, await resolveDraftDataset(state));
  const list = buildDraftList(text, dataset.players, new Date().toISOString());
  if (list.entries.length === 0) {
    await setDraftList(state.season, owner, null);
    res.json({ season: state.season, list: null });
    return;
  }
  await setDraftList(state.season, owner, list);
  res.json({ season: state.season, list });
});

/** DELETE /api/league/draft-list — clear your list. */
router.delete('/draft-list', requireAuth, async (_req, res) => {
  const owner = listOwner(res);
  const { state } = await getState();
  await setDraftList(state.season, owner, null);
  res.json({ season: state.season, list: null });
});

/**
 * GET /api/league/draft/auto — who is on auto, and who has a list saved
 * (commissioner only). Names only; no list is ever read here.
 */
router.get('/draft/auto', requireAuth, requireCommissioner, async (_req, res) => {
  const { state } = await draftState(res);
  res.json({
    autoOwners: state.draft.autoOwners ?? [],
    listOwners: inTestDraft(res) ? [] : await draftListOwners(state.season),
  });
});

/** The board moved under an auto pick; somebody else got there first. Nothing to do. */
class AutoStale extends Error {}

/**
 * Picks for every team on auto until a team that picks for itself is on the
 * clock, or the clock is paused. Runs after anything that can put a new team
 * on the clock. Returns the latest state, or null when nothing was picked.
 */
async function runAutoPicks(res: Response, draftPoolDataset: LeagueDataset): Promise<MutateResult | null> {
  let latest: MutateResult | null = null;
  let rankings: DraftRankingSnapshot | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const current = latest ?? await draftState(res);
    const state = current.state;
    if (state.draft.startedAt === null || state.draft.closedAt || isPaused(state.draft.clock)) return latest;
    const dataset = currentDataset(state, draftPoolDataset);
    const onClock = buildDraftBoard(dataset, state).find((cell) => cell.onClock);
    if (!onClock || !isOnAuto(state, onClock.pick.currentOwner)) return latest;
    const owner = onClock.pick.currentOwner;
    const overall = onClock.pick.overall;
    const list = inTestDraft(res) ? null : await getDraftList(state.season, owner);
    rankings ??= await resolveCurrentDraftRankings(state);
    const available = availablePlayers(dataset, state);
    const fallback = rankBoard(available, rankings).entries.map((entry) => entry.player);
    const choice = nextAutoPick(list, available, fallback);
    if (!choice) return latest;
    const { player } = choice;
    const timestamp = new Date().toISOString();
    try {
      latest = await mutateDraft(res, (draft) => {
        const live = currentDataset(draft, draftPoolDataset);
        const cell = buildDraftBoard(live, draft).find((entry) => entry.onClock);
        if (!cell || cell.pick.overall !== overall || cell.pick.currentOwner !== owner) throw new AutoStale();
        if (!isOnAuto(draft, owner) || isPaused(draft.draft.clock)) throw new AutoStale();
        if (!availablePlayers(live, draft).some((entry) => entry.key === player.key)) throw new AutoStale();
        draft.draft.picks[String(overall)] = {
          playerKey: player.key,
          playerName: player.name,
          proTeam: player.proTeam,
          positions: player.positions,
          isKeeper: false,
          enteredBy: owner,
          auto: true,
          timestamp,
          ...pickTiming(draft.draft.clock, timestamp),
        };
        draft.draft.clock = startPickClock(timestamp, isPaused(draft.draft.clock));
      });
    } catch (error) {
      if (error instanceof AutoStale) return latest;
      throw error;
    }
    await auditDraft(res, 'draft.pick', {
      overallPick: overall,
      playerKey: player.key,
      playerName: player.name,
      proTeam: player.proTeam,
      positions: player.positions,
      isKeeper: false,
      writeIn: false,
      auto: true,
    });
  }
  return latest;
}

/**
 * POST /api/league/draft/auto/:owner — put a team on auto, or take it off
 * (commissioner only). Body: { on: boolean }. Putting a team on auto while it
 * is on the clock makes its pick at once.
 */
router.post('/draft/auto/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const owner = routeParam(req.params.owner);
  if (!isKnownOwner(owner)) {
    res.status(404).json({ error: `Unknown owner: ${owner}` });
    return;
  }
  const on = (req.body as { on?: unknown } | undefined)?.on;
  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'on must be true or false' });
    return;
  }
  const current = await draftState(res);
  const draftPoolDataset = await resolveDraftDataset(current.state);
  const result = await mutateDraft(res, (draft) => {
    draft.draft.autoOwners = withAuto(draft.draft.autoOwners, owner, on);
  });
  await auditDraft(res, on ? 'draft.auto_on' : 'draft.auto_off', { owner });
  const auto = on ? await runAutoPicks(res, draftPoolDataset) : null;
  res.json(draftReply(res, auto ?? result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/clock/expire — a screen saw the countdown hit zero.
 * Any signed-in member may report it; the server checks its own clock and
 * does nothing when time is still left or the pick already moved on.
 */
router.post('/draft/clock/expire', requireAuth, async (_req, res) => {
  const current = await draftState(res);
  const draftPoolDataset = await resolveDraftDataset(current.state);
  const now = new Date().toISOString();
  const queues = await queuesFor(res);
  let settled: ReturnType<typeof settleClock> = null;
  const result = await mutateDraft(res, (draft) => {
    settled = settleClock(draft, currentDataset(draft, draftPoolDataset), now, queues);
  });
  await auditSettled(res, settled, now);
  // The clock moved on; the team now up may be on auto.
  const auto = settled !== null ? await runAutoPicks(res, draftPoolDataset) : null;
  res.json(draftReply(res, auto ?? result, { owner: res.locals.owner as string, isCommissioner: res.locals.isCommissioner as boolean }));
});

/**
 * POST /api/league/draft/pick — record a draft pick.
 * Body: { overallPick: number, playerKey: string, playerName: string, isKeeper?: boolean }
 */
router.post('/draft/pick', requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const overallPick = body.overallPick;
  const playerKey = body.playerKey;

  if (typeof overallPick !== 'number' || !Number.isInteger(overallPick) || overallPick < 1) {
    res.status(400).json({ error: 'overallPick must be a positive integer' });
    return;
  }
  if (
    typeof playerKey !== 'string' || playerKey.length === 0
  ) {
    res.status(400).json({ error: 'playerKey is required' });
    return;
  }

  const authedOwner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner as boolean;
  const current = await draftState(res);
  const draftPoolDataset = await resolveDraftDataset(current.state);
  // A write-in is a player the locked pool does not have: name, team and position typed in.
  const writeIn = body.writeIn === true;
  let player: { key: string; name: string; proTeam: string; positions: string[] };
  if (writeIn) {
    const parsed = parseWriteIn({ name: body.playerName, proTeam: body.proTeam, positions: body.positions });
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    player = parsed.player;
  } else {
    const found = draftPoolDataset.players.find((candidate) => candidate.key === playerKey);
    if (!found) {
      res.status(400).json({ error: `Unknown player: ${playerKey}` });
      return;
    }
    player = found;
  }
  const timestamp = new Date().toISOString();
  const queues = await queuesFor(res);
  let settled: ReturnType<typeof settleClock> = null;
  const result = await mutateDraft(res, (draft) => {
    if (draft.draft.startedAt === null) {
      throw new HttpError(409, "The draft hasn't started yet — the commissioner has to hit START DRAFT.");
    }
    const dataset = currentDataset(draft, draftPoolDataset);
    settled = settleClock(draft, dataset, timestamp, queues);
    const board = buildDraftBoard(dataset, draft);
    const onClock = board.find((cell) => cell.onClock);
    // A yielded pick is its owner's to fill any time, rule 2.3.2.2.
    const target = board.find((cell) => cell.pick.overall === overallPick && cell.skipped) ?? null;
    if (!target) {
      if (!onClock) throw new HttpError(409, 'The draft is complete');
      if (onClock.pick.overall !== overallPick) {
        throw new HttpError(409, `Pick #${onClock.pick.overall} is on the clock`);
      }
    }
    const cell = target ?? onClock!;
    if (!isCommissioner && cell.pick.currentOwner !== authedOwner) {
      throw new HttpError(403, `Only ${cell.pick.currentOwner} can enter this pick`);
    }
    if (writeIn) {
      const wanted = player.name.toLowerCase();
      const inPool = dataset.players.find((entry) => entry.name.toLowerCase() === wanted || entry.fullName?.toLowerCase() === wanted);
      if (inPool) throw new HttpError(409, `${inPool.fullName ?? inPool.name} is in the player pool. Pick him from the list.`);
      if (nameTaken(player.name, draft.draft.picks, [], new Set())) throw new HttpError(409, `${player.name} is already on the board`);
    } else if (!availablePlayers(dataset, draft).some((candidate) => candidate.key === player.key)) {
      throw new HttpError(409, `${player.name} is already off the board`);
    }
    const yielded = draft.draft.skipped?.[String(overallPick)];
    draft.draft.picks[String(overallPick)] = {
      playerKey: player.key,
      playerName: player.name,
      proTeam: player.proTeam,
      positions: player.positions,
      isKeeper: false,
      enteredBy: authedOwner,
      timestamp,
      ...(target && yielded
        ? { skipped: true, clockCalledBy: yielded.calledBy || null }
        : pickTiming(draft.draft.clock, timestamp)),
    };
    if (target) {
      // Filling a yielded pick does not touch the team on the clock.
      if (draft.draft.skipped) delete draft.draft.skipped[String(overallPick)];
    } else {
      // The next team's time starts now. A pause the commish set stays set.
      draft.draft.clock = startPickClock(timestamp, isPaused(draft.draft.clock));
    }
  });
  await auditSettled(res, settled, timestamp);
  await auditDraft(res, 'draft.pick', {
    overallPick,
    playerKey: player.key,
    playerName: player.name,
    proTeam: player.proTeam,
    positions: player.positions,
    isKeeper: false,
    writeIn,
  });
  // The next team may be on auto; its pick lands before this reply goes out.
  const auto = await runAutoPicks(res, draftPoolDataset);
  res.json(draftReply(res, auto ?? result, { owner: authedOwner, isCommissioner }));
});

/**
 * DELETE /api/league/draft/pick/:overallPick — clear a pick (commissioner only).
 */
router.delete('/draft/pick/:overallPick', requireAuth, requireCommissioner, async (req, res) => {
  const overallPick = parseInt(routeParam(req.params.overallPick), 10);
  if (isNaN(overallPick) || overallPick < 1) {
    res.status(400).json({ error: 'Invalid overallPick' });
    return;
  }
  const result = await mutateDraft(res, (draft) => {
    const was = draft.draft.picks[String(overallPick)];
    delete draft.draft.picks[String(overallPick)];
    if (was?.skipped) {
      // A late-filled pick goes back to being yielded; the clock stays where it is.
      draft.draft.skipped = { ...(draft.draft.skipped ?? {}), [String(overallPick)]: { at: new Date().toISOString(), calledBy: was.clockCalledBy ?? '' } };
    } else if (draft.draft.startedAt !== null) {
      // Clearing a pick puts that team back on the clock with a fresh timer.
      draft.draft.clock = startPickClock(new Date().toISOString(), isPaused(draft.draft.clock));
    }
  });
  await auditDraft(res, 'draft.pick_cleared', { overallPick });
  res.json(draftReply(res, result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/start — open the draft (commissioner only).
 * Until this runs, the board is static and no picks can be entered.
 */
router.post('/draft/start', requireAuth, requireCommissioner, async (_req, res) => {
  const result = await mutateState((draft) => {
    if (draft.keepersRevealed !== true) {
      throw new HttpError(409, 'Reveal keeper names before starting the draft');
    }
    const dataset = currentDataset(draft);
    for (const team of dataset.teams) {
      const validation = resolveTeamKeepers(dataset, team.owner, draft.keepers[team.owner] ?? []);
      if (!validation.valid) {
        throw new HttpError(409, `${team.owner}'s keeper choices must be fixed before the draft starts`);
      }
    }
    if (draft.draft.startedAt === null) {
      draft.draft.playerPoolSnapshotId =
        draft.playerPool?.activeSnapshotId ?? FALLBACK_PLAYER_POOL.id;
      draft.draft.startedAt = new Date().toISOString();
      draft.draft.clock = startPickClock(draft.draft.startedAt);
    }
  });
  // The real draft closes any test draft, so no phone keeps picking in it.
  await setTestDraft(null);
  await appendAudit(actor(res), 'draft.started', null);
  const auto = await runAutoPicks(res, await resolveDraftDataset(result.state));
  res.json(redactState(auto ?? result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/clock/call — call CLOCK on the team picking (rule 2.3.1).
 * Any signed-in member, not on their own pick, once every five picks. The
 * commissioner has no cooldown. Nothing is skipped when time runs out; the
 * yield in 2.3.2.1 stays a call at the table.
 */
router.post('/draft/clock/call', requireAuth, async (_req, res) => {
  const caller = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner as boolean;
  const current = await draftState(res);
  const draftPoolDataset = await resolveDraftDataset(current.state);
  const now = new Date().toISOString();
  let calledOn = '';
  const queues = await queuesFor(res);
  let settled: ReturnType<typeof settleClock> = null;
  const result = await mutateDraft(res, (draft) => {
    if (draft.draft.startedAt === null) throw new HttpError(409, 'The draft has not started');
    const dataset = currentDataset(draft, draftPoolDataset);
    settled = settleClock(draft, dataset, now, queues);
    const onClock = buildDraftBoard(dataset, draft).find((cell) => cell.onClock) ?? null;
    const check = canCallClock({ clock: draft.draft.clock, picks: draft.draft.picks, onClock, caller, isCommissioner, now });
    if (!check.ok) {
      const why: Record<typeof check.reason, string> = {
        'not-started': 'The draft has not started',
        complete: 'The draft is complete',
        'own-pick': 'You cannot call CLOCK on your own pick',
        'already-called': 'CLOCK is already running on this pick',
        paused: 'The clock is paused',
        'too-early': `Give them their time first: CLOCK opens in ${check.secondsToWait} second${check.secondsToWait === 1 ? '' : 's'}`,
        cooldown: `You can call CLOCK again in ${check.picksToWait} pick${check.picksToWait === 1 ? '' : 's'}`,
      };
      throw new HttpError(check.reason === 'own-pick' ? 403 : 409, why[check.reason]);
    }
    calledOn = onClock!.pick.currentOwner;
    draft.draft.clock = callClock(draft.draft.clock!, caller, now);
  });
  await auditSettled(res, settled, now);
  await auditDraft(res, 'draft.clock_called', { on: calledOn, at: now });
  const auto = settled !== null ? await runAutoPicks(res, draftPoolDataset) : null;
  res.json(draftReply(res, auto ?? result, { owner: caller, isCommissioner }));
});

/** POST /api/league/draft/clock/pause — freeze the pick timer and any CLOCK (commissioner only). */
router.post('/draft/clock/pause', requireAuth, requireCommissioner, async (_req, res) => {
  const now = new Date().toISOString();
  const result = await mutateDraft(res, (draft) => {
    if (draft.draft.startedAt === null || !draft.draft.clock) throw new HttpError(409, 'The draft has not started');
    draft.draft.clock = pauseClock(draft.draft.clock, now);
  });
  await auditDraft(res, 'draft.clock_paused', { at: now });
  res.json(draftReply(res, result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/** POST /api/league/draft/clock/resume — let the clock run again (commissioner only). */
router.post('/draft/clock/resume', requireAuth, requireCommissioner, async (_req, res) => {
  const now = new Date().toISOString();
  const result = await mutateDraft(res, (draft) => {
    if (draft.draft.startedAt === null || !draft.draft.clock) throw new HttpError(409, 'The draft has not started');
    draft.draft.clock = resumeClock(draft.draft.clock, now);
  });
  await auditDraft(res, 'draft.clock_resumed', { at: now });
  const auto = await runAutoPicks(res, await resolveDraftDataset(result.state));
  res.json(draftReply(res, auto ?? result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/close — call the draft finished (commissioner only).
 *
 * This is what opens next season's picks for trading. Rule 4.4.1.3 allows
 * exactly one draft to be tradeable at a time, so the current draft's picks
 * stop moving the moment this lands.
 */
router.post('/draft/close', requireAuth, requireCommissioner, async (_req, res) => {
  const result = await mutateState((draft) => {
    if (draft.draft.startedAt === null) {
      throw new HttpError(409, 'Start the draft before closing it');
    }
    if (!draft.draft.closedAt) draft.draft.closedAt = new Date().toISOString();
  });
  await appendAudit(actor(res), 'draft.closed', { closedAt: result.state.draft.closedAt });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/reopen — undo closing the draft (commissioner only).
 * Closing it by mistake must not cost anybody next season's pick trades.
 */
router.post('/draft/reopen', requireAuth, requireCommissioner, async (_req, res) => {
  const result = await mutateState((draft) => {
    draft.draft.closedAt = null;
  });
  await appendAudit(actor(res), 'draft.reopened', null);
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/reset — clear all picks + startedAt, keep keepers
 * (commissioner only).
 */
router.post('/draft/reset', requireAuth, requireCommissioner, async (_req, res) => {
  const result = await mutateState((draft) => {
    draft.draft.picks = {};
    draft.draft.startedAt = null;
    draft.draft.closedAt = null;
    draft.draft.playerPoolSnapshotId = null;
  });
  await appendAudit(actor(res), 'draft.reset', null);
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/draft/queue — save the signed-in owner's queue. When a
 * called CLOCK runs out on their pick, they take the top player still there.
 * The test draft keeps its own queues.
 */
router.post('/draft/queue', requireAuth, async (req, res) => {
  const keys = cleanQueue((req.body as { keys?: unknown } | undefined)?.keys);
  if (!keys) {
    res.status(400).json({ error: 'keys must be a list of player keys' });
    return;
  }
  await setDraftQueue(inTestDraft(res) ? 'test' : 'league', res.locals.owner as string, keys);
  res.json({ ok: true, keys });
});

/**
 * POST /api/league/draft-room — the draft page checks in every few seconds
 * and gets back who else has it open. The test draft has its own room.
 */
router.post('/draft-room', requireAuth, async (_req, res) => {
  const room = inTestDraft(res) ? 'test' : 'league';
  const now = Date.now();
  await touchPresence(room, res.locals.owner as string, new Date(now).toISOString());
  const rows = await listPresence(room, new Date(now - PRESENCE_WINDOW_MS).toISOString());
  res.json({ room, owners: inRoom(rows, now, OWNERS) });
});

/**
 * POST /api/league/test-draft/start — open the shared test draft, or start it
 * over (commissioner only). Members join it from their draft page.
 */
router.post('/test-draft/start', requireAuth, requireCommissioner, async (_req, res) => {
  const { state } = await getState();
  if (state.draft.startedAt !== null) throw new HttpError(409, 'The real draft has started. Test drafts are closed.');
  await setTestDraft(testDraftState(state, new Date().toISOString(), FALLBACK_PLAYER_POOL.id));
  await appendAudit(actor(res), 'test-draft.started', null);
  const test = await getTestDraft();
  if (!test) throw new HttpError(500, 'The test draft did not save');
  res.locals.testDraft = true;
  res.json(draftReply(res, test, { owner: res.locals.owner as string, isCommissioner: true }));
});

/** POST /api/league/test-draft/end — close the test draft for everyone (commissioner only). */
router.post('/test-draft/end', requireAuth, requireCommissioner, async (_req, res) => {
  await setTestDraft(null);
  await appendAudit(actor(res), 'test-draft.ended', null);
  res.json({ ok: true });
});

/**
 * POST /api/league/locks — set lock flags (commissioner only).
 * Body: { keepersLocked: boolean }
 */
router.post('/locks', requireAuth, requireCommissioner, async (req, res) => {
  const keepersLocked = (req.body as { keepersLocked?: unknown } | undefined)?.keepersLocked;
  if (typeof keepersLocked !== 'boolean') {
    res.status(400).json({ error: 'keepersLocked must be a boolean' });
    return;
  }
  const result = await mutateState((draft) => {
    draft.locks.keepersLocked = keepersLocked;
  });
  await appendAudit(actor(res), 'locks.set', { keepersLocked });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * POST /api/league/overrides — commissioner tier/cap tweaks.
 * Body: { cap?: number | null, playerRounds?: Record<string, number | null> }
 * cap: number sets an override, null clears it (back to computed).
 * playerRounds entries: 1-10 sets an override for that playerKey, null removes it.
 */
router.post('/overrides', requireAuth, requireCommissioner, async (req, res) => {
  const body = (req.body ?? {}) as { cap?: unknown; playerRounds?: unknown };

  if (body.cap !== undefined && body.cap !== null && (typeof body.cap !== 'number' || body.cap <= 0 || body.cap > 200)) {
    res.status(400).json({ error: 'cap must be a positive number (or null to clear)' });
    return;
  }
  const roundEntries: Array<[string, number | null]> = [];
  if (body.playerRounds !== undefined) {
    if (typeof body.playerRounds !== 'object' || body.playerRounds === null) {
      res.status(400).json({ error: 'playerRounds must be an object' });
      return;
    }
    for (const [key, val] of Object.entries(body.playerRounds as Record<string, unknown>)) {
      if (val !== null && (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 10)) {
        res.status(400).json({ error: `playerRounds.${key} must be an integer 1-10 (or null to clear)` });
        return;
      }
      roundEntries.push([key, val as number | null]);
    }
  }

  const result = await mutateState((draft) => {
    const ov = (draft.overrides ??= {});
    if (body.cap !== undefined) ov.cap = body.cap as number | null;
    const rounds = (ov.playerRounds ??= {});
    for (const [key, val] of roundEntries) {
      if (val === null) delete rounds[key];
      else rounds[key] = val;
    }
  });
  await appendAudit(actor(res), 'overrides.set', {
    cap: body.cap,
    playerRounds: Object.fromEntries(roundEntries),
  });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
});

/**
 * GET /api/league/pin-status — which teams have set a PIN yet (public;
 * used by the sign-in modal to offer "set your PIN" vs "enter your PIN").
 */
router.get('/pin-status', async (_req, res) => {
  res.json(await getPinStatus());
});

/**
 * POST /api/league/claim-pin — first-time PIN setup for an owner.
 * Body: { owner: string, pin: string (4-8 digits) }. Fails once claimed.
 */
router.post('/claim-pin', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const owner = body.owner;
  const pin = body.pin;
  if (typeof owner !== 'string' || !isKnownOwner(owner)) {
    res.status(404).json({ error: 'Unknown owner' });
    return;
  }
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4-8 digits' });
    return;
  }
  const result = await claimPin(owner, pin);
  if (!result.ok) {
    res.status(409).json({ error: result.error ?? 'PIN already claimed' });
    return;
  }
  await appendAudit(actor(res), 'pin.claimed', { owner });
  res.json({ ok: true });
});

/**
 * POST /api/league/act-as/:owner — sign in as another member (commissioner
 * only).
 *
 * The session it hands back is that member's, and carries only what they can
 * do. It lapses in hours, and every write through it names both people in the
 * audit log, so the log still answers who actually did it.
 */
router.post('/act-as/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const target = routeParam(req.params.owner);
  const commissioner = res.locals.owner as string;
  const result = await startImpersonation(commissioner, target, new Date());
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? 'Could not act as that owner' });
    return;
  }
  await appendAudit(commissioner, 'act-as.started', { target });
  res.json({
    session: result.session,
    owner: result.owner,
    email: result.email,
    isCommissioner: result.isCommissioner === true,
    expiresAt: result.expiresAt,
    impersonatedBy: commissioner,
  });
});

/**
 * GET /api/league/emails — every owner and the address their sign-in link
 * goes to (commissioner only). An address that has never been used to sign in
 * shows as unconfirmed, which is how the commissioner spots a typo.
 */
router.get('/emails', requireAuth, requireCommissioner, async (_req, res) => {
  res.json(await getOwnerEmails());
});

/**
 * POST /api/league/emails/:owner — set or clear an owner's address
 * (commissioner only). Body: { email: string }, or "" to clear it.
 */
router.post('/emails/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const target = routeParam(req.params.owner);
  const body = (req.body ?? {}) as { email?: unknown };
  if (typeof body.email !== 'string') {
    res.status(400).json({ error: 'email must be text, or "" to clear it' });
    return;
  }
  const result = await setOwnerEmail(target, body.email);
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? 'Could not save that address' });
    return;
  }
  // The address is not a secret, but it is somebody's personal data. The audit
  // trail records that it changed, not what it changed to.
  await appendAudit(actor(res), body.email === '' ? 'email.cleared' : 'email.set', {
    target,
  });
  res.json(await getOwnerEmails());
});

/**
 * POST /api/league/emails/:owner/send-link — send that member their sign-in
 * link (commissioner only).
 *
 * The link goes to their address, never to whoever pressed the button, so
 * this cannot be used to sign in as somebody else. It exists so the
 * commissioner can prove mail reaches all ten before telling the league to
 * expect it.
 */
router.post('/emails/:owner/send-link', requireAuth, requireCommissioner, async (req, res) => {
  const target = routeParam(req.params.owner);
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  const row = (await getOwnerEmails()).find((entry) => entry.owner === target);
  if (!row || row.email === '') {
    res.status(400).json({ error: `${target} has no address saved yet` });
    return;
  }
  const issued = await issueLoginToken(row.email, new Date());
  if (!issued.ok || !issued.token) {
    res.status(429).json({
      error: issued.reason ?? 'That address has had too many links. Wait a few minutes.',
      retryAfterSeconds: issued.retryAfterSeconds,
    });
    return;
  }
  const link = `${appOrigin(req)}/sign-in/${encodeURIComponent(issued.token)}`;
  const sent = await sendLoginLink(row.email, link, LINK_TTL_MINUTES);
  if (!sent.ok) {
    res.status(502).json({ error: sent.error ?? 'Could not send the email' });
    return;
  }
  await appendAudit(actor(res), 'email.link-sent', { target });
  res.json({ sent: true, logged: sent.logged === true });
});

/**
 * GET /api/league/pins — whether each owner has a PIN (commissioner only).
 * Never the value: the commissioner sets PINs but does not read them.
 */
router.get('/pins', requireAuth, requireCommissioner, async (_req, res) => {
  res.json(await getPinStates());
});

/**
 * POST /api/league/pins/:owner — set or clear an owner's PIN (commissioner
 * only). Body: { pin: string } — 4-8 digits, or "" to clear so the owner
 * sets a fresh one on their next sign-in.
 *
 * A new PIN goes straight to the owner's saved address, with a sign-in link,
 * so the commissioner never has to pass it on by hand. The PIN still saves
 * when there is no address or the mail fails; the answer says which.
 */
router.post('/pins/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const target = routeParam(req.params.owner);
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  const body = (req.body ?? {}) as { pin?: unknown; temp?: unknown };
  const pin = body.pin;
  if (typeof pin !== 'string' || (pin !== '' && !/^\d{4,8}$/.test(pin))) {
    res.status(400).json({ error: 'PIN must be 4-8 digits, or "" to clear' });
    return;
  }
  // temp: true assigns a temporary PIN the owner must replace on first login
  await setPin(target, pin, body.temp === true);
  // Deliberately do not log the PIN value in the audit trail
  await appendAudit(actor(res), pin === '' ? 'pin.cleared' : 'pin.set', {
    target,
    temp: body.temp === true,
  });
  if (pin === '') {
    res.json({ ok: true, emailed: false });
    return;
  }

  const row = (await getOwnerEmails()).find((entry) => entry.owner === target);
  if (!row || row.email === '') {
    res.json({ ok: true, emailed: false, reason: `${target} has no email saved, so nothing went out. Add an email first.` });
    return;
  }
  // A link on top of the PIN, so one email gets them in either way. If the
  // address has had too many links lately, the PIN still goes, with a plain
  // link to the app instead.
  const issued = await issueLoginToken(row.email, new Date());
  const signInLink = issued.ok && Boolean(issued.token);
  const link = signInLink
    ? `${appOrigin(req)}/sign-in/${encodeURIComponent(issued.token as string)}`
    : `${appOrigin(req)}/`;
  const sent = await sendPinEmail(row.email, target, pin, link, signInLink, LINK_TTL_MINUTES);
  if (!sent.ok) {
    res.json({ ok: true, emailed: false, reason: sent.error ?? 'Could not send the email' });
    return;
  }
  await appendAudit(actor(res), 'pin.emailed', { target });
  res.json({ ok: true, emailed: true, logged: sent.logged === true });
});

/**
 * GET /api/league/audit?limit=50 — recent audit rows, newest first.
 * Commissioner only: rows contain keeper selections, which are secret pre-draft.
 */
// ─── Rule book draft (commissioner only) ─────────────────────────────────────
//
// The client holds the whole book, applies pure tree edits locally, and PUTs
// the result with the version it started from. One commissioner means there is
// no need for per-operation endpoints; the version check is what stops a stale
// tab from overwriting newer edits.

const SEED_RULEBOOK = seedRulebook as unknown as Rulebook;
const RULEBOOK_SEASON: number = SEED_RULEBOOK.season;

/** Rough ceiling on a stored book, so a broken client cannot fill the table. */
const MAX_RULEBOOK_BYTES = 2_000_000;

router.get('/rulebook/draft', requireAuth, requireCommissioner, async (_req, res, next) => {
  try {
    const row = await getRulebookDraft(RULEBOOK_SEASON);
    if (!row) {
      // No draft yet: hand back the committed seed at version 0, so the first
      // save creates version 1 and the editor has something to work on.
      res.json({ book: SEED_RULEBOOK, version: 0, updatedAt: null, updatedBy: null, seeded: true });
      return;
    }
    res.json({
      book: row.book,
      version: row.version,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      seeded: false,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/rulebook/draft', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = req.body as { book?: unknown; expectedVersion?: unknown };
    const expectedVersion = body.expectedVersion;
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new HttpError(400, 'expectedVersion must be a whole number');
    }
    const book = body.book as Rulebook | undefined;
    if (!book || typeof book !== 'object' || !Array.isArray(book.articles)) {
      throw new HttpError(400, 'book must be a rule book document');
    }
    if (book.season !== RULEBOOK_SEASON) {
      throw new HttpError(400, `book is for season ${String(book.season)}, expected ${RULEBOOK_SEASON}`);
    }
    if (JSON.stringify(book).length > MAX_RULEBOOK_BYTES) {
      throw new HttpError(413, 'That rule book is too large to store');
    }

    // Structural problems are rejected here rather than stored and discovered
    // at publish time. Broken references are the ones that matter most.
    const problems = validateDraft(book);
    if (problems.length) {
      res.status(422).json({ error: 'The draft has problems that must be fixed', problems });
      return;
    }

    const owner = res.locals.owner as string;
    const saved = await saveRulebookDraft(RULEBOOK_SEASON, book, expectedVersion, owner);
    await appendAudit(actor(res), 'rulebook-draft-save', {
      version: saved.version,
      articles: book.articles.length,
    });
    res.json({ version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
  } catch (err) {
    if (err instanceof RulebookSaveError) {
      res.status(409).json({ error: err.message, code: err.code, currentVersion: err.currentVersion });
      return;
    }
    next(err);
  }
});

router.delete('/rulebook/draft', requireAuth, requireCommissioner, async (_req, res, next) => {
  try {
    await deleteRulebookDraft(RULEBOOK_SEASON);
    await appendAudit(actor(res), 'rulebook-draft-reset', { season: RULEBOOK_SEASON });
    res.json({ book: SEED_RULEBOOK, version: 0, seeded: true });
  } catch (err) {
    next(err);
  }
});

// ─── Published rule book ─────────────────────────────────────────────────────
//
// Published versions are immutable and readable by anyone, signed in or not:
// the constitution is not a secret, and that is what makes a shared link work
// without a token. Publishing is commissioner-only and gated on the exact
// fingerprint the commissioner saw in the diff.

/** Everyone reads this. Falls back to the committed seed before a first publish. */
router.get('/rulebook', async (_req, res, next) => {
  try {
    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    if (!latest) {
      res.json({
        book: SEED_RULEBOOK,
        versionId: null,
        revision: SEED_RULEBOOK.revision,
        publishedAt: null,
        publishedBy: null,
        notes: '',
        published: false,
      });
      return;
    }
    res.json({
      book: latest.book,
      versionId: latest.id,
      revision: latest.revision,
      publishedAt: latest.publishedAt,
      publishedBy: latest.publishedBy,
      notes: latest.notes,
      published: true,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The constitution as a PDF, laid out like the Word file the league grew up
 * on: the champion and the commissioner's letter up front, the numbered rules,
 * the appendices, the amendment history, and a signature page at the back.
 */
async function sendRulebookPdf(
  res: Response,
  input: {
    book: Rulebook;
    versionId: string | null;
    publishedAt: string | null;
    superseded: boolean;
    copyFor: string | null;
  },
): Promise<void> {
  const [history, signatures, versions] = await Promise.all([
    resolvePublishedHistory(),
    listRulebookSignatures(RULEBOOK_SEASON),
    listRulebookVersions(RULEBOOK_SEASON),
  ]);
  const pdf = await renderRulebookPdf({
    book: input.book,
    versionId: input.versionId,
    publishedAt: input.publishedAt,
    superseded: input.superseded,
    history: history.history,
    teams: CONFIG_TEAMS,
    signatures,
    versions: versions.map((v) => ({
      revision: v.revision,
      publishedAt: v.publishedAt,
      publishedBy: v.publishedBy,
      notes: v.notes,
    })),
    copyFor: input.copyFor,
  });
  const name = pdfFileName(input.book.season, input.book.revision, input.copyFor);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

/** The member a copy is for, by owner key. Anything else is just nobody. */
function copyForOwner(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return CONFIG_TEAMS.find((t) => t.owner === value)?.fullName ?? null;
}

/**
 * GET /api/league/rulebook/pdf — public, like the book. `?rev=<id>` prints a
 * frozen past revision; `?for=<owner>` stamps whose copy it is. With nothing
 * published yet it prints the seed, marked as a working draft.
 */
router.get('/rulebook/pdf', async (req, res, next) => {
  try {
    const rev = typeof req.query.rev === 'string' ? req.query.rev : null;
    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    const version = rev ? await getRulebookVersion(rev) : latest;
    if (rev && (!version || version.season !== RULEBOOK_SEASON)) {
      throw new HttpError(404, 'No such revision');
    }
    await sendRulebookPdf(res, {
      book: (version?.book as Rulebook | undefined) ?? SEED_RULEBOOK,
      versionId: version?.id ?? null,
      publishedAt: version?.publishedAt ?? null,
      superseded: Boolean(version && latest && version.id !== latest.id),
      copyFor: copyForOwner(req.query.for),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/league/rulebook/draft/pdf — the working draft, for the commissioner's eyes. */
router.get('/rulebook/draft/pdf', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const row = await getRulebookDraft(RULEBOOK_SEASON);
    await sendRulebookPdf(res, {
      book: (row?.book as Rulebook | undefined) ?? SEED_RULEBOOK,
      versionId: null,
      publishedAt: null,
      superseded: false,
      copyFor: copyForOwner(req.query.for),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/rulebook/sign-request — mail the picked members a "read it,
 * sign it" note for the revision in force (commissioner only). Body:
 * { owners: string[] }. Publishing never mails on its own, so the commissioner
 * can try it on one person first.
 */
router.post('/rulebook/sign-request', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { owners?: unknown };
    const picked = Array.isArray(body.owners)
      ? body.owners.filter((o): o is string => typeof o === 'string')
      : [];
    const owners = OWNERS.filter((owner) => picked.includes(owner));
    if (!owners.length) throw new HttpError(400, 'Pick at least one member');

    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    if (!latest) throw new HttpError(409, 'Nothing is published yet, so there is nothing to sign');
    const result = await sendRulebookSignRequest(
      {
        revision: latest.revision,
        notes: latest.notes,
        publishedBy: latest.publishedBy,
        owners,
        seasonLabel: `${RULEBOOK_SEASON - 1}-${String(RULEBOOK_SEASON).slice(-2)}`,
        publishedAt: latest.publishedAt,
      },
      appOrigin(req),
    );
    await appendAudit(actor(res), 'rulebook-sign-request', {
      versionId: latest.id,
      revision: latest.revision,
      sent: result.sent,
      noAddress: result.noAddress,
    });
    res.json({ versionId: latest.id, revision: latest.revision, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/league/rulebook/signatures/:owner — the commissioner withdraws
 * one member's signature on the revision in force, so they can sign again.
 * Audited, since a signature is otherwise never touched.
 */
/**
 * POST /api/league/rulebook/fold — fold the newest revision into the one
 * before it, so a fix everyone already understands costs nobody a second
 * signature (commissioner only). Body: { versionId } of the newest, as the
 * page showed it. Refused once anyone has signed the newest.
 */
router.post('/rulebook/fold', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const versionId = (req.body as { versionId?: unknown }).versionId;
    if (typeof versionId !== 'string' || !versionId) throw new HttpError(400, 'versionId is required');
    const result = await foldLatestRulebookVersion(RULEBOOK_SEASON, versionId);
    await appendAudit(actor(res), 'rulebook-fold', result);
    res.json(result);
  } catch (err) {
    if (err instanceof RulebookPublishError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

router.delete('/rulebook/signatures/:owner', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const owner = String(req.params.owner);
    if (!OWNERS.includes(owner)) throw new HttpError(404, 'No such member');
    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    if (!latest) throw new HttpError(409, 'Nothing is published yet');
    const removed = await deleteRulebookSignature(latest.id, owner);
    if (!removed) throw new HttpError(404, `${owner} has not signed this revision`);
    await appendAudit(actor(res), 'rulebook-unsign', { versionId: latest.id, revision: latest.revision, owner });
    res.json({ versionId: latest.id, owner, removed: true });
  } catch (err) {
    next(err);
  }
});

router.get('/rulebook/versions', async (_req, res, next) => {
  try {
    res.json(await listRulebookVersions(RULEBOOK_SEASON));
  } catch (err) {
    next(err);
  }
});

router.get('/rulebook/versions/:id', async (req, res, next) => {
  try {
    const version = await getRulebookVersion(String(req.params.id));
    if (!version) {
      res.status(404).json({ error: 'No such version' });
      return;
    }
    res.json(version);
  } catch (err) {
    next(err);
  }
});

// ─── Signatures ──────────────────────────────────────────────────────────────
//
// A signature binds a member, a time, the words they agreed to, and the
// version's fingerprint to ONE frozen revision. Rows are inserted and never
// updated, and they never carry to a later revision: publishing again means
// the league signs again.

/** Anyone may read who has signed, the same way anyone may read the book. */
router.get('/rulebook/signatures', async (req, res, next) => {
  try {
    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    const asked = typeof req.query.versionId === 'string' ? req.query.versionId : '';
    const versionId = asked || latest?.id || null;
    const signatures = await listRulebookSignatures(RULEBOOK_SEASON);
    const status = signatureStatus(OWNERS, signatures, versionId);
    res.json({
      versionId,
      currentVersionId: latest?.id ?? null,
      revision: latest?.revision ?? null,
      fingerprint: latest?.fingerprint ?? null,
      acknowledgement: ACKNOWLEDGEMENT,
      members: OWNERS,
      signed: status.signed.map(publicSignature),
      missing: status.missing,
      complete: status.complete,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/rulebook/sign', requireAuth, async (req, res, next) => {
  try {
    // The owner comes from the PIN, never the body: nobody signs for anyone else.
    const owner = res.locals.owner as string;
    const body = req.body as { versionId?: unknown; fingerprint?: unknown; drawing?: unknown };
    const versionId = typeof body.versionId === 'string' ? body.versionId : '';
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
    if (!versionId || !fingerprint) {
      throw new HttpError(400, 'versionId and fingerprint are required');
    }
    // A drawn signature is optional. A bad one is refused outright rather than
    // quietly dropped, so nobody thinks they signed by hand when they did not.
    const drawing = checkDrawing(body.drawing);
    if (!drawing.ok) throw new HttpError(400, drawing.message);

    const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
    const signatures = await listRulebookSignatures(RULEBOOK_SEASON);
    const check = canSign({
      owner,
      members: OWNERS,
      current: latest ? { versionId: latest.id, fingerprint: latest.fingerprint } : null,
      versionId,
      fingerprint,
      acknowledgement: ACKNOWLEDGEMENT,
      signatures,
    });
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }

    const signature = makeSignature({
      season: RULEBOOK_SEASON,
      versionId,
      revision: latest?.revision ?? SEED_RULEBOOK.revision,
      fingerprint,
      owner,
      // Stored as it reads today, so later wording cannot rewrite what was agreed.
      acknowledgement: ACKNOWLEDGEMENT,
      signedAt: new Date().toISOString(),
      drawing: drawing.drawing,
    });
    await insertRulebookSignature(signature);
    await appendAudit(actor(res), 'rulebook-sign', {
      versionId,
      revision: signature.revision,
      drawn: Boolean(drawing.drawing),
    });

    const after = signatureStatus(OWNERS, [...signatures, signature], versionId);
    res.json({
      signature: publicSignature(signature),
      signed: after.signed.map(publicSignature),
      missing: after.missing,
      complete: after.complete,
    });
  } catch (err) {
    if (err instanceof RulebookSignError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

router.post('/rulebook/publish', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = req.body as { fingerprint?: unknown; notes?: unknown };
    if (typeof body.fingerprint !== 'string' || !body.fingerprint) {
      throw new HttpError(400, 'fingerprint is required; preview the diff first');
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';

    // No stored draft means the editor is showing the committed seed at
    // version 0. The first publish goes straight from that; it is what the
    // commissioner previewed.
    const draftRow = await getRulebookDraft(RULEBOOK_SEASON);
    const book = (draftRow?.book as Rulebook | undefined) ?? SEED_RULEBOOK;

    // The draft must be exactly what the commissioner previewed. Anything else
    // means it moved underneath them, so refuse instead of publishing a
    // surprise.
    const actual = rulebookFingerprint(book);
    if (actual !== body.fingerprint) {
      res.status(409).json({
        error: 'The draft changed since you previewed it. Look at the diff again.',
        code: 'stale-fingerprint',
        fingerprint: actual,
      });
      return;
    }

    const problems = validateDraft(book);
    if (problems.length) {
      res.status(422).json({ error: 'The draft has problems that must be fixed', problems });
      return;
    }

    const previous = await getLatestRulebookVersion(RULEBOOK_SEASON);
    if (previous && previous.fingerprint === actual) {
      res.status(409).json({
        error: 'That is already the published rule book; nothing has changed.',
        code: 'no-changes',
      });
      return;
    }

    const owner = res.locals.owner as string;
    const publishedAt = new Date().toISOString();
    const revision = (previous?.revision ?? SEED_RULEBOOK.revision - 1) + 1;
    // Published books carry their own revision and a published status, so a
    // reader can never mistake a frozen version for the working draft.
    const frozen = { ...book, revision, status: 'published' };
    const id = `rb-${RULEBOOK_SEASON}-r${revision}-${actual.slice(3, 11)}`;

    const saved = await publishRulebookVersion({
      id,
      season: RULEBOOK_SEASON,
      revision,
      // The DRAFT's fingerprint, not the frozen book's. Freezing bumps the
      // revision, which is part of the fingerprint, so storing the frozen one
      // would make every version look different and the no-changes check above
      // would never fire.
      fingerprint: actual,
      book: frozen,
      notes,
      publishedAt,
      publishedBy: owner,
    });

    // Any passed vote already seeded into this draft went out with it. Stamping
    // the poll is what ties a vote to the revision that carried it.
    const carried = await stampSeededPolls(saved.id, revision, publishedAt);

    await appendAudit(actor(res), 'rulebook-publish', {
      versionId: saved.id,
      revision,
      notes,
      previousVersionId: previous?.id ?? null,
      polls: carried,
    });
    res.json({
      versionId: saved.id,
      revision,
      publishedAt: saved.publishedAt,
      publishedBy: saved.publishedBy,
      polls: carried,
    });
  } catch (err) {
    if (err instanceof RulebookPublishError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

// ─── Votes ───────────────────────────────────────────────────────────────────
//
// Each member may launch one vote a season (commissioner ruling 2026-08-31);
// the commissioner is exempt from that count and nobody is exempt from the
// draft deadline. Passing needs 60% of ALL teams, so a team that never votes
// counts against. A passed vote does not rewrite anything: it is a mandate the
// commissioner then applies in the rule book draft.

/** The book a poll's threshold is read from: published if there is one. */
async function currentRulebook(): Promise<Rulebook> {
  const latest = await getLatestRulebookVersion(RULEBOOK_SEASON);
  return (latest?.book as Rulebook | undefined) ?? SEED_RULEBOOK;
}

async function seasonPolls(): Promise<Poll[]> {
  return (await listPolls(RULEBOOK_SEASON)) as Poll[];
}

/**
 * Tie every vote already seeded into the draft to the revision that just went
 * out. Returns the poll ids, for the audit row and the publish response.
 */
async function stampSeededPolls(
  versionId: string,
  revision: number,
  at: string,
): Promise<string[]> {
  const waiting = (await seasonPolls()).filter(
    (poll) => poll.status === 'passed' && poll.seededAt && !poll.appliedVersionId,
  );
  const stamped: string[] = [];
  for (const poll of waiting) {
    try {
      await updatePoll(poll.id, (current) => {
        const row = current as Poll;
        if (row.appliedVersionId) return row;
        return { ...row, appliedVersionId: versionId, appliedRevision: revision, appliedAt: at };
      });
      stamped.push(poll.id);
    } catch (err) {
      // A vote that could not be stamped must not undo a publish that already
      // happened; the publish is the immutable part.
      console.error('[league] Could not stamp poll', poll.id, err);
    }
  }
  return stamped;
}

/** Everyone sees every vote. A league vote is not a secret ballot. */
router.get('/polls', requireAuth, async (_req, res, next) => {
  try {
    const polls = await seasonPolls();
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const launched = polls.filter((p) => p.proposedBy === owner && p.status !== 'cancelled');
    res.json({
      polls,
      you: {
        owner,
        isCommissioner: isCommish,
        hasLaunched: launched.length > 0,
        // The commissioner's launch is never used up, so the button never locks.
        canLaunch: isCommish || launched.length === 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** The words of a vote, trimmed and capped, from a create or edit body. */
function pollWords(body: { title?: unknown; detail?: unknown; affects?: unknown }): {
  title: string;
  detail: string;
  affects: string[];
} {
  return {
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 140) : '',
    detail: typeof body.detail === 'string' ? body.detail.trim().slice(0, 2000) : '',
    affects: Array.isArray(body.affects)
      ? body.affects.filter((id): id is string => typeof id === 'string').slice(0, 40)
      : [],
  };
}

router.post('/polls', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const body = req.body as { kind?: unknown; title?: unknown; detail?: unknown; affects?: unknown };
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const { title, detail, affects } = pollWords(body);

    const state = await getState();
    const check = canLaunchPoll({
      owner,
      members: OWNERS,
      seasonPolls: await seasonPolls(),
      kind,
      affects,
      title,
      now: new Date(),
      draftAt: new Date(DRAFT_AT_ISO),
      draftStarted: state.state.draft.startedAt !== null,
      isCommissioner: res.locals.isCommissioner === true,
    });
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }

    const book = await currentRulebook();
    const missing = unknownClauses(book, affects);
    if (missing.length) {
      throw new HttpError(400, `These rules are not in the book: ${missing.join(', ')}`);
    }

    const openedAt = new Date().toISOString();
    // The full timestamp, not just the date: cancelling refunds the member's
    // launch, and a date-only id would collide when they relaunch the same day.
    const stamp = openedAt.replace(/[-:.TZ]/g, '');
    const poll: Poll = {
      id: `poll-${RULEBOOK_SEASON}-${owner.toLowerCase()}-${stamp}`,
      season: RULEBOOK_SEASON,
      kind: kind as PollKind,
      title,
      detail,
      proposedBy: owner,
      affects,
      threshold: thresholdFor(book, affects),
      // Frozen now, so a later roster change cannot move the goalposts.
      eligibleVoters: [...OWNERS],
      openedAt,
      status: 'open',
      votes: [],
    };

    await insertPoll(poll.id, RULEBOOK_SEASON, poll);
    await appendAudit(actor(res), 'poll-open', { pollId: poll.id, kind, title, affects });
    res.json(poll);
  } catch (err) {
    if (err instanceof PollWriteError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

/**
 * POST /polls/:id/edit — the commissioner rewrites an open vote.
 *
 * Commissioner only, even for a vote they started themselves: the league is
 * voting on the words as they stand. Changing the title or the rules it names
 * changes the question, so the pure core clears the votes already cast and the
 * poll records the edit either way.
 */
router.post('/polls/:id/edit', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const id = String(req.params.id);
    const existing = (await getPoll(id)) as Poll | null;
    if (!existing) {
      res.status(404).json({ error: 'No such vote' });
      return;
    }

    const { title, detail, affects } = pollWords(
      req.body as { title?: unknown; detail?: unknown; affects?: unknown },
    );
    const book = await currentRulebook();
    const missing = unknownClauses(book, affects);
    if (missing.length) {
      throw new HttpError(400, `These rules are not in the book: ${missing.join(', ')}`);
    }

    // Naming different rules can move the bar, so the threshold is read again.
    const next: PollEditInput = { title, detail, affects, threshold: thresholdFor(book, affects) };
    const check = canEditPoll({ poll: existing, isCommissioner: true, next });
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }

    const at = new Date().toISOString();
    const updated = (await updatePoll(id, (current) => {
      const poll = current as Poll;
      // It could have closed between the check and this write. Leave it alone.
      if (poll.status !== 'open') return poll;
      return editPoll(poll, next, owner, at);
    })) as Poll;

    const applied = updated.edits?.[updated.edits.length - 1];
    await appendAudit(actor(res), 'poll-edit', {
      pollId: id,
      changed: applied?.changed ?? pollEditChanges(existing, next),
      votesCleared: applied?.votesCleared ?? 0,
      title,
      affects,
      threshold: next.threshold,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof PollWriteError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

router.post('/polls/:id/vote', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const choice = String((req.body as { choice?: unknown }).choice ?? '');
    const id = String(req.params.id);

    const existing = (await getPoll(id)) as Poll | null;
    if (!existing) {
      res.status(404).json({ error: 'No such vote' });
      return;
    }
    const check = canVote(existing, owner, choice);
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }

    // Read-modify-write inside the store so two members voting at the same
    // moment cannot lose one of the votes.
    const at = new Date().toISOString();
    const updated = (await updatePoll(id, (current) => {
      const poll = current as Poll;
      if (poll.status !== 'open') return poll;
      return castVote(poll, owner, choice as VoteChoice, at);
    })) as Poll;

    await appendAudit(actor(res), 'poll-vote', { pollId: id, choice });
    res.json(updated);
  } catch (err) {
    if (err instanceof PollWriteError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

/** The proposer or a commissioner closes it; the tally decides the outcome. */
router.post('/polls/:id/close', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const id = String(req.params.id);
    const cancel = (req.body as { cancel?: unknown }).cancel === true;

    const existing = (await getPoll(id)) as Poll | null;
    if (!existing) {
      res.status(404).json({ error: 'No such vote' });
      return;
    }
    if (existing.proposedBy !== owner && !isCommish) {
      res.status(403).json({ error: 'Only the member who started this vote, or a commissioner, can close it' });
      return;
    }
    if (existing.status !== 'open') {
      res.status(409).json({ error: 'That vote is already closed', code: 'not-open' });
      return;
    }

    const at = new Date().toISOString();
    const updated = (await updatePoll(id, (current) => {
      const poll = current as Poll;
      if (poll.status !== 'open') return poll;
      return cancel
        ? { ...poll, status: 'cancelled' as const, closedAt: at, closedBy: owner }
        : closePoll(poll, owner, at);
    })) as Poll;

    await appendAudit(actor(res), cancel ? 'poll-cancel' : 'poll-close', {
      pollId: id,
      status: updated.status,
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof PollWriteError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

// ─── Draft pick trades ───────────────────────────────────────────────────────
//
// Two members swap draft picks and nothing else. The proposer always comes from
// the PIN, never from the body.
//
// Proposals and the accepted-transfer ledger both live in league_state rather
// than in their own tables. That is deliberate: accepting a trade and entering
// a draft pick then become the same single compare-and-swap write, so when both
// land at the same moment exactly one wins and the loser fails cleanly. Split
// across two tables there would be no way to promise that over the Neon HTTP
// driver.

/** What one write attempt decided. Held in an array so the type survives the await. */
interface TradeOutcome {
  proposal?: PickTradeProposal;
  refusal?: { status: number; message: string; code?: string };
  /** Owners whose keeper selections the accepted trade cleared. */
  keepersReset?: string[];
}

/**
 * Picks from a request body. A client that names no season means the current
 * draft, which is what every pick meant before picks became season-aware.
 */
function parsePickRefs(value: unknown, label: string, defaultSeason: number): PickRef[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be a list of picks`);
  return value.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof entry.round !== 'number'
      || !Number.isInteger(entry.round)
      || typeof entry.originalOwner !== 'string'
      || entry.originalOwner === ''
      || (entry.season !== undefined
        && (typeof entry.season !== 'number' || !Number.isInteger(entry.season)))
    ) {
      throw new HttpError(400, `Each ${label} pick needs a round and the team it came from`);
    }
    return {
      season: (entry.season as number | undefined) ?? defaultSeason,
      round: entry.round,
      originalOwner: entry.originalOwner,
    };
  });
}

function sendOutcome(res: Response, outcome: TradeOutcome | undefined): boolean {
  const refusal = outcome?.refusal;
  if (!refusal) return false;
  res.status(refusal.status).json({ error: refusal.message, code: refusal.code });
  return true;
}

/** Every offer this member may see, with anything past its date already filed. */
router.get('/pick-trades', requireAuth, async (_req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const { state } = await getState();
    const proposals = expireStale(
      proposalsOf(state, leagueDataset.season),
      new Date().toISOString(),
    ).proposals;
    const visible = visibleProposals(proposals, owner, isCommish);
    res.json({
      season: state.season,
      /** The one draft whose picks can move right now. */
      tradeableSeason: tradeableSeason(state, leagueDataset),
      draftClosedAt: state.draft.closedAt ?? null,
      proposals: visible,
      transfers: transfersOf(state, leagueDataset.season),
      you: {
        owner,
        inbox: inboxCount(visible, owner),
        sent: visible.filter((p) => p.status === 'pending' && p.proposer === owner).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A no-write review of a trade: whether it is legal and what it does to both
 * teams' keeper pick costs. Send `id` to review an offer that already exists,
 * or a recipient plus two pick lists to try one out before sending it.
 */
router.post('/pick-trades/preview', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { state } = await getState();

    let input: ProposalInput;
    if (typeof body.id === 'string') {
      const proposal = proposalsOf(state).find((p) => p.id === body.id);
      if (!proposal) throw new HttpError(404, 'No such offer');
      if (!involves(proposal, owner)) {
        throw new HttpError(403, 'That offer is between two other members');
      }
      input = proposalInput(normalizeProposal(proposal, leagueDataset.season));
    } else {
      input = {
        proposer: owner,
        recipient: typeof body.recipient === 'string' ? body.recipient : '',
        offer: parsePickRefs(body.offer, 'offer', leagueDataset.season),
        request: parsePickRefs(body.request, 'request', leagueDataset.season),
        note: '',
      };
    }

    res.json(
      previewProposal(currentDataset(state), state, input, {
        owner,
        isCommissioner: seesAllKeepers(state, isCommish),
        revealed: state.keepersRevealed === true,
      }),
    );
  } catch (err) {
    next(err);
  }
});

/** Send an offer. The proposer is whoever signed in. */
router.post('/pick-trades', requireAuth, async (req, res, next) => {
  try {
    const proposer = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: ProposalInput = {
      proposer,
      recipient: typeof body.recipient === 'string' ? body.recipient : '',
      offer: parsePickRefs(body.offer, 'offer', leagueDataset.season),
      request: parsePickRefs(body.request, 'request', leagueDataset.season),
      note: typeof body.note === 'string' ? body.note.trim().slice(0, MAX_TRADE_NOTE) : '',
    };

    // In the offseason, the draft included, every round moves. During the
    // season only rounds 3 to 10 do, and after Week 15 nothing does. The write
    // below re-checks against the state it is writing to, so this read only
    // decides which message a bad shape gets.
    const { state: before } = await getState();
    const shape = checkProposalShape(
      leagueDataset,
      input,
      tradeWindow(before) !== 'in-season',
    );
    if (!shape.ok) {
      res.status(400).json({ error: shape.message, code: shape.reason });
      return;
    }

    const now = new Date().toISOString();
    const outcomes: TradeOutcome[] = [];
    const result = await mutateState((draft) => {
      outcomes.length = 0;
      const check = checkProposalAgainstState(currentDataset(draft), draft, input);
      if (!check.ok) {
        outcomes.push({ refusal: { status: 409, message: check.message ?? '', code: check.reason } });
        return;
      }
      // A member may shop the same pick to two teams at once. Whoever accepts
      // first gets it, and the accept step files the rest.
      const proposals = expireStale(proposalsOf(draft), now).proposals;
      const proposal: PickTradeProposal = {
        id: `trade-${draft.season}-${proposer.toLowerCase()}-${now.replace(/[-:.TZ]/g, '')}`,
        season: draft.season,
        proposer,
        recipient: input.recipient,
        offer: input.offer,
        request: input.request,
        note: input.note,
        status: 'pending',
        version: 1,
        createdAt: now,
        expiresAt: expiresAtFrom(now),
      };
      draft.pickTradeProposals = [...proposals, proposal];
      outcomes.push({ proposal });
    });

    if (sendOutcome(res, outcomes[0])) return;
    const proposal = outcomes[0]?.proposal;
    if (!proposal) throw new HttpError(500, 'The offer could not be saved');
    await appendAudit(actor(res), 'pick-trade.proposed', {
      proposalId: proposal.id,
      recipient: proposal.recipient,
      offer: proposal.offer,
      request: proposal.request,
    });
    res.json({
      proposal,
      ...redactState(result, { owner: proposer, isCommissioner: isCommish }),
    });
    // After the answer, never before it. The offer is saved either way.
    notifyTradeOffered(proposal, appOrigin(req));
  } catch (err) {
    next(err);
  }
});

// ─── Mock draft with a friend ────────────────────────────────────────────────
//
// Two people at one table, or more, and the rest of the room computers. The
// room lives here so every phone sees the same draft; the rules are in
// src/lib/league/sharedMock.ts. Only the people asked to a room can read or
// change it. Each phone replays the draft itself; the server never does.

/** The season's rooms this owner was asked to and has not cleared, newest first. */
async function sharedMocksFor(owner: string): Promise<SharedMockRoom[]> {
  const rows = await listSharedMocks(leagueDataset.season, owner);
  return rows
    .map((row) => parseSharedMockRoom(row.room))
    .filter((room): room is SharedMockRoom => room !== null && showsFor(room, owner));
}

/** A room by its id, or null. The caller decides who may see it. */
async function sharedMockById(id: string): Promise<SharedMockRoom | null> {
  const row = await getSharedMock(id);
  return row ? parseSharedMockRoom(row.room) : null;
}

/** Change one room and answer with it. A rule broken on the way is a 409 in plain words. */
async function changeSharedMock(
  res: Response,
  id: string,
  mutate: (room: SharedMockRoom, at: string) => SharedMockRoom,
): Promise<void> {
  const at = new Date().toISOString();
  try {
    const row = await updateSharedMock(id, (value) => {
      const room = parseSharedMockRoom(value);
      if (!room) throw new HttpError(500, 'That mock cannot be read.');
      return mutate(room, at);
    }, at);
    res.json({ room: row.room, now: at });
  } catch (err) {
    if (err instanceof SharedMockWriteError) {
      res.status(err.code === 'not-found' ? 404 : 409).json({ error: err.code === 'not-found' ? 'No such mock.' : err.message });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** The open rooms still waiting to start, which anyone may join. */
async function openSharedMocks(): Promise<SharedMockRoom[]> {
  const rows = await listOpenSharedMocks(leagueDataset.season);
  return rows
    .map((row) => parseSharedMockRoom(row.room))
    .filter((room): room is SharedMockRoom => room !== null && room.open === true && sharedMockPhase(room) === 'waiting');
}

/**
 * GET /api/league/shared-mocks — the mocks you are in and have not cleared,
 * plus any open room waiting for people, so the mock page can offer it.
 */
router.get('/shared-mocks', requireAuth, async (_req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const mine = await sharedMocksFor(owner);
    const seen = new Set(mine.map((room) => room.id));
    const open = (await openSharedMocks()).filter((room) => !seen.has(room.id));
    res.json({ rooms: [...mine, ...open], now: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/shared-mocks/open — open a room anyone may join. One
 * open room in the league at a time, and you start it when you are ready.
 */
router.post('/shared-mocks/open', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = body.mode === 'sharp' || body.mode === 'realistic' ? body.mode : null;
    if (!mode) {
      res.status(400).json({ error: 'Pick a room: sharp or normal.' });
      return;
    }
    const waiting = (await openSharedMocks())[0];
    if (waiting) {
      res.status(409).json({ error: `${waiting.host}'s room is already open. Join it instead.` });
      return;
    }
    const busy = (room: SharedMockRoom) => sharedMockPhase(room) === 'waiting' || sharedMockPhase(room) === 'live';
    const mine = (await sharedMocksFor(owner)).find(busy);
    if (mine) {
      res.status(409).json({ error: `You have a mock open with ${namesOf(othersAt(mine, owner))}. Quit it first.` });
      return;
    }
    const at = new Date().toISOString();
    const room = openSharedMock({ id: sharedMockId(at, Math.random()), season: leagueDataset.season, host: owner, mode, at });
    await insertSharedMock({ id: room.id, season: room.season, room, version: 0, updatedAt: at });
    res.json({ room, now: at });
  } catch (err) {
    next(err);
  }
});

/** POST /api/league/shared-mocks — ask somebody to a mock. One open mock a person. */
router.post('/shared-mocks', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const guest = typeof body.with === 'string' ? body.with : '';
    if (!OWNERS.includes(guest) || guest === owner) {
      res.status(400).json({ error: 'Pick somebody in the league to draft with.' });
      return;
    }
    const mode = body.mode === 'sharp' || body.mode === 'realistic' ? body.mode : null;
    if (!mode) {
      res.status(400).json({ error: 'Pick a room: sharp or normal.' });
      return;
    }
    const open = (room: SharedMockRoom) => sharedMockPhase(room) === 'waiting' || sharedMockPhase(room) === 'live';
    const mine = (await sharedMocksFor(owner)).find(open);
    if (mine) {
      res.status(409).json({ error: `You have a mock open with ${namesOf(othersAt(mine, owner))}. Quit it first.` });
      return;
    }
    const theirs = (await sharedMocksFor(guest)).find((room) => sharedMockPhase(room) === 'live');
    if (theirs) {
      res.status(409).json({ error: `${guest} is in a mock right now.` });
      return;
    }
    const at = new Date().toISOString();
    const room = newSharedMock({
      id: sharedMockId(at, Math.random()),
      season: leagueDataset.season,
      host: owner,
      guests: [guest],
      mode,
      at,
    });
    await insertSharedMock({ id: room.id, season: room.season, room, version: 0, updatedAt: at });
    res.json({ room, now: at });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/league/shared-mocks/:id — one room, for the people in it, with
 * their real keepers, which they show each other by sitting down. Anyone may
 * look at an open room that is still waiting, so the link invites, but the
 * keepers come only once they are in.
 */
router.get('/shared-mocks/:id', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const room = await sharedMockById(routeParam(req.params.id));
    if (!room) {
      res.status(404).json({ error: 'No such mock.' });
      return;
    }
    const inRoom = room.people.includes(owner);
    if (!inRoom && !(room.open === true && sharedMockPhase(room) === 'waiting')) {
      res.status(403).json({ error: `This mock is ${namesOf(room.people)}'s.` });
      return;
    }
    const keepers: Record<string, KeeperSelection[]> = {};
    if (inRoom) {
      const { state } = await getState();
      for (const person of room.people) keepers[person] = (state.keepers[person] ?? []).map((keeper) => ({ ...keeper }));
    }
    res.json({ room, keepers, now: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

/** POST /api/league/shared-mocks/:id/start — the host starts an open room. */
router.post('/shared-mocks/:id/start', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const { state } = await getState();
    const dataset = currentDataset(state);
    await changeSharedMock(res, routeParam(req.params.id), (current, at) => startOpenSharedMock(current, owner, at, () => ({
      board: sharedMockBoard(dataset, state, current.people),
      seed: Math.floor(Math.random() * 100_000),
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/shared-mocks/:id/join — take your seat. When the last
 * person sits down the draft starts: the board is built here, from the
 * league as it stands, and frozen into the room.
 */
router.post('/shared-mocks/:id/join', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const id = routeParam(req.params.id);
    const room = await sharedMockById(id);
    if (!room) {
      res.status(404).json({ error: 'No such mock.' });
      return;
    }
    if (!room.open && !room.people.includes(owner)) {
      res.status(403).json({ error: 'You were not asked to this mock.' });
      return;
    }
    if (room.open && !room.people.includes(owner)) {
      const busy = (entry: SharedMockRoom) => entry.id !== room.id && (sharedMockPhase(entry) === 'waiting' || sharedMockPhase(entry) === 'live');
      const mine = (await sharedMocksFor(owner)).find(busy);
      if (mine) {
        res.status(409).json({ error: `You have a mock open with ${namesOf(othersAt(mine, owner))}. Quit it first.` });
        return;
      }
    }
    // Everything the board needs is read first, so the write itself stays quick.
    const { state } = await getState();
    const dataset = currentDataset(state);
    await changeSharedMock(res, id, (current, at) => joinSharedMock(current, owner, at, () => ({
      board: sharedMockBoard(dataset, state, current.people),
      seed: Math.floor(Math.random() * 100_000),
    })));
  } catch (err) {
    next(err);
  }
});

/** The pick and player a body names, or null with the complaint sent. */
function sharedPickBody(req: Request, res: Response): { overall: number; playerKey: string } | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const overall = Number(body.overall);
  const playerKey = typeof body.playerKey === 'string' ? body.playerKey.trim() : '';
  if (!Number.isInteger(overall) || overall <= 0 || playerKey === '' || playerKey.length > 80) {
    res.status(400).json({ error: 'Say which pick and which player.' });
    return null;
  }
  return { overall, playerKey };
}

/** POST /api/league/shared-mocks/:id/pick — your pick, on your clock. */
router.post('/shared-mocks/:id/pick', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const pick = sharedPickBody(req, res);
    if (!pick) return;
    await changeSharedMock(res, routeParam(req.params.id), (room, at) =>
      pickInSharedMock(room, owner, pick.overall, pick.playerKey, at, 'pick'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/shared-mocks/:id/expire — the clock ran out, so the room
 * makes the pick. The person on the clock may say so the moment it hits
 * zero; anyone else at the table a few seconds later.
 */
router.post('/shared-mocks/:id/expire', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const pick = sharedPickBody(req, res);
    if (!pick) return;
    await changeSharedMock(res, routeParam(req.params.id), (room, at) => {
      if (!clockHasRunOut(room, owner, Date.parse(at))) throw new Error('Time is not up yet.');
      return pickInSharedMock(room, owner, pick.overall, pick.playerKey, at, 'auto');
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/league/shared-mocks/:id/quit — leave. A draft under way ends for everyone. */
router.post('/shared-mocks/:id/quit', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    await changeSharedMock(res, routeParam(req.params.id), (room, at) => quitSharedMock(room, owner, at));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/shared-mocks/:id/results — the grades, one per person,
 * from whichever phone finishes the replay first. Each lands in that
 * person's Past mocks and counts in Mocks done. The same draft saves once.
 */
router.post('/shared-mocks/:id/results', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const room = await sharedMockById(routeParam(req.params.id));
    if (!room) {
      res.status(404).json({ error: 'No such mock.' });
      return;
    }
    if (!room.joined.includes(owner)) {
      res.status(403).json({ error: 'You are not in this mock.' });
      return;
    }
    if (sharedMockPhase(room) !== 'finished') {
      res.status(409).json({ error: 'This mock is not finished.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const results = Array.isArray(body.results) ? body.results.slice(0, MAX_PEOPLE) : [];
    const saved: string[] = [];
    for (const entry of results) {
      const who = typeof (entry as { owner?: unknown })?.owner === 'string' ? (entry as { owner: string }).owner : '';
      if (!room.joined.includes(who)) continue;
      let record: MockResultRecord;
      try {
        record = parseMockResult(who, { ...(entry as Record<string, unknown>), vs: othersAt(room, who) });
      } catch {
        continue;
      }
      const keep = isCommissionerOwner(who) ? null : MEMBER_MOCK_LIMIT;
      // Your own phone grades you on your own numbers, so your own post
      // takes over your record. Another phone's grade of you only fills a
      // gap, since it is on the room's numbers.
      if (who === owner) await deleteMockResult(leagueDataset.season, who, record.id);
      await saveMockResult({ season: leagueDataset.season, owner: who, id: record.id, result: record, createdAt: record.finishedAt }, keep);
      saved.push(who);
    }
    res.json({ saved });
  } catch (err) {
    next(err);
  }
});

// ─── Mock trades ─────────────────────────────────────────────────────────────
//
// An offer the member builds and keeps for themselves, to draft off in the
// mock draft. It never reaches the other owner and sends no email. Only the
// owner from the sign-in can read, add or delete theirs.

/** GET /api/league/pick-trades/mock — your mock trades, oldest first. */
router.get('/pick-trades/mock', requireAuth, async (_req, res) => {
  res.json({ trades: await listMockTrades(leagueDataset.season, res.locals.owner as string) });
});

/** POST /api/league/pick-trades/mock — keep a trade as a mock. Same checks as a real offer; nothing is sent. */
router.post('/pick-trades/mock', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: ProposalInput = {
      proposer: owner,
      recipient: typeof body.recipient === 'string' ? body.recipient : '',
      offer: parsePickRefs(body.offer, 'offer', leagueDataset.season),
      request: parsePickRefs(body.request, 'request', leagueDataset.season),
      note: typeof body.note === 'string' ? body.note.trim().slice(0, MAX_TRADE_NOTE) : '',
    };
    const { state } = await getState();
    const check = checkProposalAgainstState(currentDataset(state), state, input);
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }
    const existing = await listMockTrades(leagueDataset.season, owner);
    if (existing.length >= MAX_MOCK_TRADES) {
      res.status(409).json({ error: `Keep it to ${MAX_MOCK_TRADES} mock trades. Delete one first.` });
      return;
    }
    const at = new Date().toISOString();
    const trade: MockTrade = {
      id: mockTradeId(owner, at),
      season: leagueDataset.season,
      owner,
      recipient: input.recipient,
      offer: input.offer,
      request: input.request,
      note: input.note,
      createdAt: at,
    };
    await saveMockTrade(trade);
    res.json({ trade });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/league/pick-trades/mock/:id — drop one of your mock trades. */
router.delete('/pick-trades/mock/:id', requireAuth, async (req, res) => {
  await deleteMockTrade(leagueDataset.season, res.locals.owner as string, routeParam(req.params.id));
  res.json({ ok: true });
});

/**
 * POST /pick-trades/:id/revise — the member who sent an offer changes it and
 * sends it again. Same partner, new picks and note. Every check a new offer
 * gets runs again inside the write, and the other member is mailed.
 */
router.post('/pick-trades/:id/revise', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const id = routeParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = typeof body.version === 'number' ? body.version : NaN;
    const offer = parsePickRefs(body.offer, 'offer', leagueDataset.season);
    const want = parsePickRefs(body.request, 'request', leagueDataset.season);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_TRADE_NOTE) : '';

    const now = new Date().toISOString();
    const outcomes: TradeOutcome[] = [];
    const result = await mutateState((draft) => {
      outcomes.length = 0;
      const proposals = expireStale(proposalsOf(draft), now).proposals;
      draft.pickTradeProposals = proposals;
      const index = proposals.findIndex((p) => p.id === id);
      if (index === -1) {
        outcomes.push({ refusal: { status: 404, message: 'No such offer' } });
        return;
      }
      const current = proposals[index];
      const allowed = canRevise(current, owner, version);
      if (!allowed.ok) {
        outcomes.push({
          refusal: {
            status: allowed.reason === 'not-yours-to-answer' ? 403 : 409,
            message: allowed.message ?? '',
            code: allowed.reason,
          },
        });
        return;
      }
      const input: ProposalInput = { proposer: owner, recipient: current.recipient, offer, request: want, note };
      const shape = checkProposalShape(leagueDataset, input, tradeWindow(draft) !== 'in-season');
      const check = shape.ok ? checkProposalAgainstState(currentDataset(draft), draft, input) : shape;
      if (!check.ok) {
        outcomes.push({ refusal: { status: 409, message: check.message ?? '', code: check.reason } });
        return;
      }
      const revised = reviseProposal(current, input, now);
      draft.pickTradeProposals = proposals.map((p, i) => (i === index ? revised : p));
      outcomes.push({ proposal: revised });
    });

    if (sendOutcome(res, outcomes[0])) return;
    const proposal = outcomes[0]?.proposal;
    if (!proposal) throw new HttpError(500, 'The offer could not be saved');
    await appendAudit(actor(res), 'pick-trade.revised', {
      proposalId: proposal.id,
      recipient: proposal.recipient,
      offer: proposal.offer,
      request: proposal.request,
    });
    res.json({ proposal, ...redactState(result, { owner, isCommissioner: isCommish }) });
    notifyTradeOffered(proposal, appOrigin(req), true);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /polls/:id/amend — put a passed vote into the rule book draft.
 *
 * This writes the draft only. The published book is untouched: the
 * commissioner edits the seeded wording and publishes, which is the one way a
 * published rule ever changes.
 */
router.post('/polls/:id/amend', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const id = String(req.params.id);
    const poll = (await getPoll(id)) as Poll | null;
    if (!poll) {
      res.status(404).json({ error: 'No such vote' });
      return;
    }

    const draftRow = await getRulebookDraft(RULEBOOK_SEASON);
    const base = (draftRow?.book as Rulebook | undefined) ?? SEED_RULEBOOK;
    const check = canSeedAmendment(base, poll);
    if (!check.ok) {
      res.status(409).json({ error: check.message, code: check.reason });
      return;
    }

    const at = new Date().toISOString();
    const seeded = seedAmendment(base, poll, at);
    const problems = validateDraft(seeded.book);
    if (problems.length) {
      res.status(422).json({ error: 'The seeded draft has problems', problems });
      return;
    }

    const saved = await saveRulebookDraft(
      RULEBOOK_SEASON,
      seeded.book,
      draftRow?.version ?? 0,
      owner,
    );
    await updatePoll(id, (current) => {
      const row = current as Poll;
      return { ...row, seededAt: at, seededBy: owner };
    });
    await appendAudit(actor(res), 'poll-amend', {
      pollId: id,
      draftVersion: saved.version,
      focusIds: seeded.focusIds,
    });

    res.json({
      book: seeded.book,
      version: saved.version,
      focusIds: seeded.focusIds,
      note: seeded.note,
    });
  } catch (err) {
    if (err instanceof AmendmentError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof RulebookSaveError) {
      res.status(409).json({ error: err.message, code: err.code, currentVersion: err.currentVersion });
      return;
    }
    if (err instanceof PollWriteError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

/**
 * Accept an offer.
 *
 * Everything is rechecked inside the write: the version the member saw, who
 * owns each pick right now, whether the draft has moved past them, and the
 * keeper lock. If any of it fails the whole thing is refused. A trade never
 * half happens.
 *
 * If a pick that was paying for somebody's keeper moves, that owner's keeper
 * selections are cleared in the same write and they pick again before the
 * deadline. Only the owner whose pick moved, and all of their keepers.
 */
router.post('/pick-trades/:id/accept', requireAuth, async (req, res, next) => {
  try {
    const owner = res.locals.owner as string;
    const isCommish = res.locals.isCommissioner === true;
    const id = routeParam(req.params.id);
    const expectedVersion = (req.body as { version?: unknown } | undefined)?.version;
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion)) {
      throw new HttpError(400, 'version is required; open the offer again');
    }

    const now = new Date().toISOString();
    const outcomes: TradeOutcome[] = [];
    const result = await mutateState((draft) => {
      outcomes.length = 0;
      const proposals = expireStale(proposalsOf(draft), now).proposals;
      draft.pickTradeProposals = proposals;
      const index = proposals.findIndex((p) => p.id === id);
      if (index === -1) {
        outcomes.push({ refusal: { status: 404, message: 'No such offer' } });
        return;
      }
      const proposal = proposals[index];
      const allowed = canAnswer(proposal, owner, 'accept', isCommish);
      if (!allowed.ok) {
        outcomes.push({
          refusal: {
            status: allowed.reason === 'not-yours-to-answer' ? 403 : 409,
            message: allowed.message ?? '',
            code: allowed.reason,
          },
        });
        return;
      }
      if (proposal.version !== expectedVersion) {
        outcomes.push({
          refusal: {
            status: 409,
            message: 'This offer changed since you opened it. Look at it again.',
            code: 'stale-version',
          },
        });
        return;
      }

      const input = proposalInput(proposal);
      const before = currentDataset(draft);
      const check = checkProposalAgainstState(before, draft, input);
      if (!check.ok) {
        // Something that can never come back, such as a pick that now belongs
        // to a third team, files the offer instead of leaving it in the inbox.
        if (check.fatal) {
          const filed = [...proposals];
          filed[index] = {
            ...proposal,
            status: 'invalidated',
            version: proposal.version + 1,
            resolvedAt: now,
            reason: check.message,
          };
          draft.pickTradeProposals = filed;
        }
        outcomes.push({
          refusal: { status: 409, message: check.message ?? '', code: check.reason },
        });
        return;
      }

      const moved = [...input.offer, ...input.request];
      const accepted: PickTradeProposal = {
        ...proposal,
        status: 'accepted',
        version: proposal.version + 1,
        resolvedAt: now,
        resolvedBy: owner,
      };
      // Worked out on the board as it stands, before the picks move, because
      // the question is which pick was paying for a keeper up to now. The
      // clearing happens in this same write, so a trade and its keeper reset
      // can never half apply.
      const keepersReset = ownersResetByTrade(before, draft, input);
      draft.pickTransfers = [
        ...transfersOf(draft),
        ...transfersForProposal(input, now, proposal.id),
      ];
      for (const reset of keepersReset) draft.keepers[reset] = [];
      draft.pickTradeProposals = proposals.map((p, i) => {
        if (i === index) return accepted;
        if (p.status !== 'pending') return p;
        if (!moved.some((ref) => touchesRef(p, ref))) return p;
        return {
          ...p,
          status: 'invalidated' as const,
          version: p.version + 1,
          resolvedAt: now,
          reason: 'A pick in this offer went somewhere else.',
        };
      });
      outcomes.push({ proposal: accepted, keepersReset });
    });

    if (sendOutcome(res, outcomes[0])) return;
    const proposal = outcomes[0]?.proposal;
    if (!proposal) throw new HttpError(500, 'The trade could not be saved');
    const keepersReset = outcomes[0]?.keepersReset ?? [];
    await appendAudit(actor(res), 'pick-trade.accepted', {
      proposalId: proposal.id,
      proposer: proposal.proposer,
      recipient: proposal.recipient,
      offer: proposal.offer,
      request: proposal.request,
      acceptedAt: proposal.resolvedAt,
      acceptedBy: owner,
      // Draft positions decide a pick's slot and never move, so the base
      // dataset is enough to name the exact picks here.
      summary: describeTrade(proposal, leagueDataset),
      keepersReset,
    });
    res.json({
      proposal,
      keepersReset,
      ...redactState(result, { owner, isCommissioner: isCommish }),
    });
    notifyTradeAccepted(proposal, appOrigin(req), keepersReset);
  } catch (err) {
    next(err);
  }
});

/**
 * Turn an offer down (recipient) or pull it back (proposer, or a commissioner
 * clearing something stuck). Nothing is deleted; the record keeps its outcome.
 */
function settleRoute(action: 'reject' | 'cancel', auditAction: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const owner = res.locals.owner as string;
      const isCommish = res.locals.isCommissioner === true;
      const id = routeParam(req.params.id);
      const now = new Date().toISOString();
      const outcomes: TradeOutcome[] = [];

      const result = await mutateState((draft) => {
        outcomes.length = 0;
        const proposals = expireStale(proposalsOf(draft), now).proposals;
        draft.pickTradeProposals = proposals;
        const index = proposals.findIndex((p) => p.id === id);
        if (index === -1) {
          outcomes.push({ refusal: { status: 404, message: 'No such offer' } });
          return;
        }
        const proposal = proposals[index];
        const allowed = canAnswer(proposal, owner, action, isCommish);
        if (!allowed.ok) {
          outcomes.push({
            refusal: {
              status: allowed.reason === 'not-yours-to-answer' ? 403 : 409,
              message: allowed.message ?? '',
              code: allowed.reason,
            },
          });
          return;
        }
        const settled: PickTradeProposal = {
          ...proposal,
          status: action === 'reject' ? 'rejected' : 'cancelled',
          version: proposal.version + 1,
          resolvedAt: now,
          resolvedBy: owner,
          reason:
            action === 'cancel' && isCommish && proposal.proposer !== owner
              ? 'A commissioner cleared this offer.'
              : undefined,
        };
        const next = [...proposals];
        next[index] = settled;
        draft.pickTradeProposals = next;
        outcomes.push({ proposal: settled });
      });

      if (sendOutcome(res, outcomes[0])) return;
      const proposal = outcomes[0]?.proposal;
      if (!proposal) throw new HttpError(500, 'The offer could not be settled');
      await appendAudit(actor(res), auditAction, {
        proposalId: proposal.id,
        proposer: proposal.proposer,
        recipient: proposal.recipient,
        byCommissioner: isCommish && proposal.proposer !== owner && proposal.recipient !== owner,
      });
      res.json({
        proposal,
        ...redactState(result, { owner, isCommissioner: isCommish }),
      });
      notifyTradeSettled(proposal, action, owner, appOrigin(req));
    } catch (err) {
      next(err);
    }
  };
}

router.post('/pick-trades/:id/reject', requireAuth, settleRoute('reject', 'pick-trade.rejected'));
router.post('/pick-trades/:id/cancel', requireAuth, settleRoute('cancel', 'pick-trade.cancelled'));

// ─── League history ──────────────────────────────────────────────────────────
//
// Published history is immutable and readable by anyone, the same as the rule
// book. Importing writes to the draft and never to a published revision, and a
// correction publishes a new revision carrying the reason for it.

/** Everyone reads this. Falls back to the committed seed before a first publish. */
router.get('/history', async (_req, res, next) => {
  try {
    res.json(await resolvePublishedHistory());
  } catch (err) {
    next(err);
  }
});

router.get('/history/versions', async (_req, res, next) => {
  try {
    res.json(await listHistoryVersions(HISTORY_SEASON));
  } catch (err) {
    next(err);
  }
});

router.get('/history/draft', requireAuth, requireCommissioner, async (_req, res, next) => {
  try {
    res.json(await resolveHistoryDraft());
  } catch (err) {
    next(err);
  }
});

router.put('/history/draft', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = req.body as { history?: unknown; expectedVersion?: unknown };
    if (
      typeof body.expectedVersion !== 'number'
      || !Number.isInteger(body.expectedVersion)
      || body.expectedVersion < 0
    ) {
      throw new HttpError(400, 'expectedVersion must be a whole number');
    }
    let history;
    try {
      history = parseHistoryDocument(body.history);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid history');
    }

    // Broken facts are refused on the way in rather than found at publish time.
    const problems = validateHistory(history).filter((problem) => problem.severity === 'error');
    if (problems.length) {
      res.status(422).json({ error: 'The history draft has problems that must be fixed', problems });
      return;
    }

    const owner = res.locals.owner as string;
    const saved = await saveHistoryDraft(HISTORY_SEASON, history, body.expectedVersion, owner);
    await appendAudit(actor(res), 'history-draft-save', {
      version: saved.version,
      seasons: history.seasons.length,
      records: history.records.length,
    });
    res.json({ version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
  } catch (err) {
    if (err instanceof HistorySaveError) {
      res.status(409).json({ error: err.message, code: err.code, currentVersion: err.currentVersion });
      return;
    }
    next(err);
  }
});

router.delete('/history/draft', requireAuth, requireCommissioner, async (_req, res, next) => {
  try {
    await deleteHistoryDraft(HISTORY_SEASON);
    await appendAudit(actor(res), 'history-draft-reset', { season: HISTORY_SEASON });
    res.json(await resolveHistoryDraft());
  } catch (err) {
    next(err);
  }
});

/**
 * Read one ESPN season and show what it would change. Writes nothing.
 *
 * With no `payload` in the body the server pulls the season live, which needs
 * ESPN credentials in the environment. A commissioner who has the response
 * already can post it as `payload` instead.
 */
router.post('/history/import/preview', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    let request;
    try {
      request = parseImportRequest(req.body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid import request');
    }

    const live = request.payload === undefined;
    let payload = request.payload;
    if (!payload) {
      try {
        payload = await fetchEspnSeasonPayload(request.espnSeasonId);
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : 'ESPN could not be reached',
          code: 'espn-unavailable',
        });
        return;
      }
    }

    const { history } = await resolveHistoryDraft();
    const prepared = prepareSeasonImport(history, payload, request, new Date().toISOString(), live);
    res.json({
      fingerprint: prepared.fingerprint,
      blocked: prepared.blocked,
      diff: prepared.diff,
      conflicts: prepared.conflicts,
      problems: prepared.problems,
      importProblems: prepared.importProblems,
      espnTeams: prepared.espnTeams,
      candidate: prepared.candidate,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Save the exact previewed import into the draft. Still not published: the
 * commissioner reads the draft, then confirms.
 */
router.post('/history/import/apply', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.fingerprint !== 'string' || body.fingerprint === '') {
      throw new HttpError(400, 'fingerprint is required; preview the import first');
    }
    if (typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion)) {
      throw new HttpError(400, 'expectedVersion must be a whole number');
    }
    let request;
    try {
      request = parseImportRequest(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid import request');
    }

    const live = request.payload === undefined;
    let payload = request.payload;
    if (!payload) {
      try {
        payload = await fetchEspnSeasonPayload(request.espnSeasonId);
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : 'ESPN could not be reached',
          code: 'espn-unavailable',
        });
        return;
      }
    }

    const draft = await resolveHistoryDraft();
    const prepared = prepareSeasonImport(draft.history, payload, request, new Date().toISOString(), live);
    if (prepared.blocked) {
      res.status(422).json({
        error: 'That season cannot be imported yet',
        importProblems: prepared.importProblems,
      });
      return;
    }
    // The import must be exactly what was previewed. Anything else means the
    // draft or the ESPN answer moved, so refuse rather than write a surprise.
    if (prepared.fingerprint !== body.fingerprint) {
      res.status(409).json({
        error: 'The import changed since you previewed it. Look again.',
        code: 'stale-fingerprint',
        fingerprint: prepared.fingerprint,
      });
      return;
    }
    const errors = prepared.problems.filter((problem) => problem.severity === 'error');
    if (errors.length) {
      res.status(422).json({ error: 'The import would break the record book', problems: errors });
      return;
    }

    const owner = res.locals.owner as string;
    const saved = await saveHistoryDraft(
      HISTORY_SEASON,
      prepared.candidate,
      body.expectedVersion,
      owner,
    );
    await appendAudit(actor(res), 'history-import', {
      seasonNumber: request.seasonNumber,
      espnSeasonId: request.espnSeasonId,
      live,
      changes: prepared.diff.changes.length,
      conflicts: prepared.conflicts.length,
      version: saved.version,
    });
    res.json({
      version: saved.version,
      changes: prepared.diff.changes.length,
      conflicts: prepared.conflicts,
      problems: prepared.problems,
    });
  } catch (err) {
    if (err instanceof HistorySaveError) {
      res.status(409).json({ error: err.message, code: err.code, currentVersion: err.currentVersion });
      return;
    }
    next(err);
  }
});

router.post('/history/publish', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = req.body as { fingerprint?: unknown; notes?: unknown; reason?: unknown };
    if (typeof body.fingerprint !== 'string' || !body.fingerprint) {
      throw new HttpError(400, 'fingerprint is required; preview the changes first');
    }
    // Every revision says why it exists, so a correction can never be silent.
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (reason.length < 3) {
      throw new HttpError(400, 'reason is required; say why this revision exists');
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';

    const draftRow = await getHistoryDraft(HISTORY_SEASON);
    if (!draftRow) throw new HttpError(409, 'There is no history draft to publish');
    const history = draftRow.history as LeagueHistory;

    const actual = historyFingerprint(history);
    if (actual !== body.fingerprint) {
      res.status(409).json({
        error: 'The draft changed since you previewed it. Look at the diff again.',
        code: 'stale-fingerprint',
        fingerprint: actual,
      });
      return;
    }

    const problems = validateHistory(history).filter((problem) => problem.severity === 'error');
    if (problems.length) {
      res.status(422).json({ error: 'The history has problems that must be fixed', problems });
      return;
    }

    const previous = await getLatestHistoryVersion(HISTORY_SEASON);
    if (previous && previous.fingerprint === actual) {
      res.status(409).json({
        error: 'That is already the published history; nothing has changed.',
        code: 'no-changes',
      });
      return;
    }

    const owner = res.locals.owner as string;
    const publishedAt = new Date().toISOString();
    const revision = (previous?.revision ?? FALLBACK_HISTORY.revision - 1) + 1;
    // The stored fingerprint is the DRAFT's, not the frozen document's. Freezing
    // bumps the revision, which is part of the fingerprint, so storing the
    // frozen one would make the no-changes check above dead.
    const frozen = { ...history, revision, status: 'published' as const };
    const saved = await publishHistoryVersion({
      id: `lh-${HISTORY_SEASON}-r${revision}-${actual.slice(3, 11)}`,
      season: HISTORY_SEASON,
      revision,
      fingerprint: actual,
      history: frozen,
      notes,
      reason,
      publishedAt,
      publishedBy: owner,
    });

    await appendAudit(actor(res), 'history-publish', {
      versionId: saved.id,
      revision,
      reason,
      notes,
      previousVersionId: previous?.id ?? null,
    });
    res.json({
      versionId: saved.id,
      revision,
      publishedAt: saved.publishedAt,
      publishedBy: saved.publishedBy,
      reason,
    });
  } catch (err) {
    if (err instanceof HistoryPublishError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

router.get('/history/versions/:id', async (req, res, next) => {
  try {
    const version = await getHistoryVersion(routeParam(req.params.id));
    if (!version) {
      res.status(404).json({ error: 'No such history revision' });
      return;
    }
    res.json(version);
  } catch (err) {
    next(err);
  }
});

router.get('/audit', requireAuth, requireCommissioner, async (req, res) => {
  const parsed = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
  const [rows, { state }] = await Promise.all([readAudit(limit), getState()]);
  // Blind means blind: the log would otherwise name every keeper saved.
  if (!seesAllKeepers(state, true) && state.keepersRevealed !== true) {
    res.json(rows.map((row) => (row.action === 'keepers.set' ? { ...row, detail: { target: (row.detail as { target?: unknown } | null)?.target ?? null } } : row)));
    return;
  }
  res.json(rows);
});

// ─── Error handler ───────────────────────────────────────────────────────────

// ─── Dues ────────────────────────────────────────────────────────────────────
//
// The app cannot see Venmo. A member says they paid; a commissioner confirms
// it landed. Everything else is the commissioner's.

const DUES_SEASON = leagueDataset.season;

async function duesResponse() {
  const [rows, settings] = await Promise.all([listDues(DUES_SEASON), getDuesSettings(DUES_SEASON)]);
  return {
    season: DUES_SEASON,
    full: DUES_FULL,
    half: DUES_HALF,
    halfMaxTeams: DUES_HALF_MAX_TEAMS,
    venmo: settings?.venmo ?? '',
    payee: settings?.payee ?? '',
    ...duesBoard(DUES_SEASON, OWNERS, rows),
  };
}

/** Anyone may read who has paid. It is league business, like the standings. */
router.get('/dues', async (_req, res, next) => {
  try {
    res.json(await duesResponse());
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/dues/shame — mail every team that has not paid or said it
 * paid (commissioner only). Teams that tapped I PAID are left alone.
 */
router.post('/dues/shame', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const dues = await duesResponse();
    const owners = shameList(dues);
    if (!owners.length) throw new HttpError(409, 'Every team has paid or says it has. Nobody to shame.');
    const result = await sendDuesShame(
      { owners, season: DUES_SEASON, board: dues, payee: dues.payee },
      appOrigin(req),
    );
    await appendAudit(actor(res), 'dues.shame', { sent: result.sent, noAddress: result.noAddress });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/league/dues/:owner — one change to one team's dues. A member may
 * mark their own team paid, or take that back until it is confirmed. The
 * commissioner may do anything.
 */
router.post('/dues/:owner', requireAuth, async (req, res, next) => {
  try {
    const owner = String(req.params.owner);
    if (!OWNERS.includes(owner)) throw new HttpError(404, 'No such member');
    const action = (req.body as { action?: unknown }).action;
    if (typeof action !== 'string' || !DUES_ACTIONS.includes(action as DuesAction)) {
      throw new HttpError(400, `action must be one of ${DUES_ACTIONS.join(', ')}`);
    }
    const [rows, settings] = await Promise.all([listDues(DUES_SEASON), getDuesSettings(DUES_SEASON)]);
    const current = rows.find((r) => r.owner === owner) ?? blankDuesRow(DUES_SEASON, owner);
    const result = applyDuesAction({
      row: current,
      action: action as DuesAction,
      actor: res.locals.owner as string,
      isCommissioner: res.locals.isCommissioner === true,
      // The member who collects confirms payments, and gains nothing else.
      isCollector: Boolean(settings?.payee) && settings?.payee === res.locals.owner,
      now: new Date().toISOString(),
      rows,
    });
    if (!result.ok) throw new HttpError(result.status, result.message);
    const saved = await saveDues(result.row, current.updatedAt);
    if (!saved) throw new HttpError(409, 'Someone else just changed this. Look again and retry.');
    await appendAudit(actor(res), `dues.${action}`, { owner, season: DUES_SEASON });
    res.json(await duesResponse());
  } catch (err) {
    next(err);
  }
});

/** PUT /api/league/dues/settings — who collects, and their Venmo (commissioner only). */
router.put('/dues/settings', requireAuth, requireCommissioner, async (req, res, next) => {
  try {
    const body = req.body as { venmo?: unknown; payee?: unknown };
    const venmoInput = typeof body.venmo === 'string' ? body.venmo : '';
    const venmo = venmoInput.trim() === '' ? '' : parseVenmoHandle(venmoInput);
    if (venmo === null) {
      throw new HttpError(400, 'That is not a Venmo username or link. Try @name or venmo.com/u/name.');
    }
    const payee = typeof body.payee === 'string' ? body.payee : '';
    if (payee !== '' && !OWNERS.includes(payee)) throw new HttpError(400, 'Pick a member to collect');
    const row: DuesSettings = {
      season: DUES_SEASON,
      venmo,
      payee,
      updatedAt: new Date().toISOString(),
      updatedBy: actor(res),
    };
    await saveDuesSettings(row);
    await appendAudit(actor(res), 'dues.settings', { venmo, payee });
    res.json(await duesResponse());
  } catch (err) {
    next(err);
  }
});

// ─── Achievements ────────────────────────────────────────────────────────────
//
// Each achievement buys one look at one keeper. What an owner has done is read
// from the league's own records every time, then stamped into the ledger so it
// sticks. See src/lib/league/achievements.ts.

/** What owners have done, from the records. Everyone by default; one owner for a quick check. */
async function achievementFacts(
  state: LeagueDynamicState,
  who: readonly string[] = OWNERS,
): Promise<Record<string, OwnerFacts>> {
  const season = leagueDataset.season;
  const [signatures, polls, dues, finishes, mocks] = await Promise.all([
    listRulebookSignatures(RULEBOOK_SEASON),
    seasonPolls(),
    listDues(DUES_SEASON),
    listMockFinishes(season),
    Promise.all(who.map((owner) => listMockResults(season, owner))),
  ]);
  // The same counts the MOCKS DONE table shows, from the log that is never trimmed.
  const mockRows = new Map(mockStats(OWNERS, finishes).map((row) => [row.owner, row]));
  const ledger = ledgerOf(state.achievements);
  const proposals = proposalsOf(state);
  const props = allProps(state);
  const facts: Record<string, OwnerFacts> = {};
  who.forEach((owner, i) => {
    const saved = mocks[i].map((row) => row.result as Partial<MockResultRecord> | null);
    const visible = visibleProps(props, [owner]);
    const sides = visible.filter((p) => p.takes.some((t) => t.owner === owner)).length;
    const mine = proposals.filter((p) => p.proposer === owner);
    // A commissioner who sees every keeper proves nothing by guessing.
    const guesses = seesAllKeepers(state, isCommissionerOwner(owner)) ? { hits: 0, near: 0 } : keeperGuessScore(state, ledger, owner);
    facts[owner] = {
      ...NO_FACTS,
      signedRulebook: signatures.some((sig) => sig.owner === owner),
      drewSignature: signatures.some((sig) => sig.owner === owner && Boolean(sig.drawing)),
      mocksFinished: mockRows.get(owner)?.mocks ?? 0,
      bestMockGrade: mockRows.get(owner)?.bestGrade ?? null,
      bestSteal: Math.max(0, ...saved.map((r) => r?.grade?.steal?.by ?? 0)),
      mockedWithTrade: saved.some((r) => (r?.tradesOn?.length ?? 0) > 0),
      tradesOffered: mine.length,
      offersRevised: mine.filter((p) => Boolean(p.revisedAt)).length,
      offersClosed: mine.filter((p) => p.status === 'accepted').length,
      offersTaken: proposals.filter((p) => p.recipient === owner && p.status === 'accepted').length,
      propBetsSet: props.filter((p) => p.createdBy === owner).length,
      propSidesTaken: sides,
      allPropsCovered: coversAllProps(visible.length, sides),
      votesCast: polls.filter((poll) => poll.votes.some((v) => v.owner === owner)).length,
      pollsOpened: polls.filter((poll) => poll.proposedBy === owner).length,
      scoutHits: guesses.hits,
      closeCalls: guesses.near,
      // Marking it sent is not enough; the collector has to confirm it.
      duesPaid: dues.some((row) => row.owner === owner && row.verifiedAt !== null),
    };
  });
  return facts;
}

/** Teams whose keepers this owner named on the first saved guess: all of them, or at least one. */
function keeperGuessScore(state: LeagueDynamicState, ledger: AchievementLedger, owner: string): { hits: number; near: number } {
  const guesses = Object.entries(ledger.firstGuesses[owner] ?? {}).filter(([target]) => target !== owner);
  const reveals = ledger.reveals[owner] ?? [];
  let hits = 0;
  let near = 0;
  for (const [target, guess] of guesses) {
    const actual = (state.keepers[target] ?? []).map((k) => k.playerKey);
    const revealedAt = reveals.find((r) => r.target === target)?.at ?? null;
    if (guessHit(guess, actual, revealedAt)) hits += 1;
    if (guessNear(guess, actual, revealedAt)) near += 1;
  }
  return { hits, near };
}

/**
 * Guesses saved before first-guess tracking shipped count as the first. Copy
 * them into the ledger once, so a later edit cannot replace them.
 */
async function seedFirstGuesses(state: LeagueDynamicState, who: readonly string[] = OWNERS): Promise<boolean> {
  if (state.keepersRevealed === true) return false;
  const ledger = ledgerOf(state.achievements);
  const scenarios = await Promise.all(who.map((owner) => getKeeperScenario(state.season, owner)));
  const at = new Date().toISOString();
  const missing: Array<{ owner: string; target: string; keys: string[] }> = [];
  who.forEach((owner, i) => {
    for (const [target, sels] of Object.entries(scenarios[i])) {
      if (target === owner || sels.length === 0 || ledger.firstGuesses[owner]?.[target]) continue;
      missing.push({ owner, target, keys: sels.map((s) => s.playerKey) });
    }
  });
  if (missing.length === 0) return false;
  await mutateState((draft) => {
    const next = ledgerOf(draft.achievements);
    for (const m of missing) {
      const guess = firstGuessToRecord(next.firstGuesses[m.owner]?.[m.target], m.keys, [], at);
      if (guess) next.firstGuesses[m.owner] = { ...(next.firstGuesses[m.owner] ?? {}), [m.target]: guess };
    }
    draft.achievements = next;
  });
  return true;
}

/** Stamp anything new, for everyone or just the owners named. Writes only when something changed. */
async function syncAchievements(
  who: readonly string[] = OWNERS,
): Promise<{ state: LeagueDynamicState; facts: Record<string, OwnerFacts> }> {
  let current = await getState();
  if (await seedFirstGuesses(current.state, who)) current = await getState();
  const facts = await achievementFacts(current.state, who);
  const at = new Date().toISOString();
  const before = ledgerOf(current.state.achievements);
  const changed = who.some((owner) => stampEarned(before.earned[owner], earnedFrom(facts[owner]), at) !== null);
  if (!changed) return { state: current.state, facts };
  const result = await mutateState((draft) => {
    const ledger = ledgerOf(draft.achievements);
    for (const owner of who) {
      const next = stampEarned(ledger.earned[owner], earnedFrom(facts[owner]), at);
      if (next) ledger.earned[owner] = next;
    }
    draft.achievements = ledger;
  });
  return { state: result.state, facts };
}

function revealState(state: LeagueDynamicState, ledger: AchievementLedger, owner: string, isCommissioner: boolean) {
  const earned = ledger.earned[owner] ?? {};
  const reveals = ledger.reveals[owner] ?? [];
  const left = revealsLeft(earnedCount(earned), reveals.length);
  const hidden = hiddenKeepers(owner, OWNERS, state.keepers, reveals);
  const check = canReveal({
    keepersPublic: state.keepersRevealed === true,
    isCommissioner: seesAllKeepers(state, isCommissioner),
    left,
    hidden: hiddenCount(hidden),
  });
  return { earned, reveals, left, hidden, check };
}

function achievementsPayload(
  state: LeagueDynamicState,
  facts: Record<string, OwnerFacts>,
  owner: string,
  isCommissioner: boolean,
) {
  const ledger = ledgerOf(state.achievements);
  const mine = revealState(state, ledger, owner, isCommissioner);
  // One card per team, with only the keepers this owner has been shown.
  const teams = [...new Set(mine.reveals.map((r) => r.target))].map((target) => {
    const kept = state.keepers[target] ?? [];
    const shown = mine.reveals.filter((r) => r.target === target);
    return {
      target,
      keeping: kept.length,
      shown: shown.map((r) => {
        const still = kept.find((k) => k.playerKey === r.playerKey);
        return { playerKey: r.playerKey, at: r.at, playerName: still?.playerName ?? null };
      }),
      lastAt: shown[shown.length - 1].at,
    };
  });
  return {
    you: {
      owner,
      earned: mine.earned,
      facts: facts[owner] ?? NO_FACTS,
      left: mine.left,
      check: mine.check,
      teams,
    },
    standings: standings(OWNERS, ledger),
    keepersPublic: state.keepersRevealed === true,
  };
}

/** GET /api/league/achievements — what you have earned, your reveals, and the league board. */
router.get('/achievements', requireAuth, async (_req, res) => {
  const { state, facts } = await syncAchievements();
  res.json(achievementsPayload(state, facts, res.locals.owner as string, res.locals.isCommissioner === true));
});

/**
 * GET /api/league/achievements/news — achievements you have earned and not
 * been shown yet. The app asks after every change you make, so it checks only
 * you. The commissioner acting as someone gets nothing, so the real member
 * still sees their own toast.
 */
router.get('/achievements/news', requireAuth, async (_req, res) => {
  const owner = res.locals.owner as string;
  if (res.locals.actingBy) {
    res.json({ fresh: [], left: 0, canReveal: false });
    return;
  }
  const { state } = await syncAchievements([owner]);
  const ledger = ledgerOf(state.achievements);
  const mine = revealState(state, ledger, owner, res.locals.isCommissioner === true);
  res.json({ fresh: unseenAchievements(ledger, owner), left: mine.left, canReveal: mine.check.ok });
});

/** POST /api/league/achievements/seen — the toast for these was shown. */
router.post('/achievements/seen', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  if (res.locals.actingBy) {
    res.json({ ok: true });
    return;
  }
  const raw = (req.body as { ids?: unknown } | undefined)?.ids;
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, 50) : [];
  await mutateState((draft) => {
    const ledger = ledgerOf(draft.achievements);
    ledger.seen[owner] = markSeen(ledger.seen[owner], ids);
    draft.achievements = ledger;
  });
  res.json({ ok: true });
});

/** POST /api/league/achievements/reveal — spend one reveal on one keeper of a random team. */
router.post('/achievements/reveal', requireAuth, async (_req, res) => {
  const owner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner === true;
  const { facts } = await syncAchievements();
  let shown: { target: string; playerKey: string } | null = null;
  const result = await mutateState((draft) => {
    const ledger = ledgerOf(draft.achievements);
    const mine = revealState(draft, ledger, owner, isCommissioner);
    if (!mine.check.ok) throw new HttpError(409, mine.check.message ?? 'No reveal to spend');
    const pick = pickReveal(mine.hidden, Math.random);
    if (!pick) throw new HttpError(409, 'No keeper to show');
    shown = pick;
    ledger.reveals[owner] = [...mine.reveals, { ...pick, at: new Date().toISOString() }];
    draft.achievements = ledger;
  });
  await appendAudit(actor(res), 'achievement.reveal', { target: (shown as { target: string } | null)?.target ?? null });
  res.json({ ...achievementsPayload(result.state, facts, owner, isCommissioner), revealed: shown });
});

// ─── Prop bets ───────────────────────────────────────────────────────────────
//
// Over/unders on league members. Open to every member; setting and taking
// sides lock when the draft starts. Nobody ever sees a prop about themselves,
// so every read and write here filters by the viewer and anyone acting
// through them. See src/lib/league/propBets.ts.

/** Most props one member may set, so the page stays readable. */
const MAX_PROPS_PER_MEMBER = 30;

/** Who must not see a prop: the member, and the commissioner acting as them. */
function propBlind(res: Response): string[] {
  const owner = res.locals.owner as string;
  const by = res.locals.actingBy as string | null | undefined;
  return by ? [owner, by] : [owner];
}

function allProps(state: LeagueDynamicState): PropBet[] {
  return (state.propBets ?? []).map(normalizeProp);
}

function propPayload(state: LeagueDynamicState, res: Response) {
  return {
    props: visibleProps(allProps(state), propBlind(res)),
    locked: propsLocked(state.draft.startedAt),
    owners: OWNERS,
  };
}

/** GET /api/league/prop-bets — every prop you are allowed to see. */
router.get('/prop-bets', requireAuth, async (_req, res) => {
  const { state } = await getState();
  res.json(propPayload(state, res));
});

/** POST /api/league/prop-bets — set a new line. */
router.post('/prop-bets', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  const parsed = parsePropInput((req.body ?? {}) as Record<string, unknown>, OWNERS, propBlind(res));
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.message, field: parsed.field });
    return;
  }
  const at = new Date().toISOString();
  const id = `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const result = await mutateState((draft) => {
    if (propsLocked(draft.draft.startedAt)) throw new HttpError(409, 'The draft has started. Props are locked.');
    const props = allProps(draft);
    if (props.some((p) => sameProp(p, parsed.input))) throw new HttpError(409, 'That prop is already up.');
    if (props.filter((p) => p.createdBy === owner).length >= MAX_PROPS_PER_MEMBER) {
      throw new HttpError(409, `You have set ${MAX_PROPS_PER_MEMBER} props. Take one down first.`);
    }
    draft.propBets = [...props, { id, ...parsed.input, createdBy: owner, createdAt: at, takes: [] }];
    // Stamp BOOKIE now, so taking the prop down later cannot lose it.
    const ledger = ledgerOf(draft.achievements);
    const next = stampEarned(ledger.earned[owner], ['prop-bet'], at);
    if (next) ledger.earned[owner] = next;
    draft.achievements = ledger;
  });
  // The words stay out of the log. The commissioner reads it, and some props are about him.
  await appendAudit(actor(res), 'prop-bet.set', { id });
  res.json(propPayload(result.state, res));
});

/** A prop the caller may see. One about them answers 404, as if it did not exist. */
function findProp(state: LeagueDynamicState, id: string, res: Response): PropBet {
  const prop = visibleProps(allProps(state), propBlind(res)).find((p) => p.id === id);
  if (!prop) throw new HttpError(404, 'No such prop');
  return prop;
}

function replaceProp(state: LeagueDynamicState, next: PropBet): void {
  state.propBets = allProps(state).map((p) => (p.id === next.id ? next : p));
}

/** POST /api/league/prop-bets/:id/take — take the over or the under, or `null` to step off. */
router.post('/prop-bets/:id/take', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  const raw = (req.body as { side?: unknown } | undefined)?.side;
  if (raw !== 'over' && raw !== 'under' && raw !== null) {
    res.status(400).json({ error: 'Pick over or under' });
    return;
  }
  const side: PropSide | null = raw;
  const id = String(req.params.id);
  const result = await mutateState((draft) => {
    if (propsLocked(draft.draft.startedAt)) throw new HttpError(409, 'The draft has started. Sides are locked.');
    replaceProp(draft, takeSide(findProp(draft, id, res), owner, side, new Date().toISOString()));
  });
  await appendAudit(actor(res), 'prop-bet.take', { id, side });
  res.json(propPayload(result.state, res));
});

/** POST /api/league/prop-bets/:id/result — enter the final count, or `null` to clear it. */
router.post('/prop-bets/:id/result', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner === true;
  const parsed = parseResult((req.body as { result?: unknown } | undefined)?.result);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.message });
    return;
  }
  const id = String(req.params.id);
  const result = await mutateState((draft) => {
    const prop = findProp(draft, id, res);
    if (!canSettleProp(prop, owner, isCommissioner)) {
      throw new HttpError(403, 'Only whoever set it, or the commissioner, enters the result');
    }
    replaceProp(draft, { ...prop, result: parsed.value, settledBy: owner, settledAt: new Date().toISOString() });
  });
  await appendAudit(actor(res), 'prop-bet.result', { id, result: parsed.value });
  res.json(propPayload(result.state, res));
});

/** DELETE /api/league/prop-bets/:id — the setter or a commissioner takes it down. */
router.delete('/prop-bets/:id', requireAuth, async (req, res) => {
  const owner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner === true;
  const id = String(req.params.id);
  const result = await mutateState((draft) => {
    const prop = findProp(draft, id, res);
    if (!canRemoveProp(prop, owner, isCommissioner)) {
      throw new HttpError(403, 'Only whoever set it, or the commissioner, can take it down');
    }
    if (propsLocked(draft.draft.startedAt) && !isCommissioner) {
      throw new HttpError(409, 'The draft has started. Props are locked.');
    }
    draft.propBets = allProps(draft).filter((p) => p.id !== id);
  });
  await appendAudit(actor(res), 'prop-bet.removed', { id });
  res.json(propPayload(result.state, res));
});


router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  if (err instanceof PlayerPoolAcceptError) {
    res.status(409).json({ error: err.message, reason: err.reason });
    return;
  }
  if (err instanceof ScheduleAcceptError) {
    res.status(409).json({ error: err.message, reason: err.reason });
    return;
  }
  if (err instanceof DraftRankingAcceptError) {
    res.status(409).json({ error: err.message, reason: err.reason });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[league] Unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

export default router;
