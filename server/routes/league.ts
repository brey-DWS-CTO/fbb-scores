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
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import {
  getState,
  mutateState,
  verifyPin,
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
  getRulebookDraft,
  saveRulebookDraft,
  deleteRulebookDraft,
  type KeeperSelection,
  type LeagueDynamicState,
} from '../lib/leagueStore.js';
import seedRulebook from '../../src/data/source/rulebook-2027.json' with { type: 'json' };
import { validateDraft } from '../../src/lib/league/rulebookEdit.js';
import type { Rulebook } from '../../src/lib/league/rulebook.js';
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
  FALLBACK_SCHEDULE,
  makeScheduleSnapshot,
  parseScheduleCandidate,
  prepareScheduleCandidate,
  resolveCurrentSchedule,
} from '../lib/scheduleService.js';

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

function validateKeeperSelections(
  state: LeagueDynamicState,
  target: string,
  selections: KeeperSelection[],
): void {
  const dataset = applyOverrides(leagueDataset, state.overrides);
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

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const owner = req.header('x-owner');
  const pin = req.header('x-pin');
  if (!owner || !pin) {
    res.status(401).json({ error: 'Missing x-owner / x-pin headers' });
    return;
  }
  try {
    const result = await verifyPin(owner, pin);
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

/** Best-effort identity from optional x-owner/x-pin headers (never throws). */
async function optionalViewer(req: Request): Promise<Viewer> {
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
  return {
    draftAt: DRAFT_AT_ISO,
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
  return { ...result, state: { ...result.state, keepers }, meta };
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
  await appendAudit(acceptedBy, 'schedule.accepted', {
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
  await appendAudit(acceptedBy, 'player_pool.accepted', {
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
  await appendAudit(owner, 'pin.changed', { owner });
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
  await appendAudit(authedOwner, 'keepers.set', { target, selections: clean });
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
  await appendAudit(res.locals.owner as string, revealed ? 'keepers.revealed' : 'keepers.hidden', {
    revealed,
  });
  res.json(redactState(result, { owner: res.locals.owner as string, isCommissioner: true }));
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
    const dataset = applyOverrides(draftPoolDataset, draft.overrides);
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
  await appendAudit(authedOwner, 'draft.pick', {
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
  await appendAudit(res.locals.owner as string, 'draft.pick_cleared', { overallPick });
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
    const dataset = applyOverrides(leagueDataset, draft.overrides);
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
  await appendAudit(res.locals.owner as string, 'draft.started', null);
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
    draft.draft.playerPoolSnapshotId = null;
  });
  await appendAudit(res.locals.owner as string, 'draft.reset', null);
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
  await appendAudit(res.locals.owner as string, 'locks.set', { keepersLocked });
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
  await appendAudit(res.locals.owner as string, 'overrides.set', {
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
  await appendAudit(owner, 'pin.claimed', { owner });
  res.json({ ok: true });
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
  await appendAudit(res.locals.owner as string, pin === '' ? 'pin.cleared' : 'pin.set', {
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
    await appendAudit(owner, 'rulebook-draft-save', {
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
    const owner = res.locals.owner as string;
    await deleteRulebookDraft(RULEBOOK_SEASON);
    await appendAudit(owner, 'rulebook-draft-reset', { season: RULEBOOK_SEASON });
    res.json({ book: SEED_RULEBOOK, version: 0, seeded: true });
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
