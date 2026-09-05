/**
 * Sign-in by emailed link.
 *
 * Three routes, all public by necessity: ask for a link, spend a link, drop a
 * session. Everything else in the app authenticates with the session these
 * hand out.
 *
 * Two rules run through the whole file. An address that belongs to nobody gets
 * the same answer as one that does, so this page cannot be used to find out
 * who is in the league. And a token is never written to a log or a response
 * body, only into the email.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { LINK_TTL_MINUTES } from '../../src/lib/league/auth.js';
import {
  consumeLoginToken,
  endSession,
  issueLoginToken,
  purgeExpiredAuth,
  verifySession,
} from '../lib/leagueStore.js';
import { sendLoginLink } from '../lib/mailer.js';

const router = Router();

/**
 * Where the sign-in link should land.
 *
 * PUBLIC_APP_URL wins because a link has to work in a mail client, which has
 * no idea what host made the request. The request origin is the local
 * fallback.
 */
function appOrigin(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const origin = req.header('origin');
  if (origin) return origin.replace(/\/+$/, '');
  const host = req.header('host') ?? 'localhost:5173';
  const scheme = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/** POST /api/auth/request-link { email } */
router.post('/request-link', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  const now = new Date();
  try {
    await purgeExpiredAuth(now);
    const issued = await issueLoginToken(email, now);
    if (!issued.ok) {
      res.status(429).json({
        error: issued.reason ?? 'Try again in a few minutes',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
      return;
    }
    // No token means the address belongs to nobody. Answer as if it did.
    if (!issued.token || !issued.email) {
      res.json({ sent: true });
      return;
    }
    const link = `${appOrigin(req)}/sign-in/${encodeURIComponent(issued.token)}`;
    const sent = await sendLoginLink(issued.email, link, LINK_TTL_MINUTES);
    if (!sent.ok) {
      res.status(502).json({ error: sent.error ?? 'Could not send the email' });
      return;
    }
    // Deployed with no mail key, the link only reaches a log nobody reads. Say
    // so rather than telling someone to check an inbox that will stay empty.
    if (sent.logged === true && process.env.VERCEL) {
      res.status(503).json({ error: 'Sign-in by email is not switched on yet. Use a PIN for now.' });
      return;
    }
    res.json({ sent: true, logged: sent.logged === true });
  } catch (err) {
    console.error('[auth] request-link failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Could not send the email' });
  }
});

/** POST /api/auth/consume { token } */
router.post('/consume', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  try {
    const result = await consumeLoginToken(token, new Date());
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'That sign-in link is not valid' });
      return;
    }
    res.json({
      session: result.session,
      owner: result.owner,
      email: result.email,
      isCommissioner: result.isCommissioner === true,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    console.error('[auth] consume failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Could not sign you in' });
  }
});

/** GET /api/auth/me — who the current session belongs to. */
router.get('/me', async (req: Request, res: Response) => {
  const session = req.header('x-session') ?? '';
  try {
    const check = await verifySession(session, new Date());
    if (!check.ok) {
      res.status(401).json({ error: 'Your sign-in has expired' });
      return;
    }
    res.json({
      owner: check.owner,
      email: check.email,
      isCommissioner: check.isCommissioner === true,
    });
  } catch (err) {
    console.error('[auth] me failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Could not read your sign-in' });
  }
});

/** POST /api/auth/sign-out — drops this device's session on the server too. */
router.post('/sign-out', async (req: Request, res: Response) => {
  const session = req.header('x-session') ?? '';
  try {
    await endSession(session);
    res.status(204).end();
  } catch (err) {
    console.error('[auth] sign-out failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Could not sign you out' });
  }
});

export default router;
