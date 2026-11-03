import type { Router, RequestHandler } from 'express';
import { readProjectionEvaluation } from '../lib/projectionEvaluationService.js';
export function registerProjectionEvaluationRoutes(router: Router, auth: RequestHandler, commissioner: RequestHandler, read = readProjectionEvaluation) {
  router.get('/projection-evaluation', auth, commissioner, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await read()); } catch { res.status(503).json({ error: 'Evaluation report is unavailable.' }); }
  });
}
