import type { Router, RequestHandler } from 'express';
import { readMissedGamesReport, refreshMissedGames } from '../lib/missedGamesService.js';
import { CONFIG_TEAMS, mutateState, appendAudit } from '../lib/leagueStore.js';
export function registerMissedGamesRoutes(router: Router, auth: RequestHandler, commissioner: RequestHandler) {
  router.get('/missed-games', auth, commissioner, async (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await readMissedGamesReport()); } catch (error) { next(error); }
  });
  router.post('/missed-games/refresh', auth, commissioner, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const period = req.body?.week ?? null;
    if (period !== null && (!Number.isSafeInteger(period) || period < 1 || period > 30)) { res.status(400).json({ error: 'Choose a valid week.' }); return; }
    try { res.json(await refreshMissedGames(period)); }
    catch { res.status(502).json({ error: 'Could not verify ESPN missed-games data. Saved results are unchanged. Retry the refresh.' }); }
  });
  router.post('/missed-games/exemption', auth, commissioner, async (req, res, next) => {
    const { week, teamId, reason } = req.body ?? {};
    const owner = res.locals.owner as string;
    if (res.locals.actingBy || res.locals.mustChangePin || !CONFIG_TEAMS.some(t => t.owner === owner && t.isCommissioner)
      || !Number.isSafeInteger(week) || !CONFIG_TEAMS.some(t => t.espnTeamId === teamId)
      || typeof reason !== 'string' || !reason.trim() || reason.length > 500) { res.status(400).json({ error: 'Sign in directly as a commissioner and supply a week, team and reason.' }); return; }
    try {
      await mutateState(state => {
        const ledger = state.missedGames;
        if (!ledger?.weeks[`${state.season}:${week}`]) throw new Error('Refresh this week first.');
        let entry = ledger.exemptions.find(e => e.season === state.season && e.matchupPeriodId === week && e.teamId === teamId);
        if (!entry) { entry = { season: state.season, matchupPeriodId: week, teamId, reason: reason.trim(), approvals: [] }; ledger.exemptions.push(entry); }
        if (entry.reason !== reason.trim()) throw new Error('Approve the same reason as the other commissioner.');
        if (!entry.approvals.includes(owner)) entry.approvals.push(owner);
      });
      await appendAudit(owner, 'scores.missedGamesExemption', { week, teamId, reason: reason.trim() });
      res.json(await readMissedGamesReport());
    } catch (error) { next(error); }
  });
}
