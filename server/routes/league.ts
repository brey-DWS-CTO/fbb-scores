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
import type {
  LeagueDataset,
  PickRef,
  PickTradeProposal,
} from '../../src/lib/keeper/types.js';
import {
  canAnswer,
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
  previewProposal,
  proposalInput,
  proposalsOf,
  touchesRef,
  tradeableSeason,
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
  getPins,
  setPin,
  getPinStatus,
  claimPin,
  appendAudit,
  acceptPlayerPoolSnapshot,
  acceptScheduleSnapshot,
  clearKeeperScenario,
  clearKeeperScenariosForSeason,
  getKeeperScenario,
  readAudit,
  isKnownOwner,
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
  listRulebookSignatures,
  insertRulebookSignature,
  listPolls,
  getPoll,
  insertPoll,
  updatePoll,
  OWNERS,
  type KeeperSelection,
  type LeagueDynamicState,
} from '../lib/leagueStore.js';
import { LINK_TTL_MINUTES } from '../../src/lib/league/auth.js';
import { sendLoginLink } from '../lib/mailer.js';
import {
  notifyKeepersRevealed,
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
import { validateDraft } from '../../src/lib/league/rulebookEdit.js';
import { rulebookFingerprint } from '../../src/lib/league/rulebookDiff.js';
import type { Rulebook } from '../../src/lib/league/rulebook.js';
import {
  ACKNOWLEDGEMENT,
  canSign,
  makeSignature,
  signatureStatus,
} from '../../src/lib/league/rulebookSignatures.js';
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
    viewer: viewer.owner,
    isCommissioner: viewer.isCommissioner,
  };
}

function redactState<T extends { state: LeagueDynamicState }>(result: T, viewer: Viewer) {
  const meta = stateMeta(result.state, viewer);
  let keepers = result.state.keepers;
  if (!meta.revealed && !viewer.isCommissioner) {
    keepers =
      viewer.owner && result.state.keepers[viewer.owner]
        ? { [viewer.owner]: result.state.keepers[viewer.owner] }
        : {};
  }
  // Pending offers are between two members. Accepted trades are league news,
  // so the ledger itself is never redacted.
  const proposals = expireStale(proposalsOf(result.state), new Date().toISOString()).proposals;
  return {
    ...result,
    state: {
      ...result.state,
      keepers,
      pickTransfers: transfersOf(result.state),
      pickTradeProposals: visibleProposals(proposals, viewer.owner, viewer.isCommissioner),
    },
    meta,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/league/state — poll target. Auth headers optional; they control
 * how much of the keeper map the caller may see (see redactState).
 */
router.get('/state', async (req, res) => {
  const viewer = await optionalViewer(req);
  res.json(redactState(await getState(), viewer));
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
    if (draft.locks.keepersLocked && !isCommissioner) {
      throw new HttpError(423, 'Keepers are locked');
    }
    validateKeeperSelections(draft, target, clean);
    draft.keepers[target] = clean;
  });
  await appendAudit(actor(res), 'keepers.set', { target, selections: clean });
  res.json(redactState(result, { owner: authedOwner, isCommissioner }));
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
  const current = await getState();
  const draftPoolDataset = await resolveDraftDataset(current.state);
  const player = draftPoolDataset.players.find((candidate) => candidate.key === playerKey);
  if (!player) {
    res.status(400).json({ error: `Unknown player: ${playerKey}` });
    return;
  }
  const timestamp = new Date().toISOString();
  const result = await mutateState((draft) => {
    if (draft.draft.startedAt === null) {
      throw new HttpError(409, "The draft hasn't started yet — the commissioner has to hit START DRAFT.");
    }
    const dataset = currentDataset(draft, draftPoolDataset);
    const onClock = buildDraftBoard(dataset, draft).find((cell) => cell.onClock);
    if (!onClock) throw new HttpError(409, 'The draft is complete');
    if (onClock.pick.overall !== overallPick) {
      throw new HttpError(409, `Pick #${onClock.pick.overall} is on the clock`);
    }
    if (!isCommissioner && onClock.pick.currentOwner !== authedOwner) {
      throw new HttpError(403, `Only ${onClock.pick.currentOwner} can enter this pick`);
    }
    if (!availablePlayers(dataset, draft).some((candidate) => candidate.key === player.key)) {
      throw new HttpError(409, `${player.name} is already off the board`);
    }
    draft.draft.picks[String(overallPick)] = {
      playerKey: player.key,
      playerName: player.name,
      proTeam: player.proTeam,
      positions: player.positions,
      isKeeper: false,
      enteredBy: authedOwner,
      timestamp,
    };
  });
  await appendAudit(actor(res), 'draft.pick', {
    overallPick,
    playerKey: player.key,
    playerName: player.name,
    proTeam: player.proTeam,
    positions: player.positions,
    isKeeper: false,
  });
  res.json(redactState(result, { owner: authedOwner, isCommissioner }));
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
  const result = await mutateState((draft) => {
    delete draft.draft.picks[String(overallPick)];
  });
  await appendAudit(actor(res), 'draft.pick_cleared', { overallPick });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
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
    }
  });
  await appendAudit(actor(res), 'draft.started', null);
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
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
 * GET /api/league/pins — list every owner's PIN (commissioner only).
 */
router.get('/pins', requireAuth, requireCommissioner, async (_req, res) => {
  res.json(await getPins());
});

/**
 * POST /api/league/pins/:owner — set or clear an owner's PIN (commissioner
 * only). Body: { pin: string } — 4-8 characters, or "" to clear so the owner
 * sets a fresh one on their next sign-in.
 */
router.post('/pins/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const target = routeParam(req.params.owner);
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  const body = (req.body ?? {}) as { pin?: unknown; temp?: unknown };
  const pin = body.pin;
  if (typeof pin !== 'string' || (pin !== '' && (pin.length < 4 || pin.length > 8))) {
    res.status(400).json({ error: 'pin must be 4-8 characters, or "" to clear' });
    return;
  }
  // temp: true assigns a temporary PIN the owner must replace on first login
  await setPin(target, pin, body.temp === true);
  // Deliberately do not log the PIN value in the audit trail
  await appendAudit(actor(res), pin === '' ? 'pin.cleared' : 'pin.set', {
    target,
    temp: body.temp === true,
  });
  res.json({ ok: true });
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
      signed: status.signed,
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
    const body = req.body as { versionId?: unknown; fingerprint?: unknown };
    const versionId = typeof body.versionId === 'string' ? body.versionId : '';
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
    if (!versionId || !fingerprint) {
      throw new HttpError(400, 'versionId and fingerprint are required');
    }

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
    });
    await insertRulebookSignature(signature);
    await appendAudit(actor(res), 'rulebook-sign', { versionId, revision: signature.revision });

    const after = signatureStatus(OWNERS, [...signatures, signature], versionId);
    res.json({
      signature,
      signed: after.signed,
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

    const draftRow = await getRulebookDraft(RULEBOOK_SEASON);
    if (!draftRow) {
      throw new HttpError(409, 'There is no draft to publish');
    }
    const book = draftRow.book as Rulebook;

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
        isCommissioner: isCommish,
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

    const shape = checkProposalShape(leagueDataset, input);
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
      const check = checkProposalAgainstState(currentDataset(draft), draft, input);
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
      draft.pickTransfers = [
        ...transfersOf(draft),
        ...transfersForProposal(input, now, proposal.id),
      ];
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
      outcomes.push({ proposal: accepted });
    });

    if (sendOutcome(res, outcomes[0])) return;
    const proposal = outcomes[0]?.proposal;
    if (!proposal) throw new HttpError(500, 'The trade could not be saved');
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
    });
    res.json({
      proposal,
      ...redactState(result, { owner, isCommissioner: isCommish }),
    });
    notifyTradeAccepted(proposal, appOrigin(req));
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
  res.json(await readAudit(limit));
});

// ─── Error handler ───────────────────────────────────────────────────────────

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
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[league] Unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

export default router;
