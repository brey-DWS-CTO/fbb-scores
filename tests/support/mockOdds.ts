/**
 * Many mock drafts and what they say about one pick. The app drafts one mock
 * at a time; these run hundreds so the tests can check the computer teams
 * draft like a room would.
 */
import {
  prepareMock,
  runMock,
  runSeed,
  type MockCandidate,
  type MockDraftInput,
  type MockDraftResult,
} from '../../src/lib/league/mockDraft.ts';

/** Many drafts from one seed, each with its own derived seed. */
export function simulateMany(input: MockDraftInput, runs: number): MockDraftResult[] {
  const prepared = prepareMock(input);
  const results: MockDraftResult[] = [];
  for (let run = 0; run < runs; run += 1) {
    results.push(runMock(prepared, runSeed(input.settings.seed, run)));
  }
  return results;
}

// ─── What the runs say ──────────────────────────────────────────────────────

export interface AvailabilityRow extends MockCandidate {
  /** Runs in which he was still on the board at the pick. */
  available: number;
  /** The same as a share of runs, 0 to 1. */
  availableShare: number;
  /** Runs in which this very pick took him. */
  takenHere: number;
  takenHereShare: number;
}

export interface AvailabilityReport {
  overall: number;
  label: string;
  owner: string;
  runs: number;
  /** Everyone who was there at least once, best value first. */
  rows: AvailabilityRow[];
}

/**
 * For one pick, how often each player was still on the board across the
 * runs, and how often that pick took him. This distribution is the product.
 */
export function availabilityAt(results: readonly MockDraftResult[], overall: number): AvailabilityReport {
  if (results.length === 0) throw new Error('No runs to report on');
  const first = results[0];
  const slot = first.picks.find((pick) => pick.overall === overall);
  if (!slot) throw new Error(`No pick ${overall} on the board`);

  const available = new Map<string, number>();
  const takenHere = new Map<string, number>();
  for (const result of results) {
    const gone = new Set<string>();
    for (const pick of result.picks) {
      if (pick.overall >= overall) break;
      if (pick.playerKey) gone.add(pick.playerKey);
    }
    for (const candidate of result.pool) {
      if (!gone.has(candidate.playerKey)) available.set(candidate.playerKey, (available.get(candidate.playerKey) ?? 0) + 1);
    }
    const here = result.picks.find((pick) => pick.overall === overall);
    if (here?.playerKey) takenHere.set(here.playerKey, (takenHere.get(here.playerKey) ?? 0) + 1);
  }

  const runs = results.length;
  const rows = first.pool
    .filter((candidate) => (available.get(candidate.playerKey) ?? 0) > 0)
    .map((candidate): AvailabilityRow => {
      const there = available.get(candidate.playerKey) ?? 0;
      const took = takenHere.get(candidate.playerKey) ?? 0;
      return {
        ...candidate,
        available: there,
        availableShare: there / runs,
        takenHere: took,
        takenHereShare: took / runs,
      };
    })
    .sort((a, b) => a.valueRank - b.valueRank);

  return { overall, label: slot.label, owner: slot.owner, runs, rows };
}

/** "1.9 (Brey), 200 runs: A. Davis 71%, L. James 64%, ..." */
export function describeAvailability(report: AvailabilityReport, limit = 8): string {
  const parts = report.rows
    .slice(0, limit)
    .map((row) => `${row.playerName} ${Math.round(row.availableShare * 100)}%`);
  return `${report.label} (${report.owner}), ${report.runs} runs: ${parts.join(', ')}`;
}

/** One run as a list of lines, "1.1 Joel: N. Jokic (keeper)". */
export function describeRound(result: MockDraftResult, round: number): string[] {
  return result.picks
    .filter((pick) => pick.round === round)
    .map((pick) => {
      const how = pick.how === 'keeper'
        ? ` (${pick.keeperStatus === 'known' ? 'keeper' : 'assumed keeper'})`
        : pick.how === 'made' ? ' (already picked)' : '';
      return `${pick.label} ${pick.owner}: ${pick.playerName ?? 'nobody'}${how}`;
    });
}
