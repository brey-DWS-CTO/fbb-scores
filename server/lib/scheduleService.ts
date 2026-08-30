import { createHash } from 'node:crypto';
import rawSchedule from '../../src/data/source/basketball-monster-schedule-2027.json' with { type: 'json' };
import {
  DEFAULT_2027_LEAGUE_MAPPING,
  NBA_TEAMS,
  buildLeagueSchedule,
  normalizeScheduleSource,
  type LeagueScheduleMapping,
  type RawScheduleSource,
  type ScheduleRefreshPreview,
  type ScheduleSnapshot,
  type ScheduleSourceStatus,
  type StoredScheduleSnapshot,
} from '../../src/lib/league/schedule.js';
import { getScheduleSnapshot, type LeagueDynamicState } from './leagueStore.js';

export interface ScheduleCandidateInput {
  source: RawScheduleSource;
  mapping: LeagueScheduleMapping[];
  status: ScheduleSourceStatus;
}

export interface PreparedScheduleCandidate {
  currentSnapshot: StoredScheduleSnapshot;
  candidateSnapshot: ScheduleSnapshot;
  mapping: LeagueScheduleMapping[];
  preview: ScheduleRefreshPreview;
  fingerprint: string;
  snapshotId: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMapping(value: unknown): LeagueScheduleMapping[] {
  if (!Array.isArray(value)) throw new Error('mapping must be an array');
  return value.map((candidate, index): LeagueScheduleMapping => {
    const entry = record(candidate);
    if (!entry) throw new Error(`mapping[${index}] must be an object`);
    if (typeof entry.leagueWeek !== 'number' || !Number.isInteger(entry.leagueWeek)) {
      throw new Error(`mapping[${index}].leagueWeek must be an integer`);
    }
    if (typeof entry.label !== 'string' || entry.label.trim() === '') {
      throw new Error(`mapping[${index}].label is required`);
    }
    if (!['regular', 'fantasy-play-in', 'fantasy-playoff'].includes(String(entry.phase))) {
      throw new Error(`mapping[${index}].phase is invalid`);
    }
    if (
      !Array.isArray(entry.sourceNbaWeeks)
      || entry.sourceNbaWeeks.some((week) => typeof week !== 'number' || !Number.isInteger(week))
    ) {
      throw new Error(`mapping[${index}].sourceNbaWeeks must contain integers`);
    }
    if (entry.playoffRound !== undefined && entry.playoffRound !== 1 && entry.playoffRound !== 2) {
      throw new Error(`mapping[${index}].playoffRound must be 1 or 2`);
    }
    return {
      leagueWeek: entry.leagueWeek,
      label: entry.label.trim(),
      phase: entry.phase as LeagueScheduleMapping['phase'],
      sourceNbaWeeks: [...entry.sourceNbaWeeks] as number[],
      ...(entry.playoffRound === 1 || entry.playoffRound === 2
        ? { playoffRound: entry.playoffRound }
        : {}),
    };
  });
}

export function parseScheduleCandidate(value: unknown): ScheduleCandidateInput {
  const body = record(value);
  if (!body) throw new Error('Request body must be an object');
  if (body.status !== 'provisional' && body.status !== 'final') {
    throw new Error('status must be provisional or final');
  }
  const candidateSnapshot = normalizeScheduleSource(body.source, body.status);
  const mapping = parseMapping(body.mapping);
  buildLeagueSchedule(candidateSnapshot, mapping);
  return {
    source: body.source as unknown as RawScheduleSource,
    mapping,
    status: body.status,
  };
}

function fingerprint(snapshot: ScheduleSnapshot, mapping: readonly LeagueScheduleMapping[]): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ snapshot, mapping }))
    .digest('hex');
  return `sha256:${hash}`;
}

function acceptedSnapshotId(contentFingerprint: string): string {
  const start = 'sha256:'.length;
  return `sch-2027-${contentFingerprint.slice(start, start + 24)}`;
}

const fallbackSnapshot = normalizeScheduleSource(rawSchedule, 'provisional');
const fallbackPeriods = buildLeagueSchedule(fallbackSnapshot, DEFAULT_2027_LEAGUE_MAPPING);
const fallbackFingerprint = fingerprint(fallbackSnapshot, DEFAULT_2027_LEAGUE_MAPPING);

export const FALLBACK_SCHEDULE: StoredScheduleSnapshot = {
  ...fallbackSnapshot,
  id: 'schedule-fixture-2027',
  createdAt: fallbackSnapshot.capturedAt,
  createdBy: 'system',
  baseSnapshotId: null,
  fingerprint: fallbackFingerprint,
  leaguePeriods: fallbackPeriods,
};

export async function resolveCurrentSchedule(
  state: LeagueDynamicState,
): Promise<StoredScheduleSnapshot> {
  const activeId = state.schedule?.activeSnapshotId;
  if (!activeId) return FALLBACK_SCHEDULE;
  const snapshot = await getScheduleSnapshot(activeId);
  if (!snapshot) throw new Error(`Active schedule snapshot is missing: ${activeId}`);
  return snapshot;
}

function previewSchedule(
  current: StoredScheduleSnapshot,
  candidatePeriods: StoredScheduleSnapshot['leaguePeriods'],
): ScheduleRefreshPreview {
  const currentByWeek = new Map(current.leaguePeriods.map((period) => [period.leagueWeek, period]));
  const changedTeamPeriods: ScheduleRefreshPreview['changedTeamPeriods'] = [];
  const changedMappings: ScheduleRefreshPreview['changedMappings'] = [];

  for (const period of candidatePeriods) {
    const before = currentByWeek.get(period.leagueWeek);
    if (!before) continue;
    if (before.sourceNbaWeeks.join(',') !== period.sourceNbaWeeks.join(',')) {
      changedMappings.push({
        leagueWeek: period.leagueWeek,
        beforeSourceNbaWeeks: [...before.sourceNbaWeeks],
        afterSourceNbaWeeks: [...period.sourceNbaWeeks],
      });
    }
    for (const team of NBA_TEAMS) {
      const beforeGames = before.gamesByTeamId[team.espnId];
      const afterGames = period.gamesByTeamId[team.espnId];
      if (beforeGames !== afterGames) {
        changedTeamPeriods.push({
          leagueWeek: period.leagueWeek,
          teamId: team.espnId,
          teamCode: team.code,
          before: beforeGames,
          after: afterGames,
        });
      }
    }
  }
  return { changedTeamPeriods, changedMappings };
}

export async function prepareScheduleCandidate(
  state: LeagueDynamicState,
  candidate: ScheduleCandidateInput,
): Promise<PreparedScheduleCandidate> {
  const currentSnapshot = await resolveCurrentSchedule(state);
  const candidateSnapshot = normalizeScheduleSource(candidate.source, candidate.status);
  const leaguePeriods = buildLeagueSchedule(candidateSnapshot, candidate.mapping);
  const contentFingerprint = fingerprint(candidateSnapshot, candidate.mapping);
  return {
    currentSnapshot,
    candidateSnapshot,
    mapping: candidate.mapping,
    preview: previewSchedule(currentSnapshot, leaguePeriods),
    fingerprint: contentFingerprint,
    snapshotId: acceptedSnapshotId(contentFingerprint),
  };
}

export function makeScheduleSnapshot(
  prepared: PreparedScheduleCandidate,
  createdAt: string,
  createdBy: string,
): StoredScheduleSnapshot {
  return {
    ...prepared.candidateSnapshot,
    id: prepared.snapshotId,
    createdAt,
    createdBy,
    baseSnapshotId: prepared.currentSnapshot.id,
    fingerprint: prepared.fingerprint,
    leaguePeriods: buildLeagueSchedule(prepared.candidateSnapshot, prepared.mapping),
  };
}
