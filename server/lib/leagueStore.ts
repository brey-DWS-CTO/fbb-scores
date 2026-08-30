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
 * PINs: seeded UNCLAIMED (empty string) for each owner listed in
 * src/data/source/league-2027-config.json — each owner sets their own PIN on
 * first sign-in (claimPin). Commissioner status always comes from that config
 * file, never from storage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import leagueConfig from '../../src/data/source/league-2027-config.json' with { type: 'json' };
import type { PlayerPoolSnapshot } from '../../src/lib/league/playerPool.js';
import type { StoredScheduleSnapshot } from '../../src/lib/league/schedule.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeeperSelection {
  playerKey: string;
  playerName: string;
}

export type KeeperScenario = Record<string, KeeperSelection[]>;

export interface DraftPickState {
  playerKey?: string;
  playerName?: string;
  proTeam?: string;
  positions?: string[];
  isKeeper?: boolean;
  enteredBy?: string;
  timestamp?: string;
}

export interface LeagueOverrides {
  /** Commissioner-set salary cap; null/absent = computed cap (R3 max + R3 min). */
  cap?: number | null;
  /** Commissioner per-player keeper-round tweaks: playerKey -> round 1-10. */
  playerRounds?: Record<string, number>;
}

export interface LeagueDynamicState {
  season: number; // 2027
  keepers: Record<string, KeeperSelection[]>; // owner -> up to 2
  /** Commissioner-controlled public visibility. Missing in old rows means hidden. */
  keepersRevealed?: boolean;
  draft: {
    picks: Record<string, DraftPickState>; // key = String(overallPick)
    startedAt: string | null;
    playerPoolSnapshotId?: string | null;
  };
  playerPool?: {
    activeSnapshotId: string | null;
    acceptedAt?: string;
    acceptedBy?: string;
  };
  schedule?: {
    activeSnapshotId: string | null;
    acceptedAt?: string;
    acceptedBy?: string;
  };
  locks: { keepersLocked: boolean };
  overrides?: LeagueOverrides;
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

export class PlayerPoolAcceptError extends Error {
  reason: 'draft-started' | 'stale-base' | 'snapshot-conflict';

  constructor(reason: PlayerPoolAcceptError['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
}

export class ScheduleAcceptError extends Error {
  reason: 'draft-started' | 'stale-base' | 'snapshot-conflict';

  constructor(reason: ScheduleAcceptError['reason'], message: string) {
    super(message);
    this.reason = reason;
  }
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

/** Draft day — keepers stay secret (non-commissioner) until this moment. */
export const DRAFT_AT_ISO: string =
  (leagueConfig as { draftAt?: string }).draftAt ?? '2026-10-18T14:00:00-07:00';

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
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
  };
}

/** Unclaimed PINs are stored as the empty string. */
const UNCLAIMED = '';
/** Commissioner-assigned temporary PINs are stored prefixed; signing in with
 * one succeeds but flags mustChangePin so the client forces a new PIN. */
const TEMP_PREFIX = 'T:';

// ─── Backend interface ───────────────────────────────────────────────────────

interface StoreBackend {
  getState(): Promise<StateResult>;
  mutateState(fn: (draft: LeagueDynamicState) => void): Promise<MutateResult>;
  getKeeperScenario(season: number, viewer: string): Promise<KeeperScenario>;
  setKeeperScenarioTarget(
    season: number,
    viewer: string,
    target: string,
    selections: KeeperSelection[],
  ): Promise<KeeperScenario>;
  clearKeeperScenario(season: number, viewer: string): Promise<void>;
  clearKeeperScenariosForSeason(season: number): Promise<void>;
  getPin(owner: string): Promise<string | null>;
  getPins(): Promise<Array<{ owner: string; pin: string }>>;
  setPin(owner: string, pin: string): Promise<void>;
  appendAudit(owner: string | null, action: string, detail: unknown): Promise<void>;
  readAudit(limit: number): Promise<AuditRow[]>;
  getPlayerPoolSnapshot(id: string): Promise<PlayerPoolSnapshot | null>;
  acceptPlayerPoolSnapshot(
    snapshot: PlayerPoolSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult>;
  getScheduleSnapshot(id: string): Promise<StoredScheduleSnapshot | null>;
  acceptScheduleSnapshot(
    snapshot: StoredScheduleSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult>;
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
    await this.sql`CREATE TABLE IF NOT EXISTS player_pool_snapshots (
      id text primary key,
      season int not null,
      source_season int not null,
      source text not null,
      fetched_at timestamptz not null,
      created_at timestamptz not null,
      created_by text not null,
      base_snapshot_id text,
      fingerprint text not null unique,
      players jsonb not null
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS keeper_scenarios (
      season int not null,
      viewer text not null,
      target text not null,
      selections jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (season, viewer, target)
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS schedule_snapshots (
      id text primary key,
      season int not null,
      fingerprint text not null unique,
      data jsonb not null,
      created_at timestamptz not null,
      created_by text not null
    )`;
    await this.sql`INSERT INTO league_state (id, data, version)
      VALUES (1, ${JSON.stringify(defaultState())}::jsonb, 0)
      ON CONFLICT (id) DO NOTHING`;

    for (const owner of OWNERS) {
      await this.sql`INSERT INTO pins (owner, pin)
        VALUES (${owner}, ${UNCLAIMED})
        ON CONFLICT (owner) DO NOTHING`;
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
    fn: (draft: LeagueDynamicState) => void,
  ): Promise<MutateResult> {
    await this.ensureInit();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = (await this.sql`SELECT data, version FROM league_state WHERE id = 1`) as Array<{
        data: LeagueDynamicState;
        version: number;
      }>;
      const row = rows[0];
      if (!row) throw new Error('league_state row missing');
      const draft = structuredClone(row.data);
      fn(draft);
      const updated = (await this.sql`UPDATE league_state
        SET data = ${JSON.stringify(draft)}::jsonb, version = version + 1, updated_at = now()
        WHERE id = 1 AND version = ${row.version}
        RETURNING version`) as Array<{ version: number }>;
      if (updated[0]) return { state: draft, version: updated[0].version };
    }
    throw new Error('League state changed too often; retry the request');
  }

  async getKeeperScenario(season: number, viewer: string): Promise<KeeperScenario> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT target, selections
      FROM keeper_scenarios
      WHERE season = ${season} AND viewer = ${viewer}`) as Array<{
      target: string;
      selections: KeeperSelection[];
    }>;
    return Object.fromEntries(
      rows
        .filter((row) => Array.isArray(row.selections) && row.selections.length > 0)
        .map((row) => [row.target, row.selections]),
    );
  }

  async setKeeperScenarioTarget(
    season: number,
    viewer: string,
    target: string,
    selections: KeeperSelection[],
  ): Promise<KeeperScenario> {
    await this.ensureInit();
    if (selections.length === 0) {
      await this.sql`DELETE FROM keeper_scenarios
        WHERE season = ${season} AND viewer = ${viewer} AND target = ${target}`;
    } else {
      await this.sql`INSERT INTO keeper_scenarios (season, viewer, target, selections, updated_at)
        VALUES (${season}, ${viewer}, ${target}, ${JSON.stringify(selections)}::jsonb, now())
        ON CONFLICT (season, viewer, target) DO UPDATE
        SET selections = EXCLUDED.selections, updated_at = now()`;
    }
    return this.getKeeperScenario(season, viewer);
  }

  async clearKeeperScenario(season: number, viewer: string): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM keeper_scenarios
      WHERE season = ${season} AND viewer = ${viewer}`;
  }

  async clearKeeperScenariosForSeason(season: number): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM keeper_scenarios WHERE season = ${season}`;
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

  async getPlayerPoolSnapshot(id: string): Promise<PlayerPoolSnapshot | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, source_season, source, fetched_at,
      created_at, created_by, base_snapshot_id, fingerprint, players
      FROM player_pool_snapshots WHERE id = ${id}`) as Array<{
      id: string;
      season: number;
      source_season: number;
      source: PlayerPoolSnapshot['source'];
      fetched_at: string | Date;
      created_at: string | Date;
      created_by: string;
      base_snapshot_id: string | null;
      fingerprint: string;
      players: PlayerPoolSnapshot['players'];
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      season: row.season,
      sourceSeason: row.source_season,
      source: row.source,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      createdBy: row.created_by,
      baseSnapshotId: row.base_snapshot_id,
      fingerprint: row.fingerprint,
      players: row.players,
    };
  }

  async acceptPlayerPoolSnapshot(
    snapshot: PlayerPoolSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult> {
    await this.ensureInit();
    const pointer = { activeSnapshotId: snapshot.id, acceptedAt, acceptedBy };
    const rows = (await this.sql`WITH eligible AS (
        SELECT id FROM league_state
        WHERE id = 1
          AND (data #>> '{draft,startedAt}') IS NULL
          AND COALESCE(data #>> '{playerPool,activeSnapshotId}', ${fallbackId}) = ${expectedCurrentId}
      ), inserted AS (
        INSERT INTO player_pool_snapshots
          (id, season, source_season, source, fetched_at, created_at, created_by,
            base_snapshot_id, fingerprint, players)
        SELECT ${snapshot.id}, ${snapshot.season}, ${snapshot.sourceSeason}, ${snapshot.source},
          ${snapshot.fetchedAt}, ${snapshot.createdAt}, ${snapshot.createdBy},
          ${snapshot.baseSnapshotId}, ${snapshot.fingerprint}, ${JSON.stringify(snapshot.players)}::jsonb
        FROM eligible
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      ), valid_snapshot AS (
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM player_pool_snapshots
          WHERE id = ${snapshot.id} AND fingerprint = ${snapshot.fingerprint}
      )
      UPDATE league_state
      SET data = jsonb_set(data, '{playerPool}', ${JSON.stringify(pointer)}::jsonb, true),
        version = version + 1,
        updated_at = now()
      WHERE id = 1
        AND (data #>> '{draft,startedAt}') IS NULL
        AND COALESCE(data #>> '{playerPool,activeSnapshotId}', ${fallbackId}) = ${expectedCurrentId}
        AND EXISTS (SELECT 1 FROM valid_snapshot)
      RETURNING data, version`) as Array<{ data: LeagueDynamicState; version: number }>;
    const updated = rows[0];
    if (updated) return { state: updated.data, version: updated.version };

    const state = await this.getState();
    if (state.state.draft.startedAt !== null) {
      throw new PlayerPoolAcceptError('draft-started', 'The player pool cannot change after the draft starts');
    }
    const currentId = state.state.playerPool?.activeSnapshotId ?? fallbackId;
    if (currentId !== expectedCurrentId) {
      throw new PlayerPoolAcceptError('stale-base', 'The active player pool changed; preview again');
    }
    throw new PlayerPoolAcceptError('snapshot-conflict', 'The snapshot ID conflicts with stored content');
  }

  async getScheduleSnapshot(id: string): Promise<StoredScheduleSnapshot | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data FROM schedule_snapshots WHERE id = ${id}`) as Array<{
      data: StoredScheduleSnapshot;
    }>;
    return rows[0]?.data ?? null;
  }

  async acceptScheduleSnapshot(
    snapshot: StoredScheduleSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult> {
    await this.ensureInit();
    const pointer = { activeSnapshotId: snapshot.id, acceptedAt, acceptedBy };
    const rows = (await this.sql`WITH eligible AS (
        SELECT id FROM league_state
        WHERE id = 1
          AND (data #>> '{draft,startedAt}') IS NULL
          AND COALESCE(data #>> '{schedule,activeSnapshotId}', ${fallbackId}) = ${expectedCurrentId}
      ), inserted AS (
        INSERT INTO schedule_snapshots (id, season, fingerprint, data, created_at, created_by)
        SELECT ${snapshot.id}, ${snapshot.season}, ${snapshot.fingerprint},
          ${JSON.stringify(snapshot)}::jsonb, ${snapshot.createdAt}, ${snapshot.createdBy}
        FROM eligible
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      ), valid_snapshot AS (
        SELECT id FROM inserted
        UNION ALL
        SELECT id FROM schedule_snapshots
          WHERE id = ${snapshot.id} AND fingerprint = ${snapshot.fingerprint}
      )
      UPDATE league_state
      SET data = jsonb_set(data, '{schedule}', ${JSON.stringify(pointer)}::jsonb, true),
        version = version + 1,
        updated_at = now()
      WHERE id = 1
        AND (data #>> '{draft,startedAt}') IS NULL
        AND COALESCE(data #>> '{schedule,activeSnapshotId}', ${fallbackId}) = ${expectedCurrentId}
        AND EXISTS (SELECT 1 FROM valid_snapshot)
      RETURNING data, version`) as Array<{ data: LeagueDynamicState; version: number }>;
    const updated = rows[0];
    if (updated) return { state: updated.data, version: updated.version };

    const state = await this.getState();
    if (state.state.draft.startedAt !== null) {
      throw new ScheduleAcceptError('draft-started', 'The schedule cannot change after the draft starts');
    }
    const currentId = state.state.schedule?.activeSnapshotId ?? fallbackId;
    if (currentId !== expectedCurrentId) {
      throw new ScheduleAcceptError('stale-base', 'The active schedule changed; preview again');
    }
    throw new ScheduleAcceptError('snapshot-conflict', 'The snapshot ID conflicts with stored content');
  }
}

// ─── Local JSON file backend ─────────────────────────────────────────────────

interface FileDoc {
  state: LeagueDynamicState;
  version: number;
  updatedAt: string;
  pins: Record<string, string>;
  audit: AuditRow[];
  playerPoolSnapshots: PlayerPoolSnapshot[];
  scheduleSnapshots: StoredScheduleSnapshot[];
  keeperScenarios: Array<{
    season: number;
    viewer: string;
    target: string;
    selections: KeeperSelection[];
    updatedAt: string;
  }>;
}

const MAX_FILE_AUDIT_ROWS = 1000;

class FileBackend implements StoreBackend {
  private readonly filePath: string;
  private initPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

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
    for (const owner of OWNERS) {
      if (!(owner in doc.pins)) doc.pins[owner] = UNCLAIMED;
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
        playerPoolSnapshots: Array.isArray(doc.playerPoolSnapshots) ? doc.playerPoolSnapshots : [],
        scheduleSnapshots: Array.isArray(doc.scheduleSnapshots) ? doc.scheduleSnapshots : [],
        keeperScenarios: Array.isArray(doc.keeperScenarios) ? doc.keeperScenarios : [],
      };
    } catch {
      return {
        state: defaultState(),
        version: 0,
        updatedAt: new Date().toISOString(),
        pins: {},
        audit: [],
        playerPoolSnapshots: [],
        scheduleSnapshots: [],
        keeperScenarios: [],
      };
    }
  }

  private writeDoc(doc: FileDoc): void {
    fs.writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }

  private enqueueWrite<T>(action: () => T | Promise<T>): Promise<T> {
    const run = this.writeQueue.then(action);
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async getState(): Promise<StateResult> {
    await this.ensureInit();
    const doc = this.readDoc();
    return { state: doc.state, version: doc.version, updatedAt: doc.updatedAt };
  }

  async mutateState(
    fn: (draft: LeagueDynamicState) => void,
  ): Promise<MutateResult> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      const draft = structuredClone(doc.state);
      fn(draft);
      doc.state = draft;
      doc.version += 1;
      doc.updatedAt = new Date().toISOString();
      this.writeDoc(doc);
      return { state: doc.state, version: doc.version };
    });
  }

  async getKeeperScenario(season: number, viewer: string): Promise<KeeperScenario> {
    await this.ensureInit();
    const doc = this.readDoc();
    return Object.fromEntries(
      doc.keeperScenarios
        .filter((row) => row.season === season && row.viewer === viewer && row.selections.length > 0)
        .map((row) => [row.target, structuredClone(row.selections)]),
    );
  }

  async setKeeperScenarioTarget(
    season: number,
    viewer: string,
    target: string,
    selections: KeeperSelection[],
  ): Promise<KeeperScenario> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.keeperScenarios = doc.keeperScenarios.filter(
        (row) => !(row.season === season && row.viewer === viewer && row.target === target),
      );
      if (selections.length > 0) {
        doc.keeperScenarios.push({
          season,
          viewer,
          target,
          selections: structuredClone(selections),
          updatedAt: new Date().toISOString(),
        });
      }
      this.writeDoc(doc);
    });
    return this.getKeeperScenario(season, viewer);
  }

  async clearKeeperScenario(season: number, viewer: string): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.keeperScenarios = doc.keeperScenarios.filter(
        (row) => row.season !== season || row.viewer !== viewer,
      );
      this.writeDoc(doc);
    });
  }

  async clearKeeperScenariosForSeason(season: number): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.keeperScenarios = doc.keeperScenarios.filter((row) => row.season !== season);
      this.writeDoc(doc);
    });
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
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.pins[owner] = pin;
      this.writeDoc(doc);
    });
  }

  async appendAudit(owner: string | null, action: string, detail: unknown): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
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
    });
  }

  async readAudit(limit: number): Promise<AuditRow[]> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.audit.slice(-limit).reverse(); // newest first
  }

  async getPlayerPoolSnapshot(id: string): Promise<PlayerPoolSnapshot | null> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.playerPoolSnapshots.find((snapshot) => snapshot.id === id) ?? null;
  }

  async acceptPlayerPoolSnapshot(
    snapshot: PlayerPoolSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.state.draft.startedAt !== null) {
        throw new PlayerPoolAcceptError('draft-started', 'The player pool cannot change after the draft starts');
      }
      const currentId = doc.state.playerPool?.activeSnapshotId ?? fallbackId;
      if (currentId !== expectedCurrentId) {
        throw new PlayerPoolAcceptError('stale-base', 'The active player pool changed; preview again');
      }
      const existing = doc.playerPoolSnapshots.find((candidate) => candidate.id === snapshot.id);
      if (existing && existing.fingerprint !== snapshot.fingerprint) {
        throw new PlayerPoolAcceptError('snapshot-conflict', 'The snapshot ID conflicts with stored content');
      }
      if (!existing) doc.playerPoolSnapshots.push(structuredClone(snapshot));
      doc.state.playerPool = { activeSnapshotId: snapshot.id, acceptedAt, acceptedBy };
      doc.version += 1;
      doc.updatedAt = acceptedAt;
      this.writeDoc(doc);
      return { state: doc.state, version: doc.version };
    });
  }

  async getScheduleSnapshot(id: string): Promise<StoredScheduleSnapshot | null> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.scheduleSnapshots.find((snapshot) => snapshot.id === id) ?? null;
  }

  async acceptScheduleSnapshot(
    snapshot: StoredScheduleSnapshot,
    expectedCurrentId: string,
    fallbackId: string,
    acceptedAt: string,
    acceptedBy: string,
  ): Promise<MutateResult> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.state.draft.startedAt !== null) {
        throw new ScheduleAcceptError('draft-started', 'The schedule cannot change after the draft starts');
      }
      const currentId = doc.state.schedule?.activeSnapshotId ?? fallbackId;
      if (currentId !== expectedCurrentId) {
        throw new ScheduleAcceptError('stale-base', 'The active schedule changed; preview again');
      }
      const existing = doc.scheduleSnapshots.find((candidate) => candidate.id === snapshot.id);
      if (existing && existing.fingerprint !== snapshot.fingerprint) {
        throw new ScheduleAcceptError('snapshot-conflict', 'The snapshot ID conflicts with stored content');
      }
      if (!existing) doc.scheduleSnapshots.push(structuredClone(snapshot));
      doc.state.schedule = { activeSnapshotId: snapshot.id, acceptedAt, acceptedBy };
      doc.version += 1;
      doc.updatedAt = acceptedAt;
      this.writeDoc(doc);
      return { state: doc.state, version: doc.version };
    });
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
  fn: (draft: LeagueDynamicState) => void,
): Promise<MutateResult> {
  return getBackend().mutateState(fn);
}

export async function getKeeperScenario(season: number, viewer: string): Promise<KeeperScenario> {
  return getBackend().getKeeperScenario(season, viewer);
}

export async function setKeeperScenarioTarget(
  season: number,
  viewer: string,
  target: string,
  selections: KeeperSelection[],
): Promise<KeeperScenario> {
  return getBackend().setKeeperScenarioTarget(season, viewer, target, selections);
}

export async function clearKeeperScenario(season: number, viewer: string): Promise<void> {
  return getBackend().clearKeeperScenario(season, viewer);
}

export async function clearKeeperScenariosForSeason(season: number): Promise<void> {
  return getBackend().clearKeeperScenariosForSeason(season);
}

/**
 * Check an owner/PIN pair. Owner names are case-sensitive exact matches to the
 * config. Commissioner status is derived from the config JSON, not storage.
 */
export async function verifyPin(
  owner: string,
  pin: string,
): Promise<{ ok: boolean; isCommissioner: boolean; mustChangePin: boolean }> {
  if (typeof owner !== 'string' || typeof pin !== 'string' || pin === '' || !isKnownOwner(owner)) {
    return { ok: false, isCommissioner: false, mustChangePin: false };
  }
  const stored = await getBackend().getPin(owner);
  if (stored === null || stored === UNCLAIMED) {
    return { ok: false, isCommissioner: false, mustChangePin: false };
  }
  const okNormal = stored === pin;
  const okTemp = stored === TEMP_PREFIX + pin;
  const ok = okNormal || okTemp;
  return { ok, isCommissioner: ok && isCommissionerOwner(owner), mustChangePin: okTemp };
}

/** Which owners have set a PIN yet (safe to expose publicly). */
export async function getPinStatus(): Promise<Array<{ owner: string; claimed: boolean }>> {
  const rows = await getPins();
  const byOwner = new Map(rows.map((r) => [r.owner, r.pin]));
  return OWNERS.map((owner) => ({
    owner,
    claimed: (byOwner.get(owner) ?? UNCLAIMED) !== UNCLAIMED,
  }));
}

/**
 * First-time PIN claim: succeeds only while the owner's PIN is unclaimed.
 * After that, changes go through the commissioner (setPin).
 */
export async function claimPin(
  owner: string,
  pin: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isKnownOwner(owner)) return { ok: false, error: `Unknown owner: ${owner}` };
  const stored = await getBackend().getPin(owner);
  if (stored !== null && stored !== UNCLAIMED) {
    return { ok: false, error: 'A PIN is already set for this team' };
  }
  await getBackend().setPin(owner, pin);
  return { ok: true };
}

/** All pins, ordered as the owners appear in the league config. */
export async function getPins(): Promise<Array<{ owner: string; pin: string; temp: boolean }>> {
  const rows = await getBackend().getPins();
  const order = new Map(OWNERS.map((o, i) => [o, i]));
  return rows
    .map((r) => ({
      owner: r.owner,
      pin: r.pin.startsWith(TEMP_PREFIX) ? r.pin.slice(TEMP_PREFIX.length) : r.pin,
      temp: r.pin.startsWith(TEMP_PREFIX),
    }))
    .sort((a, b) => (order.get(a.owner) ?? Infinity) - (order.get(b.owner) ?? Infinity));
}

export async function setPin(owner: string, pin: string, temp = false): Promise<void> {
  return getBackend().setPin(owner, temp && pin !== UNCLAIMED ? TEMP_PREFIX + pin : pin);
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

export async function getPlayerPoolSnapshot(id: string): Promise<PlayerPoolSnapshot | null> {
  return getBackend().getPlayerPoolSnapshot(id);
}

export async function acceptPlayerPoolSnapshot(
  snapshot: PlayerPoolSnapshot,
  expectedCurrentId: string,
  fallbackId: string,
  acceptedAt: string,
  acceptedBy: string,
): Promise<MutateResult> {
  return getBackend().acceptPlayerPoolSnapshot(
    snapshot,
    expectedCurrentId,
    fallbackId,
    acceptedAt,
    acceptedBy,
  );
}

export async function getScheduleSnapshot(id: string): Promise<StoredScheduleSnapshot | null> {
  return getBackend().getScheduleSnapshot(id);
}

export async function acceptScheduleSnapshot(
  snapshot: StoredScheduleSnapshot,
  expectedCurrentId: string,
  fallbackId: string,
  acceptedAt: string,
  acceptedBy: string,
): Promise<MutateResult> {
  return getBackend().acceptScheduleSnapshot(
    snapshot,
    expectedCurrentId,
    fallbackId,
    acceptedAt,
    acceptedBy,
  );
}
