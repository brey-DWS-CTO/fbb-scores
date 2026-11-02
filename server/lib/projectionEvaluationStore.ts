import { neon } from '@neondatabase/serverless';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, link, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { evaluationPhase } from '../../src/lib/league/projectionComputePolicy.js';
import { EVALUATION_MODEL, type ProjectionEvaluationReport, type EvaluationRecord } from '../../src/lib/league/projectionEvaluation.js';
export interface EvaluationStore { append(records: readonly EvaluationRecord[]): Promise<void>; read(season: number, since?: string, includeEnvironments?: boolean): Promise<EvaluationRecord[]> }
export interface ControlledEvaluationStore extends EvaluationStore {
  claimRun(season: number, date: string): Promise<'capture' | 'settle' | null>;
  saveReport(season: number, report: ProjectionEvaluationReport): Promise<void>;
  readReport(season: number): Promise<ProjectionEvaluationReport | null>;
}
const controlId = (kind: string, season: number) => `${kind}:${EVALUATION_MODEL}:${season}`;
/** Forecasts and final outcomes are insert-only; retries cannot replace a pregame prediction. */
export function fileEvaluationStore(root: string): ControlledEvaluationStore {
  const controlFile = (season: number, id: string) => path.join(root, String(season), 'control-' + createHash('sha256').update(id).digest('hex') + '.json');
  const readControl = async <T>(season: number, id: string): Promise<T | null> => {
    try { return JSON.parse(await readFile(controlFile(season, id), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  const claim = async (season: number, id: string, value: unknown) => {
    await mkdir(path.join(root, String(season)), { recursive: true });
    const target = controlFile(season, id), temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    try { await link(temporary, target); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    finally { await unlink(temporary).catch(() => undefined); }
  };
  return {
    async claimRun(season, date) {
      const trialId = controlId('trial', season);
      await claim(season, trialId, { start: date });
      const trial = await readControl<{ start: string }>(season, trialId);
      const phase = trial && evaluationPhase(trial.start, date);
      return phase && await claim(season, controlId('run:' + date, season), { date, phase }) ? phase : null;
    },
    async saveReport(season, report) {
      await mkdir(path.join(root, String(season)), { recursive: true });
      const file = controlFile(season, controlId('summary', season)), temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(report)); await rename(temporary, file);
    },
    readReport: season => readControl<ProjectionEvaluationReport>(season, controlId('summary', season)),
    async append(records) {
      for (const record of records) {
        const folder = path.join(root, String(record.season)); await mkdir(folder, { recursive: true });
        const file = path.join(folder, createHash('sha256').update(record.id).digest('hex') + '.json');
        try { await writeFile(file, JSON.stringify(record), { flag: 'wx' }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
    },
    async read(season, since, includeEnvironments = true) {
      const folder = path.join(root, String(season));
      let files: string[];
      try { files = await readdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      const rows = await Promise.all(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).map(async file => JSON.parse(await readFile(path.join(folder, file), 'utf8')) as EvaluationRecord));
      return rows.filter(row => row.model === EVALUATION_MODEL && (includeEnvironments || row.kind !== 'environment') && (!since || Date.parse(row.capturedAt) >= Date.parse(since)));
    },
  };
}
function neonEvaluationStore(url: string): ControlledEvaluationStore {
  const sql = neon(url);
  let initialized: Promise<unknown> | null = null;
  const init = () => initialized ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS projection_evaluation_records (
      id text PRIMARY KEY, season integer NOT NULL, kind text NOT NULL, captured_at timestamptz NOT NULL, data jsonb NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS projection_evaluation_control (id text PRIMARY KEY, data jsonb NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS projection_evaluation_season_capture ON projection_evaluation_records (season, captured_at)`;
  })().catch(error => { initialized = null; throw error; });
  return {
    async claimRun(season, date) {
      const trialId = controlId('trial', season);
      let rows: Array<{ data: { start: string } }> = [];
      try { rows = await sql`SELECT data FROM projection_evaluation_control WHERE id = ${trialId}` as typeof rows; initialized ??= Promise.resolve(); }
      catch (error) { if ((error as { code?: string }).code !== '42P01') throw error; await init(); rows = []; }
      if (!rows.length) {
        const inserted = await sql`INSERT INTO projection_evaluation_control (id, data) VALUES (${trialId}, ${JSON.stringify({ start: date })}::jsonb) ON CONFLICT DO NOTHING RETURNING data`;
        rows = (inserted.length ? inserted : await sql`SELECT data FROM projection_evaluation_control WHERE id = ${trialId}`) as typeof rows;
      }
      const phase = evaluationPhase(String(rows[0].data.start), date);
      if (!phase) return null;
      const claimed = await sql`INSERT INTO projection_evaluation_control (id, data) VALUES (${controlId('run:' + date, season)}, ${JSON.stringify({ date, phase })}::jsonb) ON CONFLICT DO NOTHING RETURNING id`;
      return claimed.length ? phase : null;
    },
    async saveReport(season, report) {
      await init();
      await sql`INSERT INTO projection_evaluation_control (id, data) VALUES (${controlId('summary', season)}, ${JSON.stringify(report)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data WHERE projection_evaluation_control.data->>'generatedAt' <= EXCLUDED.data->>'generatedAt'`;
    },
    async readReport(season) {
      // Page reads never initialize schemas or load the raw archive.
      try { const rows = await sql`SELECT data FROM projection_evaluation_control WHERE id = ${controlId('summary', season)}`; return rows[0]?.data as ProjectionEvaluationReport ?? null; }
      catch (error) { if ((error as { code?: string }).code === '42P01') return null; throw error; }
    },
    async append(records) {
      if (!records.length) return;
      await init();
      await sql`INSERT INTO projection_evaluation_records (id, season, kind, captured_at, data)
        SELECT item->>'id', (item->>'season')::integer, item->>'kind', (item->>'capturedAt')::timestamptz, item
        FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb) item ON CONFLICT (id) DO NOTHING`;
    },
    async read(season, since, includeEnvironments = true) {
      await init();
      const rows = since ? await sql`SELECT data FROM projection_evaluation_records WHERE season = ${season} AND data->>'model' = ${EVALUATION_MODEL} AND captured_at >= ${since}::timestamptz AND (${includeEnvironments} OR kind <> 'environment')`
        : await sql`SELECT data FROM projection_evaluation_records WHERE season = ${season} AND data->>'model' = ${EVALUATION_MODEL} AND (${includeEnvironments} OR kind <> 'environment')`;
      return rows.map(row => row.data as EvaluationRecord);
    },
  };
}
let store: ControlledEvaluationStore | null = null;
export function projectionEvaluationStore(): ControlledEvaluationStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) throw new Error('Durable evaluation storage is unavailable');
    store = url ? neonEvaluationStore(url) : fileEvaluationStore(path.resolve('.data/projection-evaluation'));
  }
  return store;
}
