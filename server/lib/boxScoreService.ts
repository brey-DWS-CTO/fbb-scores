/**
 * Box scores for house parties, from ESPN's public game summary. One read a
 * game, kept for a minute and a half while the game runs and for a quarter
 * of an hour once it is final. A party card asks every minute, and ten
 * phones on the same party should cost ESPN one call, not ten.
 */
import type { BoxScore } from '../../src/lib/league/partyScore.js';
import { forgetNbaSummaries, getNbaSummary } from './nbaSummaryService.js';

const KEEP_LIVE_MS = 90 * 1000;
const KEEP_FINAL_MS = 15 * 60 * 1000;

interface Kept {
  at: number;
  box: BoxScore | null;
}

const kept = new Map<string, Kept>();
/** Tests pin box scores so no run ever asks ESPN. */
let pinned = false;

function fresh(entry: Kept, now: number): boolean {
  if (pinned) return true;
  const keep = entry.box?.state === 'post' ? KEEP_FINAL_MS : KEEP_LIVE_MS;
  return now - entry.at < keep;
}


export interface BoxScoreRead {
  boxScores: BoxScore[];
  /** What went wrong, if any game could not be read. */
  error: string | null;
}

/** The box score for each game, from the last read where it is fresh enough. */
export async function getBoxScores(gameIds: readonly string[], now = new Date(Date.now())): Promise<BoxScoreRead> {
  let reason = '';
  const boxScores: BoxScore[] = [];
  await Promise.all(gameIds.map(async (gameId) => {
    const entry = kept.get(gameId);
    if (entry && fresh(entry, now.getTime())) {
      if (entry.box) boxScores.push(entry.box);
      return;
    }
    if (pinned) return;
    try {
      const { box } = await getNbaSummary(gameId, now.getTime());
      kept.set(gameId, { at: now.getTime(), box });
      if (box) boxScores.push(box);
    } catch (error) {
      reason = error instanceof Error ? error.message : 'failed';
      // The last read, stale or not, beats nothing.
      if (entry?.box) boxScores.push(entry.box);
    }
  }));
  return { boxScores, error: reason ? `ESPN did not answer (${reason}).` : null };
}

/** Tests only: these are the box scores, and ESPN is never asked. */
export function pinBoxScores(boxScores: readonly BoxScore[]): void {
  kept.clear();
  for (const box of boxScores) kept.set(box.gameId, { at: Date.now(), box });
  pinned = true;
}

/** Tests only: forget every read. */
export function forgetBoxScores(): void {
  kept.clear();
  forgetNbaSummaries();
  pinned = false;
}
