/**
 * The clocks. Mounted at /api/notify.
 *
 * Two jobs on two schedules (see vercel.json), both behind
 * `Authorization: Bearer $CRON_SECRET`:
 *  - GET /api/notify/tick, every hour: send whatever reminders are due.
 *  - GET /api/notify/team-names, Mondays: refresh the ESPN team names.
 *
 * They are split because the database sleeps when nobody asks it anything,
 * and every hourly question woke it. The hourly run now ends without a query
 * unless a reminder window is open, and names change rarely enough that once
 * a week is plenty. Everything the reminder run decides lives in
 * src/lib/league/notifications.ts; this route only guards the door and reports
 * what went out.
 */
import { Router, type Request, type Response } from 'express';
import { runDueReminders } from '../lib/notifier.js';
import { refreshTeamNamesNow } from '../lib/teamNameService.js';
import { appOrigin } from './auth.js';

const router = Router();

/** Loopback only. A request that came through a proxy is not local. */
function fromLocalhost(req: Request): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Who may run the clock.
 *
 * With CRON_SECRET set, the bearer token has to match it and nothing else gets
 * in. With no secret set, only a request from this machine is allowed, so a
 * deployment that forgot the secret can never be poked into mailing the whole
 * league.
 */
function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.header('authorization') === `Bearer ${secret}`;
  return fromLocalhost(req);
}

/** GET /api/notify/tick: send whatever the clock says is due. */
router.get('/tick', async (req: Request, res: Response) => {
  if (!allowed(req)) {
    res.status(401).json({ error: 'Not for you' });
    return;
  }
  try {
    const run = await runDueReminders(new Date(), appOrigin(req));
    // Counts only. Who was mailed is not something a log needs to carry.
    console.log(`[notify] tick: ${run.sent} of ${run.due} due reminders sent`);
    res.json(run);
  } catch (err) {
    console.error('[notify] tick failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'The reminder run failed' });
  }
});

/**
 * GET /api/notify/team-names: pick up new ESPN team names.
 *
 * Best effort. If ESPN is down the last known names stay, and next week's run
 * tries again.
 */
router.get('/team-names', async (req: Request, res: Response) => {
  if (!allowed(req)) {
    res.status(401).json({ error: 'Not for you' });
    return;
  }
  try {
    const refreshed = await refreshTeamNamesNow();
    res.json({ changed: refreshed.changed });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[teams] weekly refresh failed:', reason);
    res.json({ changed: 0, error: reason });
  }
});

export default router;
