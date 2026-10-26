import type { Router, RequestHandler } from 'express';
import { CONFIG_TEAMS, OWNERS, getState, mutateState, isKnownOwner } from '../lib/leagueStore.js';
import { EspnReadOnlyLineupProvider, lineupReadsEnabled } from '../lib/lineup/espnReadOnly.js';
import { emptyLineupState, LineupService, type LineupRepository } from '../lib/lineup/service.js';
import { myTeamReadView, LineupReadRevokedError } from '../lib/lineup/readView.js';
import type { MoveRequest } from '../../src/lib/league/lineup.js';

const repo: LineupRepository = {
  async read() { return (await getState()).state.lineupManagement ?? emptyLineupState(); },
  async mutate(fn) { await mutateState(state => { state.lineupManagement ??= emptyLineupState(); fn(state.lineupManagement); }); },
};
// Deliberately no environment variable can turn on an unverified write adapter.
const provider = new EspnReadOnlyLineupProvider();
function cutoff(): number {
  const minutes = Number(process.env.LINEUP_SAFETY_CUTOFF_MINUTES ?? 10);
  return Number.isFinite(minutes) && minutes >= 10 ? minutes : 10;
}
const service = () => new LineupService(repo, provider, cutoff());
const safe: (fn: RequestHandler) => RequestHandler = fn => async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await fn(req, res, next); }
  catch { if (!res.headersSent) res.status(409).json({ error: 'Lineup request could not be completed. Refresh and check access or operation status.' }); }
};
const directIdentity: RequestHandler = (_req, res, next) => {
  if (res.locals.actingBy || res.locals.mustChangePin) {
    res.status(403).json({ error: 'Sign in directly with your own permanent account to manage lineups.' }); return;
  }
  next();
};

export function registerLineupRoutes(router: Router, auth: RequestHandler, commissioner: RequestHandler): void {
  router.get('/my-team', auth, directIdentity, safe(async (_req, res) => {
    const owner = res.locals.owner as string;
    const configured = CONFIG_TEAMS.find(team => team.owner === owner);
    const leagueId = process.env.ESPN_LEAGUE_ID;
    const binding = configured && leagueId ? { leagueId, teamId: configured.espnTeamId } : null;
    try {
      const view = await myTeamReadView(repo, provider, owner, binding, lineupReadsEnabled());
      res.json({ ...view, safetyCutoffMinutes: cutoff() });
    } catch (error) {
      if (error instanceof LineupReadRevokedError) { res.status(403).json({ error: error.message }); return; }
      throw error;
    }
  }));
  router.post('/my-team/moves', auth, directIdentity, safe(async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || Object.keys(body).some(key => !['id', 'playerId', 'destinationSlotId', 'revision'].includes(key))
      || typeof body.id !== 'string' || !Number.isSafeInteger(body.playerId) || Number(body.playerId) <= 0
      || typeof body.destinationSlotId !== 'string' || body.destinationSlotId.length > 100
      || typeof body.revision !== 'string' || body.revision.length > 200) {
      res.status(400).json({ error: 'Invalid lineup request. Team and league come from your server-side grant.', notSubmitted: true }); return;
    }
    const request: MoveRequest = { playerId: body.playerId as number, destinationSlotId: body.destinationSlotId, revision: body.revision };
    try {
      const operation = await service().submit(res.locals.owner as string, body.id, request);
      res.json({ operation, snapshot: operation.after ?? operation.before ?? null });
    } catch {
      if (provider.executionEnabled) {
        res.status(503).json({ error: 'Could not determine the move outcome. Check its operation status before trying another move.' }); return;
      }
      // The deployed provider cannot execute. This is a definite no-submit,
      // unlike a lost response from any future enabled execution adapter.
      res.status(409).json({ error: 'Live ESPN lineup execution is disabled. No move was submitted.', notSubmitted: true });
    }
  }));
  router.get('/my-team/moves/:id', auth, directIdentity, safe(async (req, res) => {
    const operation = await service().verify(res.locals.owner as string, String(req.params.id));
    res.json({ operation, snapshot: operation.after ?? operation.before ?? null });
  }));
  router.get('/lineup-access', auth, directIdentity, commissioner, safe(async (_req, res) => {
    res.json({ grants: Object.values((await repo.read()).grants), owners: OWNERS });
  }));
  router.put('/lineup-access/:owner', auth, directIdentity, commissioner, safe(async (req, res) => {
    const owner = String(req.params.owner);
    const body = req.body as Record<string, unknown> | null;
    if (!isKnownOwner(owner) || !body || typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: 'Choose a league owner and access state.' }); return;
    }
    if (!body.enabled) {
      await repo.mutate(state => { if (state.grants[owner]) state.grants[owner].enabled = false; });
      res.json({ ok: true }); return;
    }
    // Initial rollout: the authenticated commissioner may enable their own
    // config-mapped team only. No client-provided arbitrary target can escape it.
    const configured = CONFIG_TEAMS.find(team => team.owner === owner);
    const leagueId = process.env.ESPN_LEAGUE_ID;
    if (owner !== res.locals.owner || !configured?.isCommissioner || !leagueId
      || body.leagueId !== leagueId || body.teamId !== configured.espnTeamId) {
      res.status(403).json({ error: 'Initial rollout is your own commissioner team only. League and team must match server configuration.' }); return;
    }
    await repo.mutate(state => { state.grants[owner] = { owner, enabled: true, leagueId, teamId: configured.espnTeamId }; });
    res.json({ ok: true });
  }));
}
