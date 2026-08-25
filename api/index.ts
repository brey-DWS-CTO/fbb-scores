/**
 * Vercel serverless entrypoint. All /api/* requests are rewritten here
 * (see vercel.json); the Vercel Node runtime accepts an Express app as the
 * default-export handler and passes through the original request URL, so the
 * app's /api-prefixed routes match unchanged.
 */
import app from '../server/app.js';

export default app;
