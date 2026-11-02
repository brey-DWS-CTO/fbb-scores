import { projectionEvaluationReport, type ProjectionEvaluationReport } from '../../src/lib/league/projectionEvaluation.js';
/** Only accepts a summary reader: serving a page cannot rescan archives or recompute the experiment. */
export function createProjectionReportReader(season: () => Promise<number>, summary: (season: number) => Promise<ProjectionEvaluationReport | null>, clock = Date.now) {
  let cached: { expires: number; read: Promise<ProjectionEvaluationReport> } | null = null;
  const read = () => {
    if (cached && cached.expires > clock()) return cached.read;
    const promise = (async () => await summary(await season()) ?? projectionEvaluationReport([], clock()))()
      .catch(error => { cached = null; throw error; });
    cached = { expires: clock() + 60000, read: promise };
    return promise;
  };
  return Object.assign(read, { invalidate: () => { cached = null; } });
}
