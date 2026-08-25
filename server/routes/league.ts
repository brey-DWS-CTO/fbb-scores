/**
 * League draft-hub API — keepers, live draft picks, locks, PINs, audit log.
 * Mounted at /api/league.
 *
 * Auth: `x-owner` + `x-pin` headers, verified against the pin store.
 * Owner names are case-sensitive exact matches to the league config.
 * Commissioner status comes from src/data/source/league-2027-config.json.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getState,
  mutateState,
  verifyPin,
  getPins,
  setPin,
  appendAudit,
  readAudit,
  isKnownOwner,
  type KeeperSelection,
} from '../lib/leagueStore.js';

const router = Router();

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

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/league/state — poll target, no auth, fast.
 */
router.get('/state', async (_req, res) => {
  res.json(await getState());
});

/**
 * POST /api/league/verify — validate an owner/PIN pair.
 */
router.post('/verify', requireAuth, (_req, res) => {
  res.json({ ok: true, owner: res.locals.owner, isCommissioner: res.locals.isCommissioner });
});

/**
 * PUT /api/league/keepers/:owner — set an owner's keeper selections (max 2).
 * The authed owner must match :owner, or be the commissioner.
 */
router.put('/keepers/:owner', requireAuth, async (req, res) => {
  const target = req.params.owner;
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
  if (selections.length > 2) {
    res.status(400).json({ error: 'A team may keep at most 2 players' });
    return;
  }
  const clean: KeeperSelection[] = [];
  for (const s of selections as Array<Record<string, unknown>>) {
    if (
      !s ||
      typeof s.playerKey !== 'string' || s.playerKey.length === 0 ||
      typeof s.playerName !== 'string' || s.playerName.length === 0
    ) {
      res.status(400).json({ error: 'Each selection needs a playerKey and playerName' });
      return;
    }
    clean.push({ playerKey: s.playerKey, playerName: s.playerName });
  }

  const result = await mutateState((draft) => {
    if (draft.locks.keepersLocked && !isCommissioner) {
      throw new HttpError(423, 'Keepers are locked');
    }
    draft.keepers[target] = clean;
  });
  await appendAudit(authedOwner, 'keepers.set', { target, selections: clean });
  res.json(result);
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
  const isKeeper = body.isKeeper === true;

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
  const timestamp = new Date().toISOString();
  const result = await mutateState((draft) => {
    draft.draft.picks[String(overallPick)] = {
      playerKey,
      playerName,
      isKeeper,
      enteredBy: authedOwner,
      timestamp,
    };
    if (draft.draft.startedAt === null) draft.draft.startedAt = timestamp;
  });
  await appendAudit(authedOwner, 'draft.pick', { overallPick, playerKey, playerName, isKeeper });
  res.json(result);
});

/**
 * DELETE /api/league/draft/pick/:overallPick — clear a pick (commissioner only).
 */
router.delete('/draft/pick/:overallPick', requireAuth, requireCommissioner, async (req, res) => {
  const overallPick = parseInt(req.params.overallPick, 10);
  if (isNaN(overallPick) || overallPick < 1) {
    res.status(400).json({ error: 'Invalid overallPick' });
    return;
  }
  const result = await mutateState((draft) => {
    delete draft.draft.picks[String(overallPick)];
  });
  await appendAudit(res.locals.owner as string, 'draft.pick_cleared', { overallPick });
  res.json(result);
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
  res.json(result);
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
  res.json(result);
});

/**
 * GET /api/league/pins — list every owner's PIN (commissioner only).
 */
router.get('/pins', requireAuth, requireCommissioner, async (_req, res) => {
  res.json(await getPins());
});

/**
 * POST /api/league/pins/:owner — set an owner's PIN (commissioner only).
 * Body: { pin: string } — 4-8 characters.
 */
router.post('/pins/:owner', requireAuth, requireCommissioner, async (req, res) => {
  const target = req.params.owner;
  if (!isKnownOwner(target)) {
    res.status(404).json({ error: `Unknown owner: ${target}` });
    return;
  }
  const pin = (req.body as { pin?: unknown } | undefined)?.pin;
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 8) {
    res.status(400).json({ error: 'pin must be a string of 4-8 characters' });
    return;
  }
  await setPin(target, pin);
  // Deliberately do not log the PIN value in the audit trail
  await appendAudit(res.locals.owner as string, 'pin.set', { target });
  res.json({ ok: true });
});

/**
 * GET /api/league/audit?limit=50 — recent audit rows, newest first (any authed owner).
 */
router.get('/audit', requireAuth, async (req, res) => {
  const parsed = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;
  res.json(await readAudit(limit));
});

// ─── Error handler ───────────────────────────────────────────────────────────

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[league] Unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
});

export default router;
