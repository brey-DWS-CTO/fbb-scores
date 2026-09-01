/**
 * League-history storage service: resolving the current document, reading a
 * candidate ESPN season, and preparing an import the commissioner can look at
 * before anything is written.
 *
 * The rule math lives in `src/lib/league/history.ts` and the ESPN parsing in
 * `historyImport.ts`. This file only fetches, checks request shapes, and joins
 * the two, exactly as `scheduleService.ts` and `playerPoolService.ts` do.
 */
import rawHistory from '../../src/data/source/league-history-2027.json' with { type: 'json' };
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  diffHistories,
  historyFingerprint,
  mergeSeasonImport,
  validateHistory,
  type HistoryConflict,
  type HistoryDiff,
  type HistoryProblem,
  type LeagueHistory,
} from '../../src/lib/league/history.js';
import {
  parseEspnSeason,
  type EspnSeasonPayload,
  type ImportProblem,
  type SeasonImportOptions,
  type TeamMapping,
} from '../../src/lib/league/historyImport.js';
import { getHistoryDraft, getLatestHistoryVersion } from './leagueStore.js';

export const FALLBACK_HISTORY = rawHistory as unknown as LeagueHistory;
export const HISTORY_SEASON: number = FALLBACK_HISTORY.season;

/** Rough ceiling on a stored document, so a broken client cannot fill the table. */
export const MAX_HISTORY_BYTES = 2_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Enough of a shape check to refuse junk before it reaches the database. */
export function parseHistoryDocument(value: unknown): LeagueHistory {
  const body = record(value);
  if (!body) throw new Error('history must be an object');
  for (const key of ['franchises', 'seasons', 'records', 'recordCategories', 'conflicts']) {
    if (!Array.isArray(body[key])) throw new Error(`history.${key} must be an array`);
  }
  if (body.season !== HISTORY_SEASON) {
    throw new Error(`history is for season ${String(body.season)}, expected ${HISTORY_SEASON}`);
  }
  if (JSON.stringify(body).length > MAX_HISTORY_BYTES) {
    throw new Error('That history document is too large to store');
  }
  return body as unknown as LeagueHistory;
}

export interface PublishedHistory {
  history: LeagueHistory;
  versionId: string | null;
  revision: number;
  publishedAt: string | null;
  publishedBy: string | null;
  notes: string;
  reason: string;
  published: boolean;
}

/** What everyone reads: the newest published revision, or the committed seed. */
export async function resolvePublishedHistory(): Promise<PublishedHistory> {
  const latest = await getLatestHistoryVersion(HISTORY_SEASON);
  if (!latest) {
    return {
      history: FALLBACK_HISTORY,
      versionId: null,
      revision: FALLBACK_HISTORY.revision,
      publishedAt: null,
      publishedBy: null,
      notes: '',
      reason: '',
      published: false,
    };
  }
  return {
    history: latest.history as LeagueHistory,
    versionId: latest.id,
    revision: latest.revision,
    publishedAt: latest.publishedAt,
    publishedBy: latest.publishedBy,
    notes: latest.notes,
    reason: latest.reason,
    published: true,
  };
}

/** The commissioner's working copy: the stored draft, or what is published. */
export async function resolveHistoryDraft(): Promise<{
  history: LeagueHistory;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  seeded: boolean;
}> {
  const row = await getHistoryDraft(HISTORY_SEASON);
  if (row) {
    return {
      history: row.history as LeagueHistory,
      version: row.version,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      seeded: false,
    };
  }
  const published = await resolvePublishedHistory();
  return {
    history: { ...published.history, status: 'draft' },
    version: 0,
    updatedAt: null,
    updatedBy: null,
    seeded: true,
  };
}

// ─── ESPN seam ───────────────────────────────────────────────────────────────

/**
 * Pull one past season from ESPN.
 *
 * This is the only place that talks to ESPN for history. Credentials live in
 * Vercel and nowhere else, so every caller must handle this throwing.
 */
export async function fetchEspnSeasonPayload(espnSeasonId: number): Promise<EspnSeasonPayload> {
  const { ESPN_LEAGUE_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) throw new Error('ESPN_LEAGUE_ID is not configured');
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) {
    throw new Error('ESPN credentials are not configured');
  }
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID,
    seasonId: espnSeasonId,
    espnS2: ESPN_S2,
    swid: ESPN_SWID,
    cookieOverride: ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
  });
  const payload = await client.fetchSeasonHistory();
  const body = record(payload);
  if (!body) throw new Error(`ESPN returned nothing usable for season ${espnSeasonId}`);
  return body as unknown as EspnSeasonPayload;
}

// ─── Import preview ──────────────────────────────────────────────────────────

export interface ImportRequest {
  seasonNumber: number;
  espnSeasonId: number;
  teamMap: TeamMapping[];
  /** A payload the commissioner supplied instead of a live pull. */
  payload?: EspnSeasonPayload;
}

export interface PreparedImport {
  base: LeagueHistory;
  candidate: LeagueHistory;
  diff: HistoryDiff;
  conflicts: HistoryConflict[];
  problems: HistoryProblem[];
  importProblems: ImportProblem[];
  espnTeams: Array<{ espnTeamId: number; name: string; finalRank: number | null }>;
  fingerprint: string;
  /** True when nothing may be written from this import. */
  blocked: boolean;
}

const WEEKLY_CATEGORY = 'weekly-high-score';
/** Matches the category's criteria: 1200 points, 30-game weeks only. */
const RECORD_MINIMUM = 1200;

export function parseImportRequest(value: unknown): ImportRequest {
  const body = record(value);
  if (!body) throw new Error('Request body must be an object');
  const seasonNumber = body.seasonNumber;
  if (typeof seasonNumber !== 'number' || !Number.isInteger(seasonNumber) || seasonNumber < 1) {
    throw new Error('seasonNumber must be a whole number of 1 or more');
  }
  const espnSeasonId = body.espnSeasonId;
  if (typeof espnSeasonId !== 'number' || !Number.isInteger(espnSeasonId) || espnSeasonId < 2000) {
    throw new Error('espnSeasonId must be the year the season ends');
  }
  if (!Array.isArray(body.teamMap)) throw new Error('teamMap must be an array');
  const teamMap = body.teamMap.map((entry, index): TeamMapping => {
    const mapping = record(entry);
    if (!mapping) throw new Error(`teamMap[${index}] must be an object`);
    if (typeof mapping.espnTeamId !== 'number' || !Number.isInteger(mapping.espnTeamId)) {
      throw new Error(`teamMap[${index}].espnTeamId must be a whole number`);
    }
    if (typeof mapping.franchiseId !== 'string' || mapping.franchiseId.trim() === '') {
      throw new Error(`teamMap[${index}].franchiseId is required`);
    }
    return {
      espnTeamId: mapping.espnTeamId,
      franchiseId: mapping.franchiseId.trim(),
      ...(typeof mapping.ownerName === 'string' && mapping.ownerName.trim() !== ''
        ? { ownerName: mapping.ownerName.trim() }
        : {}),
    };
  });
  const payload = record(body.payload);
  return {
    seasonNumber,
    espnSeasonId,
    teamMap,
    ...(payload ? { payload: payload as unknown as EspnSeasonPayload } : {}),
  };
}

/**
 * Read an ESPN season, fold it into the draft, and report everything that
 * would change. Writes nothing.
 */
export function prepareSeasonImport(
  base: LeagueHistory,
  payload: EspnSeasonPayload,
  request: ImportRequest,
  fetchedAt: string,
  live: boolean,
): PreparedImport {
  const existing = base.seasons.find((season) => season.seasonNumber === request.seasonNumber);
  const startYear = existing?.startYear ?? request.espnSeasonId - 1;
  const options: SeasonImportOptions = {
    seasonNumber: request.seasonNumber,
    label: existing?.label ?? `${startYear}-${request.espnSeasonId}`,
    startYear,
    endYear: request.espnSeasonId,
    espnSeasonId: request.espnSeasonId,
    teamMap: request.teamMap,
    categoryId: WEEKLY_CATEGORY,
    recordMinimum: RECORD_MINIMUM,
    basis: 'raw',
    fetchedAt,
    ...(live ? {} : { sourceReference: `espn payload supplied by the commissioner, season ${request.espnSeasonId}` }),
  };

  const parsed = parseEspnSeason(payload, options);
  if (!parsed.seasonImport) {
    return {
      base,
      candidate: base,
      diff: { changes: [], identical: true },
      conflicts: [],
      problems: [],
      importProblems: parsed.problems,
      espnTeams: parsed.espnTeams,
      fingerprint: historyFingerprint(base),
      blocked: true,
    };
  }

  const merged = mergeSeasonImport(base, parsed.seasonImport);
  const candidate: LeagueHistory = { ...merged.history, status: 'draft' };
  return {
    base,
    candidate,
    diff: diffHistories(base, candidate),
    conflicts: merged.conflicts,
    problems: validateHistory(candidate),
    importProblems: parsed.problems,
    espnTeams: parsed.espnTeams,
    fingerprint: historyFingerprint(candidate),
    blocked: false,
  };
}
