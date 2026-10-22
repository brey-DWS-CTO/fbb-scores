/**
 * Configured Express app — shared by the local server (server/index.ts) and
 * the Vercel serverless function (api/index.ts).
 *
 * Deliberately contains NO listen() and NO static-file serving:
 *  - locally, server/index.ts adds dist/ static serving + SPA fallback and listens
 *  - on Vercel, static files and the SPA fallback are handled by rewrites in
 *    vercel.json, and the platform invokes the exported app per-request
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import espnRoutes from './routes/espn.js';
import leagueRoutes from './routes/league.js';
import { verifySession } from './lib/leagueStore.js';
import { guestRequestAllowed } from '../src/lib/league/guestAccess.js';
import notifyRoutes from './routes/notify.js';

const app = express();

// Allow all origins in development
app.use(cors());
// The rule book draft PUT sends the whole document, already ~87 KB and growing
// as clauses are added. Express defaults to 100 KB, which would start rejecting
// saves after a short editing session.
app.use(express.json({ limit: '4mb' }));

// Verify guest restrictions before any API handler, including future writes.
app.use('/api', async (req, res, next) => {
  const session = req.header('x-session');
  if (!session || req.path === '/auth/guest/consume') { next(); return; }
  try {
    const check = await verifySession(session, new Date());
    if (!check.ok && !['/league/state', '/auth/sign-out'].includes(req.path)) { res.status(401).json({ error: 'Your sign-in has expired.' }); return; }
    if (check.isGuest && !guestRequestAllowed(req.method, req.path)) {
      res.status(403).json({ error: 'Guest access is read-only.' }); return;
    }
    next();
  } catch (error) { next(error); }
});

// Mount API routes
app.use('/api', espnRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/league', leagueRoutes);
app.use('/api/notify', notifyRoutes);

export default app;
