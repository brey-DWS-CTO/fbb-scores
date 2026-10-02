import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDraftRankings, fetchProjectionEdits } from '../lib/league/api.js';
import { applyProjectionEdits, editsById, type ProjectionEdits } from '../lib/league/projectionEdits.js';
import type { DraftRankingSnapshot } from '../lib/league/draftRankings.js';
import { useIdentity, useLeagueState } from './useLeague.js';

export const PROJECTION_EDITS_KEY = ['projection-edits'] as const;

/**
 * ESPN's accepted rankings with the commissioner's projection edits laid on
 * top. Every page that values players reads this, so an edit shows up in
 * projections, the mock draft and the draft room alike.
 */
export function useProjectionData(): {
  /** The snapshot with edits applied. */
  snapshot: DraftRankingSnapshot | null;
  /** ESPN's numbers before any edit. */
  original: DraftRankingSnapshot | null;
  edits: ProjectionEdits;
  loading: boolean;
} {
  const { identity } = useIdentity();
  const { meta } = useLeagueState();
  const isCommish = identity?.isCommissioner === true;
  const rankings = useQuery({
    queryKey: ['mock-draft-rankings', identity?.owner ?? 'anon', meta?.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 30_000,
  });
  const editsQuery = useQuery({
    queryKey: PROJECTION_EDITS_KEY,
    queryFn: () => fetchProjectionEdits(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 30_000,
  });
  const original = rankings.data?.snapshot ?? null;
  const edits = useMemo(() => editsById(editsQuery.data ?? []), [editsQuery.data]);
  const snapshot = useMemo(() => (original ? applyProjectionEdits(original, edits) : null), [original, edits]);
  return { snapshot, original, edits, loading: rankings.isLoading || editsQuery.isLoading };
}
