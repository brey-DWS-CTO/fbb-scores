import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDraftRankings, fetchExpertProjections, fetchProjectionEdits } from '../lib/league/api.js';
import { applyProjectionSource, type ProjectionSource } from '../lib/league/expertProjections.js';
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
  edits: ProjectionEdits;
  /** Where the lines come from: ESPN for everyone but the commissioner. */
  source: ProjectionSource;
  loading: boolean;
} {
  const { identity } = useIdentity();
  const { meta } = useLeagueState();
  // Every signed-in owner reads the numbers. The edits are each owner's own,
  // so the cache keeps one copy per owner.
  const signedIn = enabled && identity !== null;
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
    enabled: signedIn && source !== 'espn',
    staleTime: Infinity,
  });
  const espn = rankings.data?.snapshot ?? null;
  const expert = expertQuery.data ?? null;
  const original = useMemo(() => (espn ? applyProjectionSource(espn, expert, source) : null), [espn, expert, source]);
  const edits = useMemo(() => editsById(editsQuery.data ?? []), [editsQuery.data]);
  const snapshot = useMemo(() => (original ? applyProjectionEdits(original, edits) : null), [original, edits]);
  return {
    snapshot,
    original,
    edits,
    source: expert ? source : 'espn',
    loading: rankings.isLoading || editsQuery.isLoading || expertQuery.isLoading,
  };
}
