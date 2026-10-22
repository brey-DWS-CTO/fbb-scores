import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDraftRankings, fetchExpertProjections, fetchProjectionEdits, fetchProjectionFills } from '../lib/league/api.js';
import { applyProjectionSource, fillProjectionGaps, sourceLabel, type ProjectionSource } from '../lib/league/expertProjections.js';
import { applyProjectionEdits, editsById, type ProjectionEdits } from '../lib/league/projectionEdits.js';
import type { DraftRankingSnapshot } from '../lib/league/draftRankings.js';
import { useIdentity, useLeagueState } from './useLeague.js';
import { useProjectionSource } from './useProjectionSource.js';

export const PROJECTION_EDITS_KEY = ['projection-edits'] as const;

/**
 * ESPN's accepted rankings with your own projection edits laid on
 * top. Every page that values players reads this, so an edit shows up in
 * projections, the mock draft and the draft room alike. The commissioner can
 * swap ESPN's lines for Hashtag's, or a blend, before the edits go on.
 */
export function useProjectionData(enabled = true): {
  /** The snapshot with edits applied. */
  snapshot: DraftRankingSnapshot | null;
  /** The chosen source's numbers before any edit. */
  original: DraftRankingSnapshot | null;
  /**
   * ESPN's numbers, with its blanks filled from Hashtag, and no source swap
   * and no edits. The same on every phone, so anything two phones must agree
   * on (a mock replayed on each phone) reads this, never `snapshot`.
   */
  espn: DraftRankingSnapshot | null;
  edits: ProjectionEdits;
  /** Where the lines come from: ESPN for everyone but the commissioner. */
  source: ProjectionSource;
  /** The commissioner's other source, unedited, for the VS column: Hashtag on ESPN, ESPN otherwise. */
  compare: DraftRankingSnapshot | null;
  compareLabel: string;
  loading: boolean;
} {
  const { identity } = useIdentity();
  const { meta } = useLeagueState();
  // Every signed-in owner reads the numbers. The edits are each owner's own,
  // so the cache keeps one copy per owner.
  const signedIn = enabled && identity !== null && !identity.isGuest;
  const rankings = useQuery({
    queryKey: ['mock-draft-rankings', identity?.owner ?? 'anon', meta?.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: signedIn,
    staleTime: 30_000,
  });
  const editsQuery = useQuery({
    queryKey: [...PROJECTION_EDITS_KEY, identity?.owner ?? 'anon'],
    queryFn: () => fetchProjectionEdits(identity as NonNullable<typeof identity>),
    enabled: signedIn,
    staleTime: 30_000,
  });
  const source = useProjectionSource();
  const expertQuery = useQuery({
    queryKey: ['expert-projections', identity?.owner ?? 'anon'],
    queryFn: () => fetchExpertProjections(identity as NonNullable<typeof identity>),
    // The commissioner always loads it: on ESPN it is the other side of his VS column.
    enabled: signedIn && identity?.isCommissioner === true,
    staleTime: Infinity,
  });
  // Players ESPN lists but does not project get Hashtag's line, for everyone.
  const fillsQuery = useQuery({
    queryKey: ['projection-fills', identity?.owner ?? 'anon', meta?.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchProjectionFills(identity as NonNullable<typeof identity>),
    enabled: signedIn,
    staleTime: Infinity,
  });
  const rawEspn = rankings.data?.snapshot ?? null;
  const fills = fillsQuery.data ?? null;
  const espn = useMemo(() => (rawEspn ? fillProjectionGaps(rawEspn, fills) : null), [rawEspn, fills]);
  const expert = expertQuery.data ?? null;
  const original = useMemo(() => (espn ? applyProjectionSource(espn, expert, source) : null), [espn, expert, source]);
  const edits = useMemo(() => editsById(editsQuery.data ?? []), [editsQuery.data]);
  const snapshot = useMemo(() => (original ? applyProjectionEdits(original, edits) : null), [original, edits]);
  const onEspn = !expert || source === 'espn';
  const compare = useMemo(
    () => (!espn || !expert ? null : onEspn ? applyProjectionSource(espn, expert, 'hashtag') : espn),
    [espn, expert, onEspn],
  );
  return {
    snapshot,
    original,
    espn,
    edits,
    source: expert ? source : 'espn',
    compare,
    compareLabel: sourceLabel(onEspn ? 'hashtag' : 'espn'),
    loading: rankings.isLoading || editsQuery.isLoading || expertQuery.isLoading || fillsQuery.isLoading,
  };
}
