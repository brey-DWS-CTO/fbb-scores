import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In development PORT belongs to Vite: dev-preview harnesses inject it, and
// honouring it here binds the API onto Vite's port, so every /api call fails
// with ECONNREFUSED through the proxy. vite.config proxies to a fixed 3001, so
// that is the only port that works in dev. Production still honours PORT for
// hosts that assign one; API_PORT overrides everywhere.
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(
  process.env.API_PORT || (isProduction ? process.env.PORT || '3001' : '3001'),
  10,
);

// Serve the Vite build whenever one exists (API routes are mounted first).
// http://localhost:3001 is therefore always a no-HMR preview of the last
// `npm run build` — handy for devtools/mobile-emulation testing, where Vite's
// HMR websocket + network throttling causes reload loops.
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for any non-API route
  app.get('{*path}', (_req, res) => {
    res.sendFile('index.html', { root: distPath });
  });
}

app.listen(PORT, () => {
  console.log(`[server] Fantasy Basketball API running on port ${PORT}`);
});
