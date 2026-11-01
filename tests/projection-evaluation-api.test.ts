import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import { registerProjectionEvaluationRoutes } from '../server/routes/projectionEvaluation.ts';
import { projectionEvaluationReport } from '../src/lib/league/projectionEvaluation.ts';
test('evaluation report requires commissioner auth and returns aggregates without raw captures', async () => {
  let reads = 0;
  const app = express(), router = express.Router();
  const auth: RequestHandler = (req, res, next) => { if (!req.header('x-role')) { res.sendStatus(401); return; } next(); };
  const commissioner: RequestHandler = (req, res, next) => { if (req.header('x-role') !== 'commish') { res.sendStatus(403); return; } next(); };
  registerProjectionEvaluationRoutes(router, auth, commissioner, async () => { reads++; return projectionEvaluationReport([]); });
  app.use('/api/league', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/league/projection-evaluation`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-role': 'owner' } })).status, 403); assert.equal(reads, 0);
    const response = await fetch(url, { headers: { 'x-role': 'commish' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); assert.equal(body.captured, 0); assert.equal(body.matchupOnly.baseline, null); assert.equal(body.input, undefined);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
