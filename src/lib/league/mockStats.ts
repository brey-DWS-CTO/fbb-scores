/**
 * How many mock drafts each owner has finished, and their best grade, for
 * the table everyone sees on the mock page.
 *
 * Members keep only their last ten saved mocks, so every finish is also
 * logged on its own and never trimmed. Counts take both, each draft once.
 *
 * Pure. No server, no browser.
 */
import { gradeForRank } from './mockGrade.js';

export interface MockFinish {
  owner: string;
  id: string;
  rank: number;
  teams: number;
}

export interface MockStatRow {
  owner: string;
  mocks: number;
  /** Best grade, or null for someone who has finished none. */
  bestGrade: string | null;
}

/** One row per owner, most mocks first, then name. */
export function mockStats(owners: readonly string[], finishes: readonly MockFinish[]): MockStatRow[] {
  const seen = new Set<string>();
  const byOwner = new Map<string, { mocks: number; best: MockFinish | null }>();
  for (const owner of owners) byOwner.set(owner, { mocks: 0, best: null });
  for (const finish of finishes) {
    const row = byOwner.get(finish.owner);
    if (!row || seen.has(`${finish.owner}:${finish.id}`)) continue;
    seen.add(`${finish.owner}:${finish.id}`);
    row.mocks += 1;
    if (!row.best || finish.rank < row.best.rank) row.best = finish;
  }
  return [...byOwner.entries()]
    .map(([owner, row]) => ({
      owner,
      mocks: row.mocks,
      bestGrade: row.best ? gradeForRank(row.best.rank, row.best.teams) : null,
    }))
    .sort((a, b) => b.mocks - a.mocks || a.owner.localeCompare(b.owner));
}
