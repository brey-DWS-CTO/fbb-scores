/**
 * One check against ESPN for everything the commissioner pulls from it:
 * the player list, the draft ranks and projections, and the team names.
 *
 * Each of the three already has its own preview and its own accept, and they
 * stay separate on the server: this file only reads the three previews and
 * says, in a line each, what saving would change. The screen shows those
 * lines and saves whichever of them changed, in one tap.
 *
 * Pure. No server, no browser.
 */
import type { DraftRankingRefreshPreview } from './draftRankings.js';
import type { PlayerPoolRefreshPreview } from './playerPool.js';
import type { TeamNameRefreshPreview } from './teamNames.js';

export type SyncPart = 'players' | 'rankings' | 'teams';

export const SYNC_PARTS: readonly SyncPart[] = ['players', 'rankings', 'teams'];

export const SYNC_LABELS: Record<SyncPart, string> = {
  players: 'Players',
  rankings: 'Ranks and projections',
  teams: 'Team names',
};

export interface SyncSummary {
  part: SyncPart;
  /** Saving would change something. */
  changed: boolean;
  /** One plain sentence. */
  headline: string;
  /** Names worth reading before saving, a few at most. */
  details: string[];
  /** Things to know before saving that are not changes. */
  warnings: string[];
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A short list of names, with "and N more" when there are too many. */
export function nameList(names: readonly string[], limit = 8): string {
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

export function summarizePlayers(
  preview: Pick<PlayerPoolRefreshPreview, 'added' | 'removed' | 'retainedMissing' | 'nameChanged' | 'teamChanged' | 'positionChanged' | 'nextPlayers'>,
  ids: { currentSnapshotId: string; candidateSnapshotId: string },
  draftStarted = false,
): SyncSummary {
  const changed = ids.candidateSnapshotId !== ids.currentSnapshotId;
  const parts = [
    preview.added.length > 0 ? `${preview.added.length} new` : null,
    preview.removed.length > 0 ? `${preview.removed.length} gone` : null,
    preview.teamChanged.length > 0 ? `${preview.teamChanged.length} changed team` : null,
    preview.positionChanged.length > 0 ? `${preview.positionChanged.length} changed position` : null,
    preview.nameChanged.length > 0 ? `${plural(preview.nameChanged.length, 'name')} fixed` : null,
  ].filter((part): part is string => part !== null);

  const details: string[] = [];
  if (preview.added.length > 0) details.push(`New: ${nameList(preview.added.map((player) => player.fullName))}.`);
  if (preview.removed.length > 0) details.push(`Gone: ${nameList(preview.removed.map((player) => player.fullName))}.`);
  if (preview.teamChanged.length > 0) {
    details.push(`New team: ${nameList(preview.teamChanged.map((change) => `${change.fullName} (${String(change.after)})`))}.`);
  }

  const warnings: string[] = [];
  if (preview.retainedMissing.length > 0) {
    warnings.push(`ESPN left out ${nameList(preview.retainedMissing.map((player) => player.fullName))}. They stay, because a team holds them.`);
  }
  if (draftStarted) warnings.push('The draft has started, so the player list is locked.');

  return {
    part: 'players',
    changed: changed && !draftStarted,
    headline: !changed
      ? `No change. ${plural(preview.nextPlayers.length, 'player')}.`
      : parts.length > 0
        ? `${parts.join(', ')}. ${plural(preview.nextPlayers.length, 'player')} in all.`
        : `Small fixes only. ${plural(preview.nextPlayers.length, 'player')} in all.`,
    details,
    warnings,
  };
}

export function summarizeRankings(
  preview: Pick<DraftRankingRefreshPreview, 'counts' | 'previousCounts' | 'added' | 'removed' | 'moved' | 'projectionArrived' | 'scoringChanged' | 'nextScoringItems'>,
  ids: { currentSnapshotId: string; candidateSnapshotId: string },
): SyncSummary {
  const changed = ids.candidateSnapshotId !== ids.currentSnapshotId;
  const projectedGap = preview.counts.projected - preview.previousCounts.projected;
  const parts = [
    `${preview.counts.projected} projected${projectedGap > 0 ? ` (${projectedGap} more)` : ''}`,
    preview.moved.length > 0 ? plural(preview.moved.length, 'rank move') : null,
    preview.added.length > 0 ? `${preview.added.length} new` : null,
  ].filter((part): part is string => part !== null);

  const details: string[] = [];
  const bigMoves = preview.moved.slice(0, 5);
  if (bigMoves.length > 0) {
    details.push(`Biggest moves: ${bigMoves.map((move) => `${move.fullName} ${move.before} to ${move.after}`).join(', ')}.`);
  }

  const warnings: string[] = [];
  if (preview.nextScoringItems.length === 0) {
    warnings.push('ESPN sent no scoring, so projections cannot become points until it does.');
  } else if (preview.scoringChanged && preview.previousCounts.players > 0) {
    warnings.push('The league scoring on ESPN changed. Points will use the new scoring.');
  }

  return {
    part: 'rankings',
    changed,
    headline: changed ? `${parts.join(', ')}.` : `No change. ${preview.counts.projected} projected.`,
    details,
    warnings,
  };
}

export function summarizeTeams(preview: Pick<TeamNameRefreshPreview, 'changes' | 'missing'>): SyncSummary {
  const changed = preview.changes.length > 0;
  return {
    part: 'teams',
    changed,
    headline: changed ? `${plural(preview.changes.length, 'team')} renamed.` : 'No change.',
    details: preview.changes.map((change) => `${change.owner}: ${change.before} → ${change.after}`),
    warnings: preview.missing.length > 0
      ? [`ESPN sent nothing for ${nameList(preview.missing.map((row) => row.owner))}. Those names stay.`]
      : [],
  };
}

/** The parts a save would write, in the order they are saved. */
export function partsToSave(summaries: readonly (SyncSummary | null)[]): SyncPart[] {
  const changed = new Set(summaries.filter((summary): summary is SyncSummary => summary?.changed === true).map((summary) => summary.part));
  return SYNC_PARTS.filter((part) => changed.has(part));
}
