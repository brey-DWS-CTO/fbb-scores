import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// API_PORT wins over PORT so dev-preview harnesses that inject PORT (for Vite)
// don't collide the API server onto Vite's port.
const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10);

// In production, serve the Vite build
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for any non-API route
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[server] Fantasy Basketball API running on port ${PORT}`);
});
