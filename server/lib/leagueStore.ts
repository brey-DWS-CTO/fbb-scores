/**
 * League dynamic-state storage abstraction.
 *
 * Two backends, chosen lazily on first use:
 *  - Neon Postgres (HTTP driver) when DATABASE_URL is set — used on Vercel.
 *    Each query is an independent HTTP request; single-statement upserts,
 *    last-write-wins (fine for a 10-person draft room).
 *  - Local JSON file (.data/league-state.json) when DATABASE_URL is absent —
 *    zero-setup local development.
 *
 * PIN seeding: on first init, if no pins exist, a random 4-digit PIN is
 * generated for each owner listed in src/data/source/league-2027-config.json.
 * Commissioner status always comes from that config file, never from storage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import leagueConfig from '../../src/data/source/league-2027-config.json' with { type: 'json' };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeeperSelection {
  playerKey: string;
  playerName: string;
}

export interface DraftPickState {
  playerKey?: string;
  playerName?: string;
  isKeeper?: boolean;
  enteredBy?: string;
  timestamp?: string;
}

export interface LeagueDynamicState {
  season: number; // 2027
  keepers: Record<string, KeeperSelection[]>; // owner -> up to 2
  draft: {
    picks: Record<string, DraftPickState>; // key = String(overallPick)
    startedAt: string | null;
  };
  locks: { keepersLocked: boolean };
}

export interface AuditRow {
  id: number;
  ts: string;
  owner: string | null;
  action: string;
  detail: unknown;
}

export interface StateResult {
  state: LeagueDynamicState;
  version: number;
  updatedAt: string;
}

export interface MutateResult {
  state: LeagueDynamicState;
  version: number;
}

// ─── League config (static import — bundled on Vercel) ───────────────────────

interface ConfigTeam {
  owner: string;
  isCommissioner?: boolean;
}

const CONFIG_TEAMS = leagueConfig.teams as ConfigTeam[];
export const OWNERS: string[] = CONFIG_TEAMS.map((t) => t.owner);
const COMMISSIONERS = new Set(
  CONFIG_TEAMS.filter((t) => t.isCommissioner === true).map((t) => t.owner),
);
const SEASON: number = (leagueConfig as { season?: number }).season ?? 2027;

/** Case-sensitive exact match against the config's owner names. */
export function isKnownOwner(owner: string): boolean {
  return OWNERS.includes(owner);
}

export function isCommissionerOwner(owner: string): boolean {
  return COMMISSIONERS.has(owner);
}

function defaultState(): LeagueDynamicState {
  return {
    season: SEASON,
    keepers: {},
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
  };
}

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ─── Backend interface ───────────────────────────────────────────────────────

interface StoreBackend {
  getState(): Promise<StateResult>;
  mutateState(
    fn: (draft: LeagueDynamicState) => LeagueDynamicState | void,
  ): Promise<MutateResult>;
  getPin(owner: string): Promise<string | null>;
  getPins(): Promise<Array<{ owner: string; pin: string }>>;
  setPin(owner: string, pin: string): Promise<void>;
  appendAudit(owner: string | null, action: string, detail: unknown): Promise<void>;
  readAudit(limit: number): Promise<AuditRow[]>;
}

// ─── Neon Postgres backend ───────────────────────────────────────────────────

class NeonBackend implements StoreBackend {
  private sql: ReturnType<typeof neon>;
  private initPromise: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init().catch((err) => {
        // Allow a retry on the next request instead of caching the failure forever
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async init(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS league_state (
      id int primary key default 1,
      data jsonb not null,
      version int not null default 0,
      updated_at timestamptz not null default now()
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS pins (
      owner text primary key,
      pin text not null
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS audit (
      id bigserial primary key,
      ts timestamptz not null default now(),
      owner text,
      action text not null,
      detail jsonb
    )`;
    await this.sql`INSERT INTO league_state (id, data, version)
      VALUES (1, ${JSON.stringify(defaultState())}::jsonb, 0)
      ON CONFLICT (id) DO NOTHING`;

    const countRows = (await this.sql`SELECT count(*)::int AS n FROM pins`) as Array<{ n: number }>;
    if ((countRows[0]?.n ?? 0) === 0) {
      for (const owner of OWNERS) {
        await this.sql`INSERT INTO pins (owner, pin)
          VALUES (${owner}, ${randomPin()})
          ON CONFLICT (owner) DO NOTHING`;
      }
      console.log(`[leagueStore] Seeded random PINs for ${OWNERS.length} owners in Neon`);
    }
  }

  async getState(): Promise<StateResult> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data, version, updated_at FROM league_state WHERE id = 1`) as Array<{
      data: LeagueDynamicState;
      version: number;
      updated_at: string | Date;
    }>;
    const row = rows[0];
    if (!row) throw new Error('league_state row missing');
    return {
      state: row.data,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async mutateState(
    fn: (draft: LeagueDynamicState) => LeagueDynamicState | void,
  ): Promise<MutateResult> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data, version FROM league_state WHERE id = 1`) as Array<{
      data: LeagueDynamicState;
      version: number;
    }>;
    const row = rows[0];
    if (!row) throw new Error('league_state row missing');
    const draft = structuredClone(row.data);
    const result = fn(draft);
    const next = result === undefined ? draft : result;
    const updated = (await this.sql`UPDATE league_state
      SET data = ${JSON.stringify(next)}::jsonb, version = version + 1, updated_at = now()
      WHERE id = 1
      RETURNING version`) as Array<{ version: number }>;
    return { state: next, version: updated[0]?.version ?? row.version + 1 };
  }

  async getPin(owner: string): Promise<string | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT pin FROM pins WHERE owner = ${owner}`) as Array<{ pin: string }>;
    return rows[0]?.pin ?? null;
  }

  async getPins(): Promise<Array<{ owner: string; pin: string }>> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT owner, pin FROM pins`) as Array<{ owner: string; pin: string }>;
    return rows.map((r) => ({ owner: r.owner, pin: r.pin }));
  }

  async setPin(owner: string, pin: string): Promise<void> {
    await this.ensureInit();
    await this.sql`INSERT INTO pins (owner, pin) VALUES (${owner}, ${pin})
      ON CONFLICT (owner) DO UPDATE SET pin = EXCLUDED.pin`;
  }

  async appendAudit(owner: string | null, action: string, detail: unknown): Promise<void> {
    await this.ensureInit();
    await this.sql`INSERT INTO audit (owner, action, detail)
      VALUES (${owner}, ${action}, ${JSON.stringify(detail ?? null)}::jsonb)`;
  }

  async readAudit(limit: number): Promise<AuditRow[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, ts, owner, action, detail
      FROM audit ORDER BY id DESC LIMIT ${limit}`) as Array<{
      id: number | string;
      ts: string | Date;
      owner: string | null;
      action: string;
      detail: unknown;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      ts: new Date(r.ts).toISOString(),
      owner: r.owner,
      action: r.action,
      detail: r.detail,
    }));
  }
}

// ─── Local JSON file backend ─────────────────────────────────────────────────

interface FileDoc {
  state: LeagueDynamicState;
  version: number;
  updatedAt: string;
  pins: Record<string, string>;
  audit: AuditRow[];
}

const MAX_FILE_AUDIT_ROWS = 1000;

class FileBackend implements StoreBackend {
  private readonly filePath: string;
  private initPromise: Promise<void> | null = null;

  constructor() {
    const here = path.dirname(fileURLToPath(import.meta.url)); // server/lib
    this.filePath = path.resolve(here, '..', '..', '.data', 'league-state.json');
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const doc = this.readDoc();
    if (Object.keys(doc.pins).length === 0) {
      for (const owner of OWNERS) doc.pins[owner] = randomPin();
      console.log(
        `[leagueStore] Seeded random PINs for ${OWNERS.length} owners in ${this.filePath}`,
      );
    }
    this.writeDoc(doc);
  }

  private readDoc(): FileDoc {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const doc = JSON.parse(raw) as Partial<FileDoc>;
      return {
        state: doc.state ?? defaultState(),
        version: typeof doc.version === 'number' ? doc.version : 0,
        updatedAt: doc.updatedAt ?? new Date().toISOString(),
        pins: doc.pins ?? {},
        audit: Array.isArray(doc.audit) ? doc.audit : [],
      };
    } catch {
      return {
        state: defaultState(),
        version: 0,
        updatedAt: new Date().toISOString(),
        pins: {},
        audit: [],
      };
    }
  }

  private writeDoc(doc: FileDoc): void {
    fs.writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }

  async getState(): Promise<StateResult> {
    await this.ensureInit();
    const doc = this.readDoc();
    return { state: doc.state, version: doc.version, updatedAt: doc.updatedAt };
  }

  async mutateState(
    fn: (draft: LeagueDynamicState) => LeagueDynamicState | void,
  ): Promise<MutateResult> {
    await this.ensureInit();
    const doc = this.readDoc();
    const draft = structuredClone(doc.state);
    const result = fn(draft);
    doc.state = result === undefined ? draft : result;
    doc.version += 1;
    doc.updatedAt = new Date().toISOString();
    this.writeDoc(doc);
    return { state: doc.state, version: doc.version };
  }

  async getPin(owner: string): Promise<string | null> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.pins[owner] ?? null;
  }

  async getPins(): Promise<Array<{ owner: string; pin: string }>> {
    await this.ensureInit();
    const doc = this.readDoc();
    return Object.entries(doc.pins).map(([owner, pin]) => ({ owner, pin }));
  }

  async setPin(owner: string, pin: string): Promise<void> {
    await this.ensureInit();
    const doc = this.readDoc();
    doc.pins[owner] = pin;
    this.writeDoc(doc);
  }

  async appendAudit(owner: string | null, action: string, detail: unknown): Promise<void> {
    await this.ensureInit();
    const doc = this.readDoc();
    const lastId = doc.audit.length > 0 ? doc.audit[doc.audit.length - 1].id : 0;
    doc.audit.push({
      id: lastId + 1,
      ts: new Date().toISOString(),
      owner,
      action,
      detail: detail ?? null,
    });
    if (doc.audit.length > MAX_FILE_AUDIT_ROWS) {
      doc.audit = doc.audit.slice(-MAX_FILE_AUDIT_ROWS);
    }
    this.writeDoc(doc);
  }

  async readAudit(limit: number): Promise<AuditRow[]> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.audit.slice(-limit).reverse(); // newest first
  }
}

// ─── Backend selection (lazy singleton) ──────────────────────────────────────

let backend: StoreBackend | null = null;

function getBackend(): StoreBackend {
  if (!backend) {
    const url = process.env.DATABASE_URL;
    if (url) {
      console.log('[leagueStore] Using Neon Postgres backend');
      backend = new NeonBackend(url);
    } else {
      console.log(
        '[leagueStore] DATABASE_URL not set — using local JSON file backend (.data/league-state.json)',
      );
      backend = new FileBackend();
    }
  }
  return backend;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getState(): Promise<StateResult> {
  return getBackend().getState();
}

export async function mutateState(
  fn: (draft: LeagueDynamicState) => LeagueDynamicState | void,
): Promise<MutateResult> {
  return getBackend().mutateState(fn);
}

/**
 * Check an owner/PIN pair. Owner names are case-sensitive exact matches to the
 * config. Commissioner status is derived from the config JSON, not storage.
 */
export async function verifyPin(
  owner: string,
  pin: string,
): Promise<{ ok: boolean; isCommissioner: boolean }> {
  if (typeof owner !== 'string' || typeof pin !== 'string' || !isKnownOwner(owner)) {
    return { ok: false, isCommissioner: false };
  }
  const stored = await getBackend().getPin(owner);
  const ok = stored !== null && stored === pin;
  return { ok, isCommissioner: ok && isCommissionerOwner(owner) };
}

/** All pins, ordered as the owners appear in the league config. */
export async function getPins(): Promise<Array<{ owner: string; pin: string }>> {
  const rows = await getBackend().getPins();
  const order = new Map(OWNERS.map((o, i) => [o, i]));
  return rows.sort(
    (a, b) => (order.get(a.owner) ?? Infinity) - (order.get(b.owner) ?? Infinity),
  );
}

export async function setPin(owner: string, pin: string): Promise<void> {
  return getBackend().setPin(owner, pin);
}

/** Append an audit row. Never throws — audit failures must not fail mutations. */
export async function appendAudit(
  owner: string | null,
  action: string,
  detail: unknown,
): Promise<void> {
  try {
    await getBackend().appendAudit(owner, action, detail);
  } catch (err) {
    console.error('[leagueStore] Failed to append audit row:', err instanceof Error ? err.message : err);
  }
}

/** Recent audit rows, newest first. */
export async function readAudit(limit = 50): Promise<AuditRow[]> {
  return getBackend().readAudit(limit);
}
