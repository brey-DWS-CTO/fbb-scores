/**
 * Refresh ESPN's draft rankings the way the player pool is refreshed: fetch a
 * candidate, show the commissioner every change, write only when they accept,
 * store it immutable with a fingerprint.
 *
 * One difference from the pool, on purpose: a ranking snapshot may still be
 * accepted after the draft starts. The pool decides who can be drafted, so it
 * freezes. A ranking decides nothing; it only orders a list, and a fresh ADP
 * on draft day is worth having.
 */
import { createHash } from 'node:crypto';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  previewDraftRankingRefresh,
  projectionStatId,
  type DraftRankEntry,
  type DraftRankingRefreshPreview,
  type DraftRankingSnapshot,
  type DraftRankingSource,
  type EspnDraftRankingPlayer,
  type ProjectionRow,
  type ScoringItem,
} from '../../src/lib/league/draftRankings.js';
import { getDraftRankingSnapshot, type LeagueDynamicState } from './leagueStore.js';

const dataset = rawDataset as unknown as LeagueDataset;
const MIN_PLAYER_COUNT = 100;
const MAX_PLAYER_COUNT = 3_000;
const MAX_SCORING_ITEMS = 100;
const MAX_STAT_KEYS = 100;
const MAX_SOURCE_URL = 500;

/** The two sources a candidate may claim. `none` is only ever the fallback. */
type CandidateSource = Exclude<DraftRankingSource, 'none'>;

export interface DraftRankingCandidate {
  sourceSeason: number;
  /** Absent means the live ESPN fetch. A hand-loaded set says `manual`. */
  source: CandidateSource;
  sourceUrl: string | null;
  fetchedAt: string;
  scoringItems: ScoringItem[];
  players: EspnDraftRankingPlayer[];
}

export interface PreparedDraftRankingCandidate {
  currentSnapshot: DraftRankingSnapshot;
  preview: DraftRankingRefreshPreview;
  fingerprint: string;
  snapshotId: string;
}

function contentFingerprint(
  source: DraftRankingSource,
  sourceUrl: string | null,
  sourceSeason: number,
  scoringItems: ScoringItem[],
  players: DraftRankingSnapshot['players'],
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      season: dataset.season,
      source,
      sourceUrl,
      sourceSeason,
      projectionStatId: projectionStatId(sourceSeason),
      scoringItems,
      players,
    }))
    .digest('hex');
  return `sha256:${hash}`;
}

function snapshotId(fingerprint: string): string {
  return `dr-${dataset.season}-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

/**
 * What stands before the commissioner accepts anything: no ESPN numbers at
 * all. The board then orders on last season, which the ordering handles by
 * itself. There is no committed ranking data to fall back on and there should
 * not be: a rank is a forecast, and a forecast in git goes stale unseen.
 */
export const FALLBACK_DRAFT_RANKINGS: DraftRankingSnapshot = {
  id: `none-${dataset.season}`,
  season: dataset.season,
  sourceSeason: dataset.season,
  source: 'none',
  sourceUrl: null,
  fetchedAt: dataset.generatedAt,
  createdAt: dataset.generatedAt,
  createdBy: 'system',
  baseSnapshotId: null,
  fingerprint: contentFingerprint('none', null, dataset.season, [], []),
  projectionStatId: projectionStatId(dataset.season),
  scoringItems: [],
  players: [],
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number or null`);
  }
  return value;
}

function parseRankEntry(value: unknown, field: string): DraftRankEntry | null {
  if (value === undefined || value === null) return null;
  const entry = record(value);
  if (!entry) throw new Error(`${field} must be an object or null`);
  if (typeof entry.rank !== 'number' || !Number.isFinite(entry.rank)) {
    throw new Error(`${field}.rank must be a number`);
  }
  return { rank: entry.rank, auctionValue: optionalNumber(entry.auctionValue, `${field}.auctionValue`) };
}

function parseStatDict(value: unknown, field: string): Record<string, number> {
  const dict = record(value);
  if (!dict) throw new Error(`${field} must be an object`);
  const keys = Object.keys(dict);
  if (keys.length > MAX_STAT_KEYS) throw new Error(`${field} has too many keys`);
  const out: Record<string, number> = {};
  for (const key of keys) {
    const number = dict[key];
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      throw new Error(`${field}.${key} must be a number`);
    }
    out[key] = number;
  }
  return out;
}

function parseProjection(value: unknown, field: string): ProjectionRow | null {
  if (value === undefined || value === null) return null;
  const row = record(value);
  if (!row) throw new Error(`${field} must be an object or null`);
  if (typeof row.id !== 'string' || row.id.trim() === '') throw new Error(`${field}.id is required`);
  return {
    id: row.id,
    stats: parseStatDict(row.stats ?? {}, `${field}.stats`),
    averageStats: row.averageStats === undefined || row.averageStats === null
      ? null
      : parseStatDict(row.averageStats, `${field}.averageStats`),
  };
}

function parseScoringItems(value: unknown): ScoringItem[] {
  if (!Array.isArray(value)) throw new Error('scoringItems must be an array');
  if (value.length > MAX_SCORING_ITEMS) throw new Error('scoringItems has too many entries');
  return value.map((valueAtIndex, index): ScoringItem => {
    const item = record(valueAtIndex);
    if (!item) throw new Error(`scoringItems[${index}] must be an object`);
    if (typeof item.statId !== 'number' || !Number.isInteger(item.statId)) {
      throw new Error(`scoringItems[${index}].statId must be a whole number`);
    }
    if (typeof item.points !== 'number' || !Number.isFinite(item.points)) {
      throw new Error(`scoringItems[${index}].points must be a number`);
    }
    return { statId: item.statId, points: item.points };
  });
}

export function parseDraftRankingCandidate(value: unknown): DraftRankingCandidate {
  const body = record(value);
  if (!body) throw new Error('Request body must be an object');

  const sourceSeason = body.sourceSeason;
  if (
    typeof sourceSeason !== 'number'
    || !Number.isInteger(sourceSeason)
    || sourceSeason !== dataset.season
  ) {
    throw new Error(`sourceSeason must be ${dataset.season}`);
  }

  if (typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt))) {
    throw new Error('fetchedAt must be an ISO date-time');
  }
  const fetchedAt = new Date(body.fetchedAt).toISOString();

  const source: CandidateSource = body.source === undefined ? 'espn-kona' : body.source as CandidateSource;
  if (source !== 'espn-kona' && source !== 'manual') {
    throw new Error('source must be espn-kona or manual');
  }
  let sourceUrl: string | null = null;
  if (body.sourceUrl !== undefined && body.sourceUrl !== null) {
    if (typeof body.sourceUrl !== 'string' || body.sourceUrl.trim().length > MAX_SOURCE_URL) {
      throw new Error('sourceUrl must be text');
    }
    sourceUrl = body.sourceUrl.trim() || null;
  }
  const scoringItems = parseScoringItems(body.scoringItems ?? []);

  if (!Array.isArray(body.players)) throw new Error('players must be an array');
  if (body.players.length < MIN_PLAYER_COUNT || body.players.length > MAX_PLAYER_COUNT) {
    throw new Error(`players must contain ${MIN_PLAYER_COUNT}-${MAX_PLAYER_COUNT} entries`);
  }

  const players = body.players.map((valueAtIndex, index): EspnDraftRankingPlayer => {
    const player = record(valueAtIndex);
    if (!player) throw new Error(`players[${index}] must be an object`);
    if (typeof player.espnId !== 'number' || !Number.isInteger(player.espnId) || player.espnId <= 0) {
      throw new Error(`players[${index}].espnId must be a positive integer`);
    }
    if (typeof player.fullName !== 'string' || player.fullName.trim().length === 0) {
      throw new Error(`players[${index}].fullName is required`);
    }
    if (typeof player.proTeam !== 'string' || player.proTeam.trim().length === 0) {
      throw new Error(`players[${index}].proTeam is required`);
    }
    const field = `players[${index}]`;
    return {
      espnId: player.espnId,
      fullName: player.fullName,
      proTeam: player.proTeam,
      adp: optionalNumber(player.adp, `${field}.adp`),
      percentOwned: optionalNumber(player.percentOwned, `${field}.percentOwned`),
      standard: parseRankEntry(player.standard, `${field}.standard`),
      roto: parseRankEntry(player.roto, `${field}.roto`),
      projection: parseProjection(player.projection, `${field}.projection`),
    };
  });

  return { sourceSeason, source, sourceUrl, fetchedAt, scoringItems, players };
}

export async function resolveCurrentDraftRankings(
  state: LeagueDynamicState,
): Promise<DraftRankingSnapshot> {
  const activeId = state.draftRankings?.activeSnapshotId;
  if (!activeId) return FALLBACK_DRAFT_RANKINGS;
  const snapshot = await getDraftRankingSnapshot(activeId);
  if (!snapshot) {
    throw new Error(`Active draft-ranking snapshot is missing: ${activeId}`);
  }
  return snapshot;
}

export async function fetchEspnDraftRankingCandidate(): Promise<DraftRankingCandidate> {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) throw new Error('ESPN_LEAGUE_ID is not configured');
  const sourceSeason = ESPN_SEASON_ID ? Number.parseInt(ESPN_SEASON_ID, 10) : dataset.season;
  if (sourceSeason !== dataset.season) {
    throw new Error(`ESPN_SEASON_ID must be ${dataset.season} before refreshing draft rankings`);
  }
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) {
    throw new Error('ESPN credentials are not configured');
  }
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID,
    seasonId: sourceSeason,
    espnS2: ESPN_S2,
    swid: ESPN_SWID,
    cookieOverride: ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
  });
  const [players, scoringItems] = await Promise.all([
    client.fetchDraftRankings(sourceSeason),
    client.fetchScoringItems(),
  ]);
  return parseDraftRankingCandidate({
    sourceSeason,
    source: 'espn-kona',
    sourceUrl: null,
    fetchedAt: new Date().toISOString(),
    scoringItems,
    players,
  });
}

export async function prepareDraftRankingCandidate(
  state: LeagueDynamicState,
  candidate: DraftRankingCandidate,
): Promise<PreparedDraftRankingCandidate> {
  const currentSnapshot = await resolveCurrentDraftRankings(state);
  const preview = previewDraftRankingRefresh(currentSnapshot, candidate.players, candidate.scoringItems);
  const fingerprint = contentFingerprint(
    candidate.source,
    candidate.sourceUrl,
    candidate.sourceSeason,
    preview.nextScoringItems,
    preview.nextPlayers,
  );
  return {
    currentSnapshot,
    preview,
    fingerprint,
    snapshotId: snapshotId(fingerprint),
  };
}

export function makeDraftRankingSnapshot(
  candidate: DraftRankingCandidate,
  prepared: PreparedDraftRankingCandidate,
  createdAt: string,
  createdBy: string,
): DraftRankingSnapshot {
  return {
    id: prepared.snapshotId,
    season: dataset.season,
    sourceSeason: candidate.sourceSeason,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    fetchedAt: candidate.fetchedAt,
    createdAt,
    createdBy,
    baseSnapshotId: prepared.currentSnapshot.id,
    fingerprint: prepared.fingerprint,
    projectionStatId: projectionStatId(candidate.sourceSeason),
    scoringItems: prepared.preview.nextScoringItems,
    players: prepared.preview.nextPlayers,
  };
}
