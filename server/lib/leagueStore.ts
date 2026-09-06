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
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import {
  canRequestLink,
  emailTakenBy,
  isExpired,
  isValidEmail,
  linkExpiresAt,
  normalizeEmail,
  ownerForEmail,
  sessionExpiresAt,
  LINK_WINDOW_MINUTES,
} from '../../src/lib/league/auth.js';
import leagueConfig from '../../src/data/source/league-2027-config.json' with { type: 'json' };
import type { PlayerPoolSnapshot } from '../../src/lib/league/playerPool.js';
import type { RulebookSignature } from '../../src/lib/league/rulebookSignatures.js';
import type { StoredScheduleSnapshot } from '../../src/lib/league/schedule.js';
import type { PickTradeProposal, PickTransfer } from '../../src/lib/keeper/types.js';

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
    /** When the commissioner called the draft finished; null while it runs. */
    closedAt?: string | null;
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
  /**
   * Pick trades live here rather than in their own table so that accepting a
   * trade and entering a draft pick are the same single write. That is what
   * makes exactly one of them win when both land at once.
   */
  pickTransfers?: PickTransfer[];
  pickTradeProposals?: PickTradeProposal[];
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

/** The commissioner's working copy of the rulebook, with a version for safe writes. */
export interface RulebookDraftRow {
  season: number;
  /** A whole Rulebook document; the server never inspects its shape. */
  book: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** An immutable published rule book. Never edited in place. */
export interface RulebookVersionRow {
  id: string;
  season: number;
  revision: number;
  fingerprint: string;
  book: unknown;
  notes: string;
  publishedAt: string;
  publishedBy: string;
}

export class RulebookSignError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RulebookSignError';
  }
}

/** A league poll, stored whole. Votes live inside it. */
export interface PollRow {
  id: string;
  season: number;
  data: unknown;
  updatedAt: string;
}

/**
 * An owner's email address, used to decide who a sign-in link belongs to.
 *
 * The address never decides what a member can do. It only maps to the owner
 * name, which is what every permission in this app is keyed on. Emails live
 * here and not in the committed league config, which ships to the browser.
 */
export interface OwnerEmailRow {
  owner: string;
  email: string;
  /** Null until the member has signed in with that address at least once. */
  confirmedAt: string | null;
}

/**
 * A pending sign-in link.
 *
 * Only the hash is stored. Someone who reads the table cannot sign in with
 * what they find there, and a link works once.
 */
export interface LoginTokenRow {
  tokenHash: string;
  email: string;
  owner: string;
  issuedAt: string;
  expiresAt: string;
}

/** A signed-in device. Same rule: the hash is stored, never the token. */
export interface SessionRow {
  tokenHash: string;
  owner: string;
  email: string;
  issuedAt: string;
  expiresAt: string;
  /**
   * The commissioner behind this session, when they are acting as someone
   * else. Null for a normal sign-in. Everything written through such a
   * session names both people in the audit log, so "who actually did this"
   * always has an answer.
   */
  impersonatedBy?: string | null;
}

/**
 * One notification that has already gone out.
 *
 * The key comes from reminderKey() and names the season, the reminder and the
 * owner. It exists so a cron that fires twice, or a deploy that replays an
 * hour, never mails ten people the same warning again.
 */
export interface SentNoticeRow {
  key: string;
  season: number;
  sentAt: string;
}

export class PollWriteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PollWriteError';
  }
}

/** The commissioner's working copy of league history, with a version for safe writes. */
export interface LeagueHistoryDraftRow {
  season: number;
  /** A whole LeagueHistory document; the store never inspects its shape. */
  history: unknown;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** An immutable published league history. Corrections add a row, never edit one. */
export interface LeagueHistoryVersionRow {
  id: string;
  season: number;
  revision: number;
  fingerprint: string;
  history: unknown;
  notes: string;
  /** Why this revision exists. Required, so a correction always says why. */
  reason: string;
  publishedAt: string;
  publishedBy: string;
}

export class HistorySaveError extends Error {
  code: string;
  currentVersion?: number;
  constructor(code: string, message: string, currentVersion?: number) {
    super(message);
    this.code = code;
    this.currentVersion = currentVersion;
    this.name = 'HistorySaveError';
  }
}

export class HistoryPublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HistoryPublishError';
  }
}

export class RulebookPublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RulebookPublishError';
  }
}

export class RulebookSaveError extends Error {
  code: string;
  currentVersion?: number;
  constructor(code: string, message: string, currentVersion?: number) {
    super(message);
    this.code = code;
    this.currentVersion = currentVersion;
    this.name = 'RulebookSaveError';
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
    draft: { picks: {}, startedAt: null, closedAt: null },
    locks: { keepersLocked: false },
    pickTransfers: [],
    pickTradeProposals: [],
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
  getOwnerEmails(): Promise<OwnerEmailRow[]>;
  setOwnerEmail(owner: string, email: string, confirmedAt: string | null): Promise<void>;
  createLoginToken(row: LoginTokenRow): Promise<void>;
  /** Deletes the row as it reads it, so a link cannot be used twice. */
  takeLoginToken(tokenHash: string): Promise<LoginTokenRow | null>;
  /** Issue times of links sent to this address since the given moment. */
  recentLoginTokens(email: string, since: string): Promise<string[]>;
  createSession(row: SessionRow): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForOwner(owner: string): Promise<void>;
  purgeExpiredAuth(now: string): Promise<void>;
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
  getRulebookDraft(season: number): Promise<RulebookDraftRow | null>;
  saveRulebookDraft(
    season: number,
    book: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<RulebookDraftRow>;
  deleteRulebookDraft(season: number): Promise<void>;
  publishRulebookVersion(row: RulebookVersionRow): Promise<RulebookVersionRow>;
  getLatestRulebookVersion(season: number): Promise<RulebookVersionRow | null>;
  getRulebookVersion(id: string): Promise<RulebookVersionRow | null>;
  listRulebookVersions(season: number): Promise<Array<Omit<RulebookVersionRow, 'book'>>>;
  listRulebookSignatures(season: number): Promise<RulebookSignature[]>;
  insertRulebookSignature(row: RulebookSignature): Promise<RulebookSignature>;
  getHistoryDraft(season: number): Promise<LeagueHistoryDraftRow | null>;
  saveHistoryDraft(
    season: number,
    history: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<LeagueHistoryDraftRow>;
  deleteHistoryDraft(season: number): Promise<void>;
  publishHistoryVersion(row: LeagueHistoryVersionRow): Promise<LeagueHistoryVersionRow>;
  getLatestHistoryVersion(season: number): Promise<LeagueHistoryVersionRow | null>;
  getHistoryVersion(id: string): Promise<LeagueHistoryVersionRow | null>;
  listHistoryVersions(season: number): Promise<Array<Omit<LeagueHistoryVersionRow, 'history'>>>;
  listSentNotices(season: number): Promise<string[]>;
  /** True when this caller claimed the key, false when it was already taken. */
  claimSentNotice(key: string, season: number, sentAt: string): Promise<boolean>;
  listPolls(season: number): Promise<unknown[]>;
  getPoll(id: string): Promise<unknown | null>;
  insertPoll(id: string, season: number, data: unknown, at: string): Promise<void>;
  updatePoll(id: string, mutate: (current: unknown) => unknown): Promise<unknown>;
  clearPollsForSeason(season: number): Promise<void>;
}

interface RawVersionRow {
  id: string;
  season: number;
  revision: number;
  fingerprint: string;
  data?: unknown;
  notes: string;
  published_at: string | Date;
  published_by: string;
}

/** A version row without the book, for listings. */
function versionSummary(row: RulebookVersionRow): Omit<RulebookVersionRow, 'book'> {
  return {
    id: row.id,
    season: row.season,
    revision: row.revision,
    fingerprint: row.fingerprint,
    notes: row.notes,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
  };
}

function toVersionRow(raw: RawVersionRow): RulebookVersionRow {
  return {
    id: raw.id,
    season: raw.season,
    revision: raw.revision,
    fingerprint: raw.fingerprint,
    book: raw.data,
    notes: raw.notes,
    publishedAt: new Date(raw.published_at).toISOString(),
    publishedBy: raw.published_by,
  };
}

interface RawHistoryVersionRow extends RawVersionRow {
  reason?: string;
}

/** A history version row without the document, for listings. */
function historyVersionSummary(
  row: LeagueHistoryVersionRow,
): Omit<LeagueHistoryVersionRow, 'history'> {
  return {
    id: row.id,
    season: row.season,
    revision: row.revision,
    fingerprint: row.fingerprint,
    notes: row.notes,
    reason: row.reason,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
  };
}

function toHistoryVersionRow(raw: RawHistoryVersionRow): LeagueHistoryVersionRow {
  return {
    id: raw.id,
    season: raw.season,
    revision: raw.revision,
    fingerprint: raw.fingerprint,
    history: raw.data,
    notes: raw.notes,
    reason: raw.reason ?? '',
    publishedAt: new Date(raw.published_at).toISOString(),
    publishedBy: raw.published_by,
  };
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
    await this.sql`CREATE TABLE IF NOT EXISTS owner_emails (
      owner text primary key,
      email text not null,
      confirmed_at timestamptz
    )`;
    await this.sql`CREATE UNIQUE INDEX IF NOT EXISTS owner_emails_email
      ON owner_emails (lower(email))`;
    await this.sql`CREATE TABLE IF NOT EXISTS login_tokens (
      token_hash text primary key,
      email text not null,
      owner text not null,
      issued_at timestamptz not null,
      expires_at timestamptz not null
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS login_tokens_email
      ON login_tokens (lower(email), issued_at)`;
    await this.sql`CREATE TABLE IF NOT EXISTS sessions (
      token_hash text primary key,
      owner text not null,
      email text not null,
      issued_at timestamptz not null,
      expires_at timestamptz not null
    )`;
    // Added after the first sessions shipped, so it has to be a separate step.
    await this.sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonated_by text`;
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
    await this.sql`CREATE TABLE IF NOT EXISTS polls (
      id text primary key,
      season int not null,
      data jsonb not null,
      updated_at timestamptz not null
    )`;
    // One row per notification already sent. The primary key is what stops a
    // second cron run mailing the same warning twice.
    await this.sql`CREATE TABLE IF NOT EXISTS sent_notices (
      key text primary key,
      season int not null,
      sent_at timestamptz not null
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS rulebook_versions (
      id text primary key,
      season int not null,
      revision int not null,
      fingerprint text not null,
      data jsonb not null,
      notes text not null,
      published_at timestamptz not null,
      published_by text not null
    )`;
    // One row per member per version, and never updated: a signature is the
    // record of what someone agreed to at a moment, so it is written once.
    await this.sql`CREATE TABLE IF NOT EXISTS rulebook_signatures (
      version_id text not null,
      owner text not null,
      season int not null,
      revision int not null,
      fingerprint text not null,
      acknowledgement text not null,
      signed_at timestamptz not null,
      primary key (version_id, owner)
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS league_history_draft (
      season int primary key,
      data jsonb not null,
      version int not null default 0,
      updated_at timestamptz not null default now(),
      updated_by text not null
    )`;
    // Immutable, exactly like rulebook_versions: a correction inserts a new
    // revision carrying its reason, so nothing is ever rewritten unseen.
    await this.sql`CREATE TABLE IF NOT EXISTS league_history_versions (
      id text primary key,
      season int not null,
      revision int not null,
      fingerprint text not null,
      data jsonb not null,
      notes text not null,
      reason text not null,
      published_at timestamptz not null,
      published_by text not null
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS rulebook_draft (
      season int primary key,
      data jsonb not null,
      version int not null default 0,
      updated_at timestamptz not null default now(),
      updated_by text not null
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

  async getOwnerEmails(): Promise<OwnerEmailRow[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT owner, email, confirmed_at FROM owner_emails`) as Array<{
      owner: string;
      email: string;
      confirmed_at: string | Date | null;
    }>;
    return rows.map((r) => ({
      owner: r.owner,
      email: r.email,
      confirmedAt: r.confirmed_at === null ? null : new Date(r.confirmed_at).toISOString(),
    }));
  }

  async setOwnerEmail(owner: string, email: string, confirmedAt: string | null): Promise<void> {
    await this.ensureInit();
    await this.sql`INSERT INTO owner_emails (owner, email, confirmed_at)
      VALUES (${owner}, ${email}, ${confirmedAt})
      ON CONFLICT (owner) DO UPDATE
        SET email = EXCLUDED.email, confirmed_at = EXCLUDED.confirmed_at`;
  }

  async createLoginToken(row: LoginTokenRow): Promise<void> {
    await this.ensureInit();
    await this.sql`INSERT INTO login_tokens (token_hash, email, owner, issued_at, expires_at)
      VALUES (${row.tokenHash}, ${row.email}, ${row.owner}, ${row.issuedAt}, ${row.expiresAt})`;
  }

  async takeLoginToken(tokenHash: string): Promise<LoginTokenRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`DELETE FROM login_tokens WHERE token_hash = ${tokenHash}
      RETURNING token_hash, email, owner, issued_at, expires_at`) as Array<{
      token_hash: string;
      email: string;
      owner: string;
      issued_at: string | Date;
      expires_at: string | Date;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      email: row.email,
      owner: row.owner,
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  async recentLoginTokens(email: string, since: string): Promise<string[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT issued_at FROM login_tokens
      WHERE lower(email) = lower(${email}) AND issued_at >= ${since}`) as Array<{
      issued_at: string | Date;
    }>;
    return rows.map((r) => new Date(r.issued_at).toISOString());
  }

  async createSession(row: SessionRow): Promise<void> {
    await this.ensureInit();
    await this.sql`INSERT INTO sessions (token_hash, owner, email, issued_at, expires_at, impersonated_by)
      VALUES (${row.tokenHash}, ${row.owner}, ${row.email}, ${row.issuedAt}, ${row.expiresAt},
        ${row.impersonatedBy ?? null})`;
  }

  async getSession(tokenHash: string): Promise<SessionRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT token_hash, owner, email, issued_at, expires_at, impersonated_by
      FROM sessions WHERE token_hash = ${tokenHash}`) as Array<{
      token_hash: string;
      owner: string;
      email: string;
      issued_at: string | Date;
      expires_at: string | Date;
      impersonated_by: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      owner: row.owner,
      email: row.email,
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      impersonatedBy: row.impersonated_by,
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }

  async deleteSessionsForOwner(owner: string): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM sessions WHERE owner = ${owner}`;
  }

  async purgeExpiredAuth(now: string): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM login_tokens WHERE expires_at < ${now}`;
    await this.sql`DELETE FROM sessions WHERE expires_at < ${now}`;
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

  async getRulebookDraft(season: number): Promise<RulebookDraftRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data, version, updated_at, updated_by
      FROM rulebook_draft WHERE season = ${season}`) as Array<{
      data: unknown;
      version: number;
      updated_at: string | Date;
      updated_by: string;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      season,
      book: row.data,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
      updatedBy: row.updated_by,
    };
  }

  async saveRulebookDraft(
    season: number,
    book: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<RulebookDraftRow> {
    await this.ensureInit();
    // expectedVersion 0 means "there is no draft yet"; anything else must match
    // the stored version, so a stale tab cannot silently overwrite newer edits.
    const rows = (await this.sql`INSERT INTO rulebook_draft (season, data, version, updated_at, updated_by)
      VALUES (${season}, ${JSON.stringify(book)}::jsonb, 1, ${savedAt}, ${savedBy})
      ON CONFLICT (season) DO UPDATE
        SET data = EXCLUDED.data,
            version = rulebook_draft.version + 1,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        WHERE rulebook_draft.version = ${expectedVersion}
      RETURNING version, updated_at, updated_by`) as Array<{
      version: number;
      updated_at: string | Date;
      updated_by: string;
    }>;
    const saved = rows[0];
    if (saved) {
      return {
        season,
        book,
        version: saved.version,
        updatedAt: new Date(saved.updated_at).toISOString(),
        updatedBy: saved.updated_by,
      };
    }
    const current = await this.getRulebookDraft(season);
    throw new RulebookSaveError(
      'stale-version',
      'Someone saved a newer draft. Reload before editing again.',
      current?.version,
    );
  }

  async deleteRulebookDraft(season: number): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM rulebook_draft WHERE season = ${season}`;
  }

  async publishRulebookVersion(row: RulebookVersionRow): Promise<RulebookVersionRow> {
    await this.ensureInit();
    const inserted = (await this.sql`INSERT INTO rulebook_versions
      (id, season, revision, fingerprint, data, notes, published_at, published_by)
      VALUES (${row.id}, ${row.season}, ${row.revision}, ${row.fingerprint},
        ${JSON.stringify(row.book)}::jsonb, ${row.notes}, ${row.publishedAt}, ${row.publishedBy})
      ON CONFLICT (id) DO NOTHING
      RETURNING id`) as Array<{ id: string }>;
    if (!inserted[0]) {
      throw new RulebookPublishError('duplicate-version', 'That version has already been published');
    }
    return row;
  }

  async getLatestRulebookVersion(season: number): Promise<RulebookVersionRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, data, notes,
        published_at, published_by
      FROM rulebook_versions WHERE season = ${season}
      ORDER BY published_at DESC, id DESC LIMIT 1`) as RawVersionRow[];
    return rows[0] ? toVersionRow(rows[0]) : null;
  }

  async getRulebookVersion(id: string): Promise<RulebookVersionRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, data, notes,
        published_at, published_by
      FROM rulebook_versions WHERE id = ${id}`) as RawVersionRow[];
    return rows[0] ? toVersionRow(rows[0]) : null;
  }

  async listRulebookVersions(season: number): Promise<Array<Omit<RulebookVersionRow, 'book'>>> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, notes,
        published_at, published_by
      FROM rulebook_versions WHERE season = ${season}
      ORDER BY published_at DESC, id DESC`) as RawVersionRow[];
    return rows.map((raw) => versionSummary(toVersionRow(raw)));
  }

  async listRulebookSignatures(season: number): Promise<RulebookSignature[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT version_id, owner, season, revision, fingerprint,
        acknowledgement, signed_at
      FROM rulebook_signatures WHERE season = ${season}
      ORDER BY signed_at ASC`) as Array<{
      version_id: string;
      owner: string;
      season: number;
      revision: number;
      fingerprint: string;
      acknowledgement: string;
      signed_at: string | Date;
    }>;
    return rows.map((row) => ({
      versionId: row.version_id,
      owner: row.owner,
      season: row.season,
      revision: row.revision,
      fingerprint: row.fingerprint,
      acknowledgement: row.acknowledgement,
      signedAt: new Date(row.signed_at).toISOString(),
    }));
  }

  async insertRulebookSignature(row: RulebookSignature): Promise<RulebookSignature> {
    await this.ensureInit();
    // DO NOTHING, never DO UPDATE: a signature already on file stands.
    const written = (await this.sql`INSERT INTO rulebook_signatures
      (version_id, owner, season, revision, fingerprint, acknowledgement, signed_at)
      VALUES (${row.versionId}, ${row.owner}, ${row.season}, ${row.revision},
        ${row.fingerprint}, ${row.acknowledgement}, ${row.signedAt})
      ON CONFLICT (version_id, owner) DO NOTHING
      RETURNING owner`) as Array<{ owner: string }>;
    if (!written[0]) {
      throw new RulebookSignError('already-signed', 'You have already signed this revision');
    }
    return row;
  }

  async getHistoryDraft(season: number): Promise<LeagueHistoryDraftRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data, version, updated_at, updated_by
      FROM league_history_draft WHERE season = ${season}`) as Array<{
      data: unknown;
      version: number;
      updated_at: string | Date;
      updated_by: string;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      season,
      history: row.data,
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
      updatedBy: row.updated_by,
    };
  }

  async saveHistoryDraft(
    season: number,
    history: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<LeagueHistoryDraftRow> {
    await this.ensureInit();
    // expectedVersion 0 means "there is no draft yet"; anything else must match
    // what is stored, so a stale tab cannot overwrite newer work.
    const rows = (await this.sql`INSERT INTO league_history_draft (season, data, version, updated_at, updated_by)
      VALUES (${season}, ${JSON.stringify(history)}::jsonb, 1, ${savedAt}, ${savedBy})
      ON CONFLICT (season) DO UPDATE
        SET data = EXCLUDED.data,
            version = league_history_draft.version + 1,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        WHERE league_history_draft.version = ${expectedVersion}
      RETURNING version, updated_at, updated_by`) as Array<{
      version: number;
      updated_at: string | Date;
      updated_by: string;
    }>;
    const saved = rows[0];
    if (saved) {
      return {
        season,
        history,
        version: saved.version,
        updatedAt: new Date(saved.updated_at).toISOString(),
        updatedBy: saved.updated_by,
      };
    }
    const current = await this.getHistoryDraft(season);
    throw new HistorySaveError(
      'stale-version',
      'Someone saved newer history. Reload before editing again.',
      current?.version,
    );
  }

  async deleteHistoryDraft(season: number): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM league_history_draft WHERE season = ${season}`;
  }

  async publishHistoryVersion(row: LeagueHistoryVersionRow): Promise<LeagueHistoryVersionRow> {
    await this.ensureInit();
    const inserted = (await this.sql`INSERT INTO league_history_versions
      (id, season, revision, fingerprint, data, notes, reason, published_at, published_by)
      VALUES (${row.id}, ${row.season}, ${row.revision}, ${row.fingerprint},
        ${JSON.stringify(row.history)}::jsonb, ${row.notes}, ${row.reason},
        ${row.publishedAt}, ${row.publishedBy})
      ON CONFLICT (id) DO NOTHING
      RETURNING id`) as Array<{ id: string }>;
    if (!inserted[0]) {
      throw new HistoryPublishError('duplicate-version', 'That history revision has already been published');
    }
    return row;
  }

  async getLatestHistoryVersion(season: number): Promise<LeagueHistoryVersionRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, data, notes, reason,
        published_at, published_by
      FROM league_history_versions WHERE season = ${season}
      ORDER BY published_at DESC, id DESC LIMIT 1`) as RawHistoryVersionRow[];
    return rows[0] ? toHistoryVersionRow(rows[0]) : null;
  }

  async getHistoryVersion(id: string): Promise<LeagueHistoryVersionRow | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, data, notes, reason,
        published_at, published_by
      FROM league_history_versions WHERE id = ${id}`) as RawHistoryVersionRow[];
    return rows[0] ? toHistoryVersionRow(rows[0]) : null;
  }

  async listHistoryVersions(season: number): Promise<Array<Omit<LeagueHistoryVersionRow, 'history'>>> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT id, season, revision, fingerprint, notes, reason,
        published_at, published_by
      FROM league_history_versions WHERE season = ${season}
      ORDER BY published_at DESC, id DESC`) as RawHistoryVersionRow[];
    return rows.map((raw) => historyVersionSummary(toHistoryVersionRow(raw)));
  }

  async listSentNotices(season: number): Promise<string[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT key FROM sent_notices WHERE season = ${season}`) as Array<{
      key: string;
    }>;
    return rows.map((r) => r.key);
  }

  async claimSentNotice(key: string, season: number, sentAt: string): Promise<boolean> {
    await this.ensureInit();
    // DO NOTHING, then look at what came back: two cron runs at once both try
    // to claim, and exactly one of them gets a row.
    const rows = (await this.sql`INSERT INTO sent_notices (key, season, sent_at)
      VALUES (${key}, ${season}, ${sentAt})
      ON CONFLICT (key) DO NOTHING
      RETURNING key`) as Array<{ key: string }>;
    return rows.length > 0;
  }

  async listPolls(season: number): Promise<unknown[]> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data FROM polls WHERE season = ${season}
      ORDER BY updated_at DESC`) as Array<{ data: unknown }>;
    return rows.map((r) => r.data);
  }

  async getPoll(id: string): Promise<unknown | null> {
    await this.ensureInit();
    const rows = (await this.sql`SELECT data FROM polls WHERE id = ${id}`) as Array<{
      data: unknown;
    }>;
    return rows[0]?.data ?? null;
  }

  async insertPoll(id: string, season: number, data: unknown, at: string): Promise<void> {
    await this.ensureInit();
    const rows = (await this.sql`INSERT INTO polls (id, season, data, updated_at)
      VALUES (${id}, ${season}, ${JSON.stringify(data)}::jsonb, ${at})
      ON CONFLICT (id) DO NOTHING
      RETURNING id`) as Array<{ id: string }>;
    if (!rows[0]) throw new PollWriteError('duplicate', 'That vote already exists');
  }

  /**
   * Read, change, write, retrying if someone else wrote in between. Two members
   * voting at the same moment must not lose one of the votes.
   */
  async updatePoll(id: string, mutate: (current: unknown) => unknown): Promise<unknown> {
    await this.ensureInit();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = (await this.sql`SELECT data, updated_at FROM polls WHERE id = ${id}`) as Array<{
        data: unknown;
        updated_at: string | Date;
      }>;
      const row = rows[0];
      if (!row) throw new PollWriteError('not-found', 'No such vote');
      const next = mutate(row.data);
      const stamp = new Date(row.updated_at).toISOString();
      const written = (await this.sql`UPDATE polls
        SET data = ${JSON.stringify(next)}::jsonb, updated_at = now()
        WHERE id = ${id} AND updated_at = ${stamp}
        RETURNING id`) as Array<{ id: string }>;
      if (written[0]) return next;
    }
    throw new PollWriteError('contention', 'Too many people voting at once; try again');
  }

  async clearPollsForSeason(season: number): Promise<void> {
    await this.ensureInit();
    await this.sql`DELETE FROM polls WHERE season = ${season}`;
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
  rulebookDrafts: RulebookDraftRow[];
  rulebookVersions: RulebookVersionRow[];
  rulebookSignatures: RulebookSignature[];
  historyDrafts: LeagueHistoryDraftRow[];
  historyVersions: LeagueHistoryVersionRow[];
  polls: PollRow[];
  sentNotices: SentNoticeRow[];
  ownerEmails: OwnerEmailRow[];
  loginTokens: LoginTokenRow[];
  sessions: SessionRow[];
}

/** Every list a fresh document starts with. */
function emptyDoc(): FileDoc {
  return {
    state: defaultState(),
    version: 0,
    updatedAt: new Date().toISOString(),
    pins: {},
    audit: [],
    playerPoolSnapshots: [],
    scheduleSnapshots: [],
    keeperScenarios: [],
    rulebookDrafts: [],
    rulebookVersions: [],
    rulebookSignatures: [],
    historyDrafts: [],
    historyVersions: [],
    polls: [],
    sentNotices: [],
    ownerEmails: [],
    loginTokens: [],
    sessions: [],
  };
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
    const blank = emptyDoc();
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const doc = JSON.parse(raw) as Partial<FileDoc>;
      return {
        state: doc.state ?? blank.state,
        version: typeof doc.version === 'number' ? doc.version : 0,
        updatedAt: doc.updatedAt ?? blank.updatedAt,
        pins: doc.pins ?? {},
        audit: Array.isArray(doc.audit) ? doc.audit : [],
        playerPoolSnapshots: Array.isArray(doc.playerPoolSnapshots) ? doc.playerPoolSnapshots : [],
        scheduleSnapshots: Array.isArray(doc.scheduleSnapshots) ? doc.scheduleSnapshots : [],
        keeperScenarios: Array.isArray(doc.keeperScenarios) ? doc.keeperScenarios : [],
        rulebookDrafts: Array.isArray(doc.rulebookDrafts) ? doc.rulebookDrafts : [],
        rulebookVersions: Array.isArray(doc.rulebookVersions) ? doc.rulebookVersions : [],
        rulebookSignatures: Array.isArray(doc.rulebookSignatures) ? doc.rulebookSignatures : [],
        historyDrafts: Array.isArray(doc.historyDrafts) ? doc.historyDrafts : [],
        historyVersions: Array.isArray(doc.historyVersions) ? doc.historyVersions : [],
        polls: Array.isArray(doc.polls) ? doc.polls : [],
        sentNotices: Array.isArray(doc.sentNotices) ? doc.sentNotices : [],
        ownerEmails: Array.isArray(doc.ownerEmails) ? doc.ownerEmails : [],
        loginTokens: Array.isArray(doc.loginTokens) ? doc.loginTokens : [],
        sessions: Array.isArray(doc.sessions) ? doc.sessions : [],
      };
    } catch {
      // A missing or unreadable file starts empty. Every list must be present,
      // or the next write throws on a push into undefined.
      return blank;
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

  async getOwnerEmails(): Promise<OwnerEmailRow[]> {
    await this.ensureInit();
    return this.readDoc().ownerEmails.map((row) => ({ ...row }));
  }

  async setOwnerEmail(owner: string, email: string, confirmedAt: string | null): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      const rest = doc.ownerEmails.filter((row) => row.owner !== owner);
      doc.ownerEmails = [...rest, { owner, email, confirmedAt }];
      this.writeDoc(doc);
    });
  }

  async createLoginToken(row: LoginTokenRow): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.loginTokens = [...doc.loginTokens, { ...row }];
      this.writeDoc(doc);
    });
  }

  async takeLoginToken(tokenHash: string): Promise<LoginTokenRow | null> {
    await this.ensureInit();
    let taken: LoginTokenRow | null = null;
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      const found = doc.loginTokens.find((row) => row.tokenHash === tokenHash) ?? null;
      if (!found) return;
      taken = { ...found };
      doc.loginTokens = doc.loginTokens.filter((row) => row.tokenHash !== tokenHash);
      this.writeDoc(doc);
    });
    return taken;
  }

  async recentLoginTokens(email: string, since: string): Promise<string[]> {
    await this.ensureInit();
    const wanted = email.toLowerCase();
    return this.readDoc()
      .loginTokens.filter((row) => row.email.toLowerCase() === wanted && row.issuedAt >= since)
      .map((row) => row.issuedAt);
  }

  async createSession(row: SessionRow): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.sessions = [...doc.sessions, { ...row }];
      this.writeDoc(doc);
    });
  }

  async getSession(tokenHash: string): Promise<SessionRow | null> {
    await this.ensureInit();
    const found = this.readDoc().sessions.find((row) => row.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.sessions = doc.sessions.filter((row) => row.tokenHash !== tokenHash);
      this.writeDoc(doc);
    });
  }

  async deleteSessionsForOwner(owner: string): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.sessions = doc.sessions.filter((row) => row.owner !== owner);
      this.writeDoc(doc);
    });
  }

  async purgeExpiredAuth(now: string): Promise<void> {
    await this.ensureInit();
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.loginTokens = doc.loginTokens.filter((row) => row.expiresAt >= now);
      doc.sessions = doc.sessions.filter((row) => row.expiresAt >= now);
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

  async getRulebookDraft(season: number): Promise<RulebookDraftRow | null> {
    await this.ensureInit();
    const doc = this.readDoc();
    return doc.rulebookDrafts.find((row) => row.season === season) ?? null;
  }

  async saveRulebookDraft(
    season: number,
    book: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<RulebookDraftRow> {
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      const existing = doc.rulebookDrafts.find((row) => row.season === season);
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw new RulebookSaveError(
          'stale-version',
          'Someone saved a newer draft. Reload before editing again.',
          currentVersion,
        );
      }
      const row: RulebookDraftRow = {
        season,
        book,
        version: currentVersion + 1,
        updatedAt: savedAt,
        updatedBy: savedBy,
      };
      if (existing) doc.rulebookDrafts[doc.rulebookDrafts.indexOf(existing)] = row;
      else doc.rulebookDrafts.push(row);
      this.writeDoc(doc);
      return row;
    });
  }

  async deleteRulebookDraft(season: number): Promise<void> {
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.rulebookDrafts = doc.rulebookDrafts.filter((row) => row.season !== season);
      this.writeDoc(doc);
    });
  }

  async publishRulebookVersion(row: RulebookVersionRow): Promise<RulebookVersionRow> {
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.rulebookVersions.some((v) => v.id === row.id)) {
        throw new RulebookPublishError('duplicate-version', 'That version has already been published');
      }
      doc.rulebookVersions.push(structuredClone(row));
      this.writeDoc(doc);
      return row;
    });
  }

  /** Newest first, matching the Neon ordering. */
  private sortedVersions(season: number): RulebookVersionRow[] {
    return this.readDoc()
      .rulebookVersions.filter((v) => v.season === season)
      .sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id.localeCompare(a.id)
          : b.publishedAt.localeCompare(a.publishedAt),
      );
  }

  async getLatestRulebookVersion(season: number): Promise<RulebookVersionRow | null> {
    await this.ensureInit();
    return this.sortedVersions(season)[0] ?? null;
  }

  async getRulebookVersion(id: string): Promise<RulebookVersionRow | null> {
    await this.ensureInit();
    return this.readDoc().rulebookVersions.find((v) => v.id === id) ?? null;
  }

  async listRulebookVersions(season: number): Promise<Array<Omit<RulebookVersionRow, 'book'>>> {
    await this.ensureInit();
    return this.sortedVersions(season).map(versionSummary);
  }

  async listRulebookSignatures(season: number): Promise<RulebookSignature[]> {
    await this.ensureInit();
    return this.readDoc()
      .rulebookSignatures.filter((row) => row.season === season)
      .sort((a, b) => a.signedAt.localeCompare(b.signedAt));
  }

  async insertRulebookSignature(row: RulebookSignature): Promise<RulebookSignature> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      const taken = doc.rulebookSignatures.some(
        (s) => s.versionId === row.versionId && s.owner === row.owner,
      );
      // Never replaced: a signature on file stands, exactly as Neon does it.
      if (taken) {
        throw new RulebookSignError('already-signed', 'You have already signed this revision');
      }
      doc.rulebookSignatures.push(structuredClone(row));
      this.writeDoc(doc);
      return row;
    });
  }

  async getHistoryDraft(season: number): Promise<LeagueHistoryDraftRow | null> {
    await this.ensureInit();
    return this.readDoc().historyDrafts.find((row) => row.season === season) ?? null;
  }

  async saveHistoryDraft(
    season: number,
    history: unknown,
    expectedVersion: number,
    savedAt: string,
    savedBy: string,
  ): Promise<LeagueHistoryDraftRow> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      const existing = doc.historyDrafts.find((row) => row.season === season);
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw new HistorySaveError(
          'stale-version',
          'Someone saved newer history. Reload before editing again.',
          currentVersion,
        );
      }
      const row: LeagueHistoryDraftRow = {
        season,
        history,
        version: currentVersion + 1,
        updatedAt: savedAt,
        updatedBy: savedBy,
      };
      if (existing) doc.historyDrafts[doc.historyDrafts.indexOf(existing)] = row;
      else doc.historyDrafts.push(row);
      this.writeDoc(doc);
      return row;
    });
  }

  async deleteHistoryDraft(season: number): Promise<void> {
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.historyDrafts = doc.historyDrafts.filter((row) => row.season !== season);
      this.writeDoc(doc);
    });
  }

  async publishHistoryVersion(row: LeagueHistoryVersionRow): Promise<LeagueHistoryVersionRow> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.historyVersions.some((version) => version.id === row.id)) {
        throw new HistoryPublishError('duplicate-version', 'That history revision has already been published');
      }
      doc.historyVersions.push(structuredClone(row));
      this.writeDoc(doc);
      return row;
    });
  }

  /** Newest first, matching the Neon ordering. */
  private sortedHistoryVersions(season: number): LeagueHistoryVersionRow[] {
    return this.readDoc()
      .historyVersions.filter((version) => version.season === season)
      .sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id.localeCompare(a.id)
          : b.publishedAt.localeCompare(a.publishedAt),
      );
  }

  async getLatestHistoryVersion(season: number): Promise<LeagueHistoryVersionRow | null> {
    await this.ensureInit();
    return this.sortedHistoryVersions(season)[0] ?? null;
  }

  async getHistoryVersion(id: string): Promise<LeagueHistoryVersionRow | null> {
    await this.ensureInit();
    return this.readDoc().historyVersions.find((version) => version.id === id) ?? null;
  }

  async listHistoryVersions(season: number): Promise<Array<Omit<LeagueHistoryVersionRow, 'history'>>> {
    await this.ensureInit();
    return this.sortedHistoryVersions(season).map(historyVersionSummary);
  }

  async listSentNotices(season: number): Promise<string[]> {
    await this.ensureInit();
    return this.readDoc()
      .sentNotices.filter((row) => row.season === season)
      .map((row) => row.key);
  }

  async claimSentNotice(key: string, season: number, sentAt: string): Promise<boolean> {
    await this.ensureInit();
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.sentNotices.some((row) => row.key === key)) return false;
      doc.sentNotices.push({ key, season, sentAt });
      this.writeDoc(doc);
      return true;
    });
  }

  async listPolls(season: number): Promise<unknown[]> {
    await this.ensureInit();
    return this.readDoc()
      .polls.filter((row) => row.season === season)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((row) => row.data);
  }

  async getPoll(id: string): Promise<unknown | null> {
    await this.ensureInit();
    return this.readDoc().polls.find((row) => row.id === id)?.data ?? null;
  }

  async insertPoll(id: string, season: number, data: unknown, at: string): Promise<void> {
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      if (doc.polls.some((row) => row.id === id)) {
        throw new PollWriteError('duplicate', 'That vote already exists');
      }
      doc.polls.push({ id, season, data: structuredClone(data), updatedAt: at });
      this.writeDoc(doc);
    });
  }

  async updatePoll(id: string, mutate: (current: unknown) => unknown): Promise<unknown> {
    return this.enqueueWrite(() => {
      const doc = this.readDoc();
      const row = doc.polls.find((candidate) => candidate.id === id);
      if (!row) throw new PollWriteError('not-found', 'No such vote');
      row.data = mutate(row.data);
      row.updatedAt = new Date().toISOString();
      this.writeDoc(doc);
      return row.data;
    });
  }

  async clearPollsForSeason(season: number): Promise<void> {
    await this.enqueueWrite(() => {
      const doc = this.readDoc();
      doc.polls = doc.polls.filter((row) => row.season !== season);
      this.writeDoc(doc);
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

// ─── Sign-in links and sessions ──────────────────────────────────────────────

/**
 * Tokens are stored as a hash, so reading the table gives nobody a way in.
 * SHA-256 is right here because the input is 32 random bytes, not a password
 * someone could guess.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * The state poll asks who you are every few seconds. Without this, every tick
 * would be a database read for all ten members at once.
 */
const SESSION_CACHE_MS = 20_000;
const sessionCache = new Map<string, { row: SessionRow; readAt: number }>();

export async function getOwnerEmails(): Promise<OwnerEmailRow[]> {
  const rows = await getBackend().getOwnerEmails();
  const byOwner = new Map(rows.map((row) => [row.owner, row]));
  return OWNERS.map((owner) => byOwner.get(owner) ?? { owner, email: '', confirmedAt: null });
}

/**
 * The commissioner records an address for a member. Saving a new address drops
 * that member's sessions, so a mistyped or reassigned address cannot leave
 * someone signed in as the wrong person.
 */
export async function setOwnerEmail(
  owner: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isKnownOwner(owner)) return { ok: false, error: `Unknown owner: ${owner}` };
  const clean = normalizeEmail(email);
  if (clean !== '' && !isValidEmail(clean)) {
    return { ok: false, error: 'That does not look like an email address' };
  }
  const rows = await getBackend().getOwnerEmails();
  const taken = clean === '' ? null : emailTakenBy(rows, clean, owner);
  if (taken !== null) return { ok: false, error: `${taken} already uses that address` };
  await getBackend().setOwnerEmail(owner, clean, null);
  await getBackend().deleteSessionsForOwner(owner);
  for (const [key, entry] of sessionCache) {
    if (entry.row.owner === owner) sessionCache.delete(key);
  }
  return { ok: true };
}

export interface LinkIssue {
  ok: boolean;
  /** Present only when a link should be sent. Never logged, never stored raw. */
  token?: string;
  owner?: string;
  email?: string;
  expiresAt?: string;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Mint a sign-in link for an address.
 *
 * An address nobody owns returns ok with no token. The caller answers the same
 * either way, so the sign-in page cannot be used to find out who is in the
 * league.
 */
export async function issueLoginToken(email: string, now: Date): Promise<LinkIssue> {
  const clean = normalizeEmail(email);
  if (!isValidEmail(clean)) return { ok: false, reason: 'That does not look like an email address' };

  const since = new Date(now.getTime() - LINK_WINDOW_MINUTES * 60_000).toISOString();
  const recent = await getBackend().recentLoginTokens(clean, since);
  const decision = canRequestLink(recent, now);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason, retryAfterSeconds: decision.retryAfterSeconds };
  }

  const owner = ownerForEmail(await getBackend().getOwnerEmails(), clean);
  if (owner === null) return { ok: true };

  const token = newToken();
  const expiresAt = linkExpiresAt(now);
  await getBackend().createLoginToken({
    tokenHash: hashToken(token),
    email: clean,
    owner,
    issuedAt: now.toISOString(),
    expiresAt,
  });
  return { ok: true, token, owner, email: clean, expiresAt };
}

export interface SessionIssue {
  ok: boolean;
  session?: string;
  owner?: string;
  email?: string;
  isCommissioner?: boolean;
  expiresAt?: string;
  error?: string;
}

/** Spend a link and hand back a session. The link dies whether or not it worked. */
export async function consumeLoginToken(token: string, now: Date): Promise<SessionIssue> {
  if (typeof token !== 'string' || token === '') {
    return { ok: false, error: 'That sign-in link is not valid' };
  }
  const row = await getBackend().takeLoginToken(hashToken(token));
  if (row === null) return { ok: false, error: 'That sign-in link has already been used' };
  if (isExpired(row.expiresAt, now)) {
    return { ok: false, error: 'That sign-in link has expired. Ask for a new one.' };
  }
  if (!isKnownOwner(row.owner)) return { ok: false, error: 'That team is no longer in the league' };

  const session = newToken();
  const expiresAt = sessionExpiresAt(now);
  await getBackend().createSession({
    tokenHash: hashToken(session),
    owner: row.owner,
    email: row.email,
    issuedAt: now.toISOString(),
    expiresAt,
  });
  // First successful sign-in is what confirms the address really reaches them.
  await getBackend().setOwnerEmail(row.owner, row.email, now.toISOString());
  return {
    ok: true,
    session,
    owner: row.owner,
    email: row.email,
    isCommissioner: isCommissionerOwner(row.owner),
    expiresAt,
  };
}

/** How long the commissioner stays in someone else's seat before it lapses. */
const IMPERSONATION_HOURS = 8;

/**
 * Sign the commissioner in as another owner.
 *
 * The session it returns is that owner's session in every way that matters:
 * it grants exactly what they can do and nothing more, so acting as a member
 * never carries commissioner rights along with it. Both names are recorded,
 * and it lapses in hours rather than the usual month, because this is
 * something you do for a minute, not a season.
 */
export async function startImpersonation(
  commissioner: string,
  target: string,
  now: Date,
): Promise<SessionIssue> {
  if (!isCommissionerOwner(commissioner)) return { ok: false, error: 'Commissioner access required' };
  if (!isKnownOwner(target)) return { ok: false, error: `Unknown owner: ${target}` };
  if (target === commissioner) return { ok: false, error: 'You are already yourself' };

  const emails = await getBackend().getOwnerEmails();
  const email = emails.find((row) => row.owner === target)?.email ?? '';
  const session = newToken();
  const expiresAt = new Date(now.getTime() + IMPERSONATION_HOURS * 3600_000).toISOString();
  await getBackend().createSession({
    tokenHash: hashToken(session),
    owner: target,
    email,
    issuedAt: now.toISOString(),
    expiresAt,
    impersonatedBy: commissioner,
  });
  return {
    ok: true,
    session,
    owner: target,
    email,
    isCommissioner: isCommissionerOwner(target),
    expiresAt,
  };
}

export interface SessionCheck {
  ok: boolean;
  owner?: string;
  email?: string;
  isCommissioner?: boolean;
  /** Set when a commissioner is acting as this owner. */
  impersonatedBy?: string | null;
}

export async function verifySession(token: string, now: Date): Promise<SessionCheck> {
  if (typeof token !== 'string' || token === '') return { ok: false };
  const key = hashToken(token);

  const cached = sessionCache.get(key);
  if (cached && now.getTime() - cached.readAt < SESSION_CACHE_MS) {
    if (isExpired(cached.row.expiresAt, now)) {
      sessionCache.delete(key);
      return { ok: false };
    }
    return {
      ok: true,
      owner: cached.row.owner,
      email: cached.row.email,
      isCommissioner: isCommissionerOwner(cached.row.owner),
      impersonatedBy: cached.row.impersonatedBy ?? null,
    };
  }

  const row = await getBackend().getSession(key);
  if (row === null) return { ok: false };
  if (isExpired(row.expiresAt, now)) {
    await getBackend().deleteSession(key);
    sessionCache.delete(key);
    return { ok: false };
  }
  if (!isKnownOwner(row.owner)) return { ok: false };
  sessionCache.set(key, { row, readAt: now.getTime() });
  return {
    ok: true,
    owner: row.owner,
    email: row.email,
    isCommissioner: isCommissionerOwner(row.owner),
    impersonatedBy: row.impersonatedBy ?? null,
  };
}

export async function endSession(token: string): Promise<void> {
  if (typeof token !== 'string' || token === '') return;
  const key = hashToken(token);
  sessionCache.delete(key);
  await getBackend().deleteSession(key);
}

/** Housekeeping. Cheap enough to run on the sign-in routes. */
export async function purgeExpiredAuth(now: Date): Promise<void> {
  await getBackend().purgeExpiredAuth(now.toISOString());
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

export async function getRulebookDraft(season: number): Promise<RulebookDraftRow | null> {
  return getBackend().getRulebookDraft(season);
}

export async function saveRulebookDraft(
  season: number,
  book: unknown,
  expectedVersion: number,
  savedBy: string,
): Promise<RulebookDraftRow> {
  return getBackend().saveRulebookDraft(
    season,
    book,
    expectedVersion,
    new Date().toISOString(),
    savedBy,
  );
}

export async function deleteRulebookDraft(season: number): Promise<void> {
  return getBackend().deleteRulebookDraft(season);
}

// ─── League history ──────────────────────────────────────────────────────────

export async function getHistoryDraft(season: number): Promise<LeagueHistoryDraftRow | null> {
  return getBackend().getHistoryDraft(season);
}

export async function saveHistoryDraft(
  season: number,
  history: unknown,
  expectedVersion: number,
  savedBy: string,
): Promise<LeagueHistoryDraftRow> {
  return getBackend().saveHistoryDraft(
    season,
    history,
    expectedVersion,
    new Date().toISOString(),
    savedBy,
  );
}

export async function deleteHistoryDraft(season: number): Promise<void> {
  return getBackend().deleteHistoryDraft(season);
}

export async function publishHistoryVersion(
  row: LeagueHistoryVersionRow,
): Promise<LeagueHistoryVersionRow> {
  return getBackend().publishHistoryVersion(row);
}

export async function getLatestHistoryVersion(
  season: number,
): Promise<LeagueHistoryVersionRow | null> {
  return getBackend().getLatestHistoryVersion(season);
}

export async function getHistoryVersion(id: string): Promise<LeagueHistoryVersionRow | null> {
  return getBackend().getHistoryVersion(id);
}

export async function listHistoryVersions(
  season: number,
): Promise<Array<Omit<LeagueHistoryVersionRow, 'history'>>> {
  return getBackend().listHistoryVersions(season);
}

export async function listPolls(season: number): Promise<unknown[]> {
  return getBackend().listPolls(season);
}

/** Keys of every notification already sent this season. */
export async function listSentNotices(season: number): Promise<string[]> {
  return getBackend().listSentNotices(season);
}

/**
 * Take a notification key. True means it is yours to send; false means it has
 * already gone out and you must send nothing.
 */
export async function claimSentNotice(key: string, season: number): Promise<boolean> {
  return getBackend().claimSentNotice(key, season, new Date().toISOString());
}

export async function getPoll(id: string): Promise<unknown | null> {
  return getBackend().getPoll(id);
}

export async function insertPoll(id: string, season: number, data: unknown): Promise<void> {
  return getBackend().insertPoll(id, season, data, new Date().toISOString());
}

export async function updatePoll(
  id: string,
  mutate: (current: unknown) => unknown,
): Promise<unknown> {
  return getBackend().updatePoll(id, mutate);
}

/** Wipe a season's votes. Mirrors clearKeeperScenariosForSeason; used to reset a season. */
export async function clearPollsForSeason(season: number): Promise<void> {
  return getBackend().clearPollsForSeason(season);
}

export async function publishRulebookVersion(row: RulebookVersionRow): Promise<RulebookVersionRow> {
  return getBackend().publishRulebookVersion(row);
}

export async function getLatestRulebookVersion(season: number): Promise<RulebookVersionRow | null> {
  return getBackend().getLatestRulebookVersion(season);
}

export async function getRulebookVersion(id: string): Promise<RulebookVersionRow | null> {
  return getBackend().getRulebookVersion(id);
}

export async function listRulebookVersions(
  season: number,
): Promise<Array<Omit<RulebookVersionRow, 'book'>>> {
  return getBackend().listRulebookVersions(season);
}

export async function listRulebookSignatures(season: number): Promise<RulebookSignature[]> {
  return getBackend().listRulebookSignatures(season);
}

export async function insertRulebookSignature(
  row: RulebookSignature,
): Promise<RulebookSignature> {
  return getBackend().insertRulebookSignature(row);
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
