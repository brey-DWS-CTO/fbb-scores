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
import espnRoutes from './routes/espn.js';
import leagueRoutes from './routes/league.js';

const app = express();

// Allow all origins in development
app.use(cors());
// The rule book draft PUT sends the whole document, already ~87 KB and growing
// as clauses are added. Express defaults to 100 KB, which would start rejecting
// saves after a short editing session.
app.use(express.json({ limit: '4mb' }));

// Mount API routes
app.use('/api', espnRoutes);
app.use('/api/league', leagueRoutes);

export default app;
