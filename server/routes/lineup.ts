import type { Router, RequestHandler } from 'express';
import { emptyAutoBenchState } from '../../src/lib/league/autoBench.js';
import { scheduleAutoBench } from '../lib/autoBenchQueue.js';
import { previewAutoBench } from '../lib/autoBenchPreview.js';
import { espnLmConfig } from '../lib/espnLm.js';
import { CONFIG_TEAMS, OWNERS, appendAudit, getState, mutateState, isKnownOwner } from '../lib/leagueStore.js';
import { EspnReadOnlyLineupProvider, lineupReadsEnabled } from '../lib/lineup/espnReadOnly.js';
import { emptyLineupState, LineupService, type LineupRepository } from '../lib/lineup/service.js';
import { myTeamReadView, LineupReadRevokedError, withAutoBenchReadAccess } from '../lib/lineup/readView.js';
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
  router.get('/auto-bench', auth, directIdentity, safe(async (_req, res) => {
    const owner = res.locals.owner as string;
    const state = (await getState()).state.autoBench;
    const config = espnLmConfig();
    const preference = state?.preferences[owner];
    const enabled = Boolean(preference?.enabled && config && preference.leagueId === config.leagueId && preference.season === config.seasonId);
    const latest = Object.values(state?.receipts ?? {}).filter(row => row.owner === owner).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
    res.json({ enabled, available: config !== null, latest: latest ? { owner: latest.owner, teamId: latest.teamId, playerId: latest.playerId, at: latest.at, status: latest.status, note: latest.status === 'processing' ? 'Checking the pickup. Check ESPN if this does not finish.' : latest.note } : null });
  }));
  router.put('/auto-bench', auth, directIdentity, safe(async (req, res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean' || Object.keys(req.body).some(key => key !== 'enabled')) {
      res.status(400).json({ error: 'Choose whether to auto-bench pickups.' }); return;
    }
    const owner = res.locals.owner as string;
    const team = CONFIG_TEAMS.find(team => team.owner === owner);
    const config = espnLmConfig();
    if (req.body.enabled && (!config || !team)) { res.status(503).json({ error: 'ESPN automation is unavailable.' }); return; }
    await mutateState(state => {
      state.autoBench ??= emptyAutoBenchState();
      if (!req.body.enabled) { if (state.autoBench.preferences[owner]) state.autoBench.preferences[owner].enabled = false; return; }
      const old = state.autoBench.preferences[owner];
      if (old?.enabled && old.leagueId === config!.leagueId && old.season === config!.seasonId && old.teamId === team!.espnTeamId) return;
      state.autoBench.preferences[owner] = { enabled: true, enabledAt: new Date().toISOString(), leagueId: config!.leagueId, season: config!.seasonId, teamId: team!.espnTeamId };
    });
    await appendAudit(owner, 'lineup.autoBench.preference', { enabled: req.body.enabled });
    // Scheduling is idempotent with the daily planner. A failed queue publish does
    // not roll back consent; report it so the owner can retry the read-only check.
    let scheduleError: string | undefined;
    if (req.body.enabled) {
      try { await scheduleAutoBench(new Date()); }
      catch { scheduleError = 'Saved your preference, but scheduling failed. Try saving again.'; }
    }
    res.json({ enabled: req.body.enabled, scheduleError });
  }));
  router.post('/auto-bench/preview', auth, directIdentity, safe(async (_req, res) => {
    res.json(await previewAutoBench(res.locals.owner as string));
  }));
  router.get('/my-team', auth, directIdentity, safe(async (_req, res) => {
    const owner = res.locals.owner as string;
    const configured = CONFIG_TEAMS.find(team => team.owner === owner);
    const leagueId = process.env.ESPN_LEAGUE_ID;
    const binding = configured && leagueId ? { leagueId, teamId: configured.espnTeamId } : null;
    try {
      const season = espnLmConfig()?.seasonId ?? Number(process.env.ESPN_SEASON_ID ?? 2027);
      const readRepo: LineupRepository = { ...repo, async read() {
        const saved = (await getState()).state;
        return withAutoBenchReadAccess(saved.lineupManagement ?? emptyLineupState(), saved.autoBench?.preferences[owner], owner, binding, season);
      } };
      const saved = (await getState()).state;
      const autoAccess = withAutoBenchReadAccess(emptyLineupState(), saved.autoBench?.preferences[owner], owner, binding, season).grants[owner]?.enabled === true;
      const readsEnabled = lineupReadsEnabled() || autoAccess;
      const readProvider = new EspnReadOnlyLineupProvider(undefined, undefined, () => readsEnabled);
      const view = await myTeamReadView(readRepo, readProvider, owner, binding, readsEnabled);
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
