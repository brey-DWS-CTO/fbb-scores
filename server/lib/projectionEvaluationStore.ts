import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationRecord } from '../../src/lib/league/projectionEvaluation.js';
export interface EvaluationStore { append(records: readonly EvaluationRecord[]): Promise<void>; read(season: number, since?: string, includeEnvironments?: boolean): Promise<EvaluationRecord[]> }
/** Forecasts and final outcomes are insert-only; retries cannot replace a pregame prediction. */
export function fileEvaluationStore(root: string): EvaluationStore {
  return {
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
      return rows.filter(row => (includeEnvironments || row.kind !== 'environment') && (!since || Date.parse(row.capturedAt) >= Date.parse(since)));
    },
  };
}
function neonEvaluationStore(url: string): EvaluationStore {
  const sql = neon(url);
  let initialized: Promise<unknown> | null = null;
  const init = () => initialized ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS projection_evaluation_records (
      id text PRIMARY KEY, season integer NOT NULL, kind text NOT NULL, captured_at timestamptz NOT NULL, data jsonb NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS projection_evaluation_season_capture ON projection_evaluation_records (season, captured_at)`;
  })().catch(error => { initialized = null; throw error; });
  return {
    async append(records) {
      if (!records.length) return;
      await init();
      await sql`INSERT INTO projection_evaluation_records (id, season, kind, captured_at, data)
        SELECT item->>'id', (item->>'season')::integer, item->>'kind', (item->>'capturedAt')::timestamptz, item
        FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb) item ON CONFLICT (id) DO NOTHING`;
    },
    async read(season, since, includeEnvironments = true) {
      await init();
      const rows = since ? await sql`SELECT data FROM projection_evaluation_records WHERE season = ${season} AND captured_at >= ${since}::timestamptz AND (${includeEnvironments} OR kind <> 'environment')`
        : await sql`SELECT data FROM projection_evaluation_records WHERE season = ${season} AND (${includeEnvironments} OR kind <> 'environment')`;
      return rows.map(row => row.data as EvaluationRecord);
    },
  };
}
let store: EvaluationStore | null = null;
export function projectionEvaluationStore(): EvaluationStore {
  if (!store) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.VERCEL) throw new Error('Durable evaluation storage is unavailable');
    store = url ? neonEvaluationStore(url) : fileEvaluationStore(path.resolve('.data/projection-evaluation'));
  }
  return store;
}
