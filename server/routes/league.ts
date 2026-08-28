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
  readAudit,
  isKnownOwner,
  DRAFT_AT_ISO,
  type KeeperSelection,
  type LeagueDynamicState,
} from '../lib/leagueStore.js';

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

  const selections = (req.body as { selections?: unknown } | undefined)?.selections;
  if (!Array.isArray(selections)) {
    res.status(400).json({ error: 'Body must include a selections array' });
    return;
  }
  if (selections.length > leagueDataset.maxKeepersPerTeam) {
    res.status(400).json({ error: `A team may keep at most ${leagueDataset.maxKeepersPerTeam} players` });
    return;
  }
  const clean: KeeperSelection[] = [];
  const seen = new Set<string>();
  for (const s of selections as Array<Record<string, unknown>>) {
    if (
      !s ||
      typeof s.playerKey !== 'string' || s.playerKey.length === 0 ||
      typeof s.playerName !== 'string' || s.playerName.length === 0
    ) {
      res.status(400).json({ error: 'Each selection needs a playerKey and playerName' });
      return;
    }
    if (seen.has(s.playerKey)) {
      res.status(400).json({ error: 'A player can only be selected once' });
      return;
    }
    const player = leagueDataset.players.find((candidate) => candidate.key === s.playerKey);
    if (!player) {
      res.status(400).json({ error: `Unknown player: ${s.playerKey}` });
      return;
    }
    seen.add(s.playerKey);
    clean.push({ playerKey: player.key, playerName: player.name });
  }

  const result = await mutateState((draft) => {
    if (draft.locks.keepersLocked && !isCommissioner) {
      throw new HttpError(423, 'Keepers are locked');
    }
    const dataset = applyOverrides(leagueDataset, draft.overrides);
    const validation = resolveTeamKeepers(dataset, target, clean);
    if (!validation.capOk) {
      throw new HttpError(
        400,
        `Keeper cap exceeded: ${validation.capUsed.toFixed(1)} / ${validation.capLimit.toFixed(1)} FPPG`,
      );
    }
    if (!validation.valid) {
      throw new HttpError(400, validation.errors[0] ?? 'Invalid keeper selection');
    }
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
  const playerName = body.playerName;

  if (typeof overallPick !== 'number' || !Number.isInteger(overallPick) || overallPick < 1) {
    res.status(400).json({ error: 'overallPick must be a positive integer' });
    return;
  }
  if (
    typeof playerKey !== 'string' || playerKey.length === 0 ||
    typeof playerName !== 'string' || playerName.length === 0
  ) {
    res.status(400).json({ error: 'playerKey and playerName are required' });
    return;
  }

  const authedOwner = res.locals.owner as string;
  const isCommissioner = res.locals.isCommissioner as boolean;
  const player = leagueDataset.players.find((candidate) => candidate.key === playerKey);
  if (!player) {
    res.status(400).json({ error: `Unknown player: ${playerKey}` });
    return;
  }
  const timestamp = new Date().toISOString();
  const result = await mutateState((draft) => {
    if (draft.draft.startedAt === null) {
      throw new HttpError(409, "The draft hasn't started yet — the commissioner has to hit START DRAFT.");
    }
    const dataset = applyOverrides(leagueDataset, draft.overrides);
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
      isKeeper: false,
      enteredBy: authedOwner,
      timestamp,
    };
  });
  await appendAudit(authedOwner, 'draft.pick', {
    overallPick,
    playerKey: player.key,
    playerName: player.name,
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
    if (draft.draft.startedAt === null) draft.draft.startedAt = new Date().toISOString();
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
router.get('/audit', requireAuth, requireCommissioner, async (req, res) => {
  const parsed = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
  res.json(await readAudit(limit));
});

// ─── Error handler ───────────────────────────────────────────────────────────

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[league] Unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

export default router;
