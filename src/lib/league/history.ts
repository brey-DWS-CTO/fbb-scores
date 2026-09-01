/**
 * League history: seasons, franchises, placements, and the record book.
 *
 * Pure logic only, so the same code runs in the browser, on the server, and in
 * tests. The UI and the API are thin over this file.
 *
 * Two ideas hold the model together:
 *
 *  1. A franchise is not its owner. A team keeps one id for all time; the name
 *     on it can change. Every placement stores the owner name as it stood that
 *     season, so a rename or a handover never rewrites what happened.
 *  2. Every fact carries where it came from. Nothing is merged quietly: when
 *     two sources disagree the stored value stands and the disagreement is
 *     written down as a conflict for the commissioner to settle.
 */

export type Provenance = 'espn' | 'rulebook' | 'commissioner';

/** Raw totals as scored, or a total after a rule adjustment. */
export type ScoreBasis = 'raw' | 'adjusted';

export interface SourceRef {
  provenance: Provenance;
  /** Where to look it up again: a document, an ESPN endpoint, or a ruling date. */
  reference: string;
  verified: boolean;
  /** Why this still needs a human eye. */
  reviewNote?: string;
  recordedAt?: string;
}

export interface Franchise {
  id: string;
  /** What the team is called now. History keeps its own names. */
  name: string;
  currentOwner: string | null;
  /** Short name in the league config, when the franchise is still active. */
  currentOwnerKey: string | null;
  active: boolean;
  /** Ran a team once and no longer does. Shown with an asterisk, as the book does. */
  formerMember?: boolean;
  /** Every name this franchise has answered to, used to match old tables. */
  aliases: string[];
  note?: string;
  source: SourceRef;
}

export interface SeasonPlacement {
  franchiseId: string;
  /** The owner's name that season, not today's. */
  ownerName: string;
  /** 1 is the champion, 2 the runner-up. Null means the finish is unknown. */
  placement: number | null;
  note?: string;
  source: SourceRef;
}

export interface HistorySeason {
  id: string;
  seasonNumber: number;
  /** How the league writes it, such as "2025-2026". */
  label: string;
  startYear: number;
  endYear: number;
  /** ESPN numbers a season by the year it ends. Null when nobody has checked. */
  espnSeasonId: number | null;
  status: 'complete' | 'in-progress' | 'unrecorded';
  /** True only when every team's finish is on file, not just the top two. */
  standingsComplete: boolean;
  placements: SeasonPlacement[];
  /** The rule book in force that season, once one has been published. */
  rulebookVersionId?: string | null;
  note?: string;
  source: SourceRef;
}

export interface HistoryRecord {
  id: string;
  categoryId: string;
  /** Null when the old table gave a name nobody can pin to one franchise. */
  franchiseId: string | null;
  /** The name the source printed. */
  ownerName: string;
  seasonNumber: number;
  /** Scoring week. Null where the source never wrote it down. */
  period: number | null;
  opponentFranchiseId: string | null;
  opponentName: string | null;
  value: number;
  basis: ScoreBasis;
  source: SourceRef;
}

export interface RecordCategory {
  id: string;
  label: string;
  criteria: string;
  basis: ScoreBasis;
  basisNote?: string;
  /** False when the league knows entries are missing. */
  complete: boolean;
  note?: string;
  /** Points: bigger is better. Kept so a low-score board can be added later. */
  higherIsBetter: boolean;
}

/** Two sources saying different things. Written down, never resolved silently. */
export interface HistoryConflict {
  id: string;
  scope: 'season' | 'record' | 'franchise';
  targetId: string;
  field: string;
  values: Array<{ provenance: Provenance; reference: string; value: string }>;
  note: string;
  resolved: boolean;
  resolution?: string;
}

export interface LeagueHistory {
  schemaVersion: number;
  /** The app season this document belongs to. */
  season: number;
  revision: number;
  status: 'draft' | 'published';
  title: string;
  note?: string;
  franchises: Franchise[];
  seasons: HistorySeason[];
  recordCategories: RecordCategory[];
  records: HistoryRecord[];
  conflicts: HistoryConflict[];
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function franchiseIndex(history: LeagueHistory): Map<string, Franchise> {
  return new Map(history.franchises.map((franchise) => [franchise.id, franchise]));
}

/** Seasons newest first, which is how the league reads them. */
export function seasonsNewestFirst(history: LeagueHistory): HistorySeason[] {
  return [...history.seasons].sort((a, b) => b.seasonNumber - a.seasonNumber);
}

export function placementIn(season: HistorySeason, place: number): SeasonPlacement | undefined {
  return season.placements.find((entry) => entry.placement === place);
}

export interface SeasonRow {
  season: HistorySeason;
  champion: SeasonPlacement | null;
  runnerUp: SeasonPlacement | null;
  /** Everyone else on file, in finishing order. */
  others: SeasonPlacement[];
}

/** One row per season for the timeline table. */
export function seasonRows(history: LeagueHistory): SeasonRow[] {
  return seasonsNewestFirst(history).map((season) => {
    const ranked = [...season.placements].sort(
      (a, b) => (a.placement ?? 999) - (b.placement ?? 999) || a.ownerName.localeCompare(b.ownerName),
    );
    return {
      season,
      champion: placementIn(season, 1) ?? null,
      runnerUp: placementIn(season, 2) ?? null,
      others: ranked.filter((entry) => entry.placement !== 1 && entry.placement !== 2),
    };
  });
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface FranchiseTotals {
  franchiseId: string;
  name: string;
  currentOwner: string | null;
  currentOwnerKey: string | null;
  active: boolean;
  formerMember: boolean;
  titles: number;
  runnerUps: number;
  seasonsPlayed: number;
  firstSeason: number | null;
  lastTitleSeason: number | null;
}

/**
 * Titles and runner-up finishes per franchise, counted from the placements.
 *
 * This is the point of the whole feature: the front matter's member table was
 * typed by hand and drifted. Counting beats typing.
 */
export function franchiseTotals(history: LeagueHistory): FranchiseTotals[] {
  const byId = franchiseIndex(history);
  const totals = new Map<string, FranchiseTotals>();

  const blank = (franchiseId: string): FranchiseTotals => {
    const franchise = byId.get(franchiseId);
    return {
      franchiseId,
      name: franchise?.name ?? franchiseId,
      currentOwner: franchise?.currentOwner ?? null,
      currentOwnerKey: franchise?.currentOwnerKey ?? null,
      active: franchise?.active ?? false,
      formerMember: franchise?.formerMember === true,
      titles: 0,
      runnerUps: 0,
      seasonsPlayed: 0,
      firstSeason: null,
      lastTitleSeason: null,
    };
  };

  for (const franchise of history.franchises) totals.set(franchise.id, blank(franchise.id));

  for (const season of history.seasons) {
    for (const entry of season.placements) {
      if (!totals.has(entry.franchiseId)) totals.set(entry.franchiseId, blank(entry.franchiseId));
      const row = totals.get(entry.franchiseId)!;
      row.seasonsPlayed += 1;
      row.firstSeason =
        row.firstSeason === null ? season.seasonNumber : Math.min(row.firstSeason, season.seasonNumber);
      if (entry.placement === 1) {
        row.titles += 1;
        row.lastTitleSeason =
          row.lastTitleSeason === null
            ? season.seasonNumber
            : Math.max(row.lastTitleSeason, season.seasonNumber);
      }
      if (entry.placement === 2) row.runnerUps += 1;
    }
  }

  // Deterministic: most titles, then most runner-up finishes, then by name.
  return [...totals.values()].sort(
    (a, b) => b.titles - a.titles || b.runnerUps - a.runnerUps || a.name.localeCompare(b.name),
  );
}

export interface MemberTotals extends FranchiseTotals {
  /** Every franchise counted into this row. More than one means a handover. */
  franchiseIds: string[];
  /** True when a handover means these numbers cover two franchises. */
  inherited: boolean;
}

/**
 * Totals for the people running teams today, for the front-matter table.
 *
 * A member who took over another team carries both franchises, and the row says
 * so, because "Bryan's titles" and "the titles of every team Bryan has run" are
 * not the same claim.
 */
export function memberTotals(history: LeagueHistory): MemberTotals[] {
  const rows = new Map<string, MemberTotals>();
  for (const totals of franchiseTotals(history)) {
    if (!totals.active || !totals.currentOwnerKey) continue;
    const key = totals.currentOwnerKey;
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, { ...totals, franchiseIds: [totals.franchiseId], inherited: false });
      continue;
    }
    existing.franchiseIds.push(totals.franchiseId);
    existing.inherited = true;
    existing.titles += totals.titles;
    existing.runnerUps += totals.runnerUps;
    existing.seasonsPlayed += totals.seasonsPlayed;
    existing.firstSeason =
      existing.firstSeason === null || totals.firstSeason === null
        ? (existing.firstSeason ?? totals.firstSeason)
        : Math.min(existing.firstSeason, totals.firstSeason);
    existing.lastTitleSeason =
      existing.lastTitleSeason === null || totals.lastTitleSeason === null
        ? (existing.lastTitleSeason ?? totals.lastTitleSeason)
        : Math.max(existing.lastTitleSeason, totals.lastTitleSeason);
  }
  return [...rows.values()].sort(
    (a, b) => b.titles - a.titles || b.runnerUps - a.runnerUps || a.name.localeCompare(b.name),
  );
}

// ─── Records ─────────────────────────────────────────────────────────────────

export interface RankedRecord extends HistoryRecord {
  rank: number;
}

/**
 * Records in one category, ranked by value. Rank is worked out here and never
 * stored, which is what fixed the constitution's out-of-order 1243.0.
 * Equal values share a rank and the next rank skips.
 */
export function rankRecords(
  records: HistoryRecord[],
  categoryId: string,
  higherIsBetter = true,
): RankedRecord[] {
  const sorted = records
    .filter((entry) => entry.categoryId === categoryId)
    .sort((a, b) =>
      higherIsBetter ? b.value - a.value || a.id.localeCompare(b.id) : a.value - b.value || a.id.localeCompare(b.id),
    );
  let lastValue = Number.NaN;
  let lastRank = 0;
  return sorted.map((entry, index) => {
    const rank = entry.value === lastValue ? lastRank : index + 1;
    lastValue = entry.value;
    lastRank = rank;
    return { ...entry, rank };
  });
}

export type RecordSortKey = 'rank' | 'owner' | 'season' | 'period' | 'value' | 'source';

/**
 * Sort a ranked leaderboard by any column. Rank stays attached to the entry, so
 * sorting by owner does not renumber anybody.
 */
export function sortRankedRecords(
  rows: RankedRecord[],
  key: RecordSortKey,
  descending: boolean,
): RankedRecord[] {
  const direction = descending ? -1 : 1;
  const compare = (a: RankedRecord, b: RankedRecord): number => {
    switch (key) {
      case 'owner':
        return a.ownerName.localeCompare(b.ownerName);
      case 'season':
        return a.seasonNumber - b.seasonNumber || (a.period ?? 0) - (b.period ?? 0);
      case 'period':
        // An unknown week sorts last whichever way the column points.
        if (a.period === null || b.period === null) {
          if (a.period === b.period) return 0;
          return a.period === null ? 1 * direction : -1 * direction;
        }
        return a.period - b.period;
      case 'value':
        return a.value - b.value;
      case 'source':
        return a.source.provenance.localeCompare(b.source.provenance);
      default:
        return a.rank - b.rank;
    }
  };
  return [...rows].sort((a, b) => compare(a, b) * direction || a.rank - b.rank);
}

/** "S14W8", or "S14W?" where the source never recorded the week. */
export function formatWhen(record: Pick<HistoryRecord, 'seasonNumber' | 'period'>): string {
  return `S${record.seasonNumber}W${record.period ?? '?'}`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface HistoryProblem {
  kind:
    | 'no-champion'
    | 'two-champions'
    | 'no-runner-up'
    | 'two-runner-ups'
    | 'duplicate-placement'
    | 'unknown-franchise'
    | 'duplicate-season'
    | 'duplicate-id'
    | 'season-bounds'
    | 'duplicate-record'
    | 'unknown-category'
    | 'open-conflict';
  /** An error blocks publishing; a review note does not. */
  severity: 'error' | 'review';
  where: string;
  message: string;
}

/**
 * Everything that must be true before history can be published.
 *
 * A completed season needs exactly one champion and one runner-up, placements
 * cannot tie, franchises must be known, seasons must run one year into the
 * next, and no two record rows may say the same thing twice.
 */
export function validateHistory(history: LeagueHistory): HistoryProblem[] {
  const problems: HistoryProblem[] = [];
  const known = franchiseIndex(history);

  const franchiseIds = new Set<string>();
  for (const franchise of history.franchises) {
    if (franchiseIds.has(franchise.id)) {
      problems.push({
        kind: 'duplicate-id',
        severity: 'error',
        where: franchise.id,
        message: `Two franchises share the id ${franchise.id}`,
      });
    }
    franchiseIds.add(franchise.id);
  }

  const seenSeasons = new Set<number>();
  for (const season of history.seasons) {
    const where = `season ${season.seasonNumber}`;
    if (seenSeasons.has(season.seasonNumber)) {
      problems.push({
        kind: 'duplicate-season',
        severity: 'error',
        where,
        message: `Season ${season.seasonNumber} is listed twice`,
      });
    }
    seenSeasons.add(season.seasonNumber);

    if (season.endYear !== season.startYear + 1) {
      problems.push({
        kind: 'season-bounds',
        severity: 'error',
        where,
        message: `${season.label} does not run one year into the next`,
      });
    }
    if (season.espnSeasonId !== null && season.espnSeasonId !== season.endYear) {
      problems.push({
        kind: 'season-bounds',
        severity: 'review',
        where,
        message: `ESPN season ${season.espnSeasonId} does not match the year the season ends`,
      });
    }

    const byPlacement = new Map<number, number>();
    for (const entry of season.placements) {
      if (!known.has(entry.franchiseId)) {
        problems.push({
          kind: 'unknown-franchise',
          severity: 'error',
          where,
          message: `${entry.ownerName} points at an unknown franchise (${entry.franchiseId})`,
        });
      }
      if (entry.placement !== null) {
        byPlacement.set(entry.placement, (byPlacement.get(entry.placement) ?? 0) + 1);
      }
    }
    for (const [placement, count] of byPlacement) {
      if (count < 2) continue;
      if (placement === 1) {
        problems.push({
          kind: 'two-champions',
          severity: 'error',
          where,
          message: `${count} teams are marked champion`,
        });
      } else if (placement === 2) {
        problems.push({
          kind: 'two-runner-ups',
          severity: 'error',
          where,
          message: `${count} teams are marked runner-up`,
        });
      } else {
        problems.push({
          kind: 'duplicate-placement',
          severity: 'error',
          where,
          message: `${count} teams finished ${placement}`,
        });
      }
    }

    if (season.status === 'complete') {
      if (!byPlacement.has(1)) {
        problems.push({
          kind: 'no-champion',
          severity: 'error',
          where,
          message: 'A finished season needs a champion',
        });
      }
      if (!byPlacement.has(2)) {
        problems.push({
          kind: 'no-runner-up',
          severity: 'error',
          where,
          message: 'A finished season needs a runner-up',
        });
      }
    }
  }

  const categories = new Set(history.recordCategories.map((category) => category.id));
  const seenRecordIds = new Set<string>();
  const seenFacts = new Set<string>();
  for (const entry of history.records) {
    const where = `${entry.ownerName} ${formatWhen(entry)}`;
    if (seenRecordIds.has(entry.id)) {
      problems.push({
        kind: 'duplicate-id',
        severity: 'error',
        where,
        message: `Two records share the id ${entry.id}`,
      });
    }
    seenRecordIds.add(entry.id);

    if (!categories.has(entry.categoryId)) {
      problems.push({
        kind: 'unknown-category',
        severity: 'error',
        where,
        message: `Record points at an unknown category (${entry.categoryId})`,
      });
    }
    if (entry.franchiseId !== null && !known.has(entry.franchiseId)) {
      problems.push({
        kind: 'unknown-franchise',
        severity: 'error',
        where,
        message: `Record points at an unknown franchise (${entry.franchiseId})`,
      });
    }

    // The same team, the same week, the same score, entered twice.
    const fact = [
      entry.categoryId,
      entry.franchiseId ?? entry.ownerName.toLowerCase(),
      entry.seasonNumber,
      entry.period ?? 'unknown',
      entry.value,
      entry.basis,
    ].join('|');
    if (seenFacts.has(fact)) {
      problems.push({
        kind: 'duplicate-record',
        severity: 'error',
        where,
        message: `${entry.value} is on the board twice`,
      });
    }
    seenFacts.add(fact);
  }

  // The same score twice for one team in one season, filed under different
  // weeks. That is what an entry with an unknown week turns into once ESPN
  // supplies the week, so it is flagged rather than blocked.
  const sameScore = new Map<string, HistoryRecord[]>();
  for (const entry of history.records) {
    const key = [entry.categoryId, entry.franchiseId ?? entry.ownerName, entry.seasonNumber, entry.value].join('|');
    sameScore.set(key, [...(sameScore.get(key) ?? []), entry]);
  }
  for (const group of sameScore.values()) {
    if (group.length < 2) continue;
    problems.push({
      kind: 'duplicate-record',
      severity: 'review',
      where: `${group[0].ownerName} season ${group[0].seasonNumber}`,
      message: `${group[0].value.toFixed(1)} appears ${group.length} times under different weeks (${group
        .map((entry) => formatWhen(entry))
        .join(', ')})`,
    });
  }

  for (const conflict of history.conflicts) {
    if (conflict.resolved) continue;
    problems.push({
      kind: 'open-conflict',
      severity: 'review',
      where: conflict.targetId,
      message: conflict.note,
    });
  }

  return problems;
}

export interface ReviewFlag {
  id: string;
  message: string;
}

/**
 * What a reader should know before trusting a number. These never block a
 * publish; they are the honest small print.
 */
export function reviewFlags(history: LeagueHistory): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  for (const category of history.recordCategories) {
    if (!category.complete) {
      flags.push({
        id: `category-incomplete-${category.id}`,
        message: `${category.label}: the list is known to be missing entries.`,
      });
    }
  }

  const missingPeriod = history.records.filter((entry) => entry.period === null);
  if (missingPeriod.length > 0) {
    flags.push({
      id: 'records-missing-week',
      message: `${missingPeriod.length} record ${
        missingPeriod.length === 1 ? 'entry has' : 'entries have'
      } no week: ${missingPeriod.map((entry) => `${entry.ownerName} S${entry.seasonNumber}`).join(', ')}.`,
    });
  }

  const unverifiedRecords = history.records.filter((entry) => !entry.source.verified).length;
  if (unverifiedRecords > 0) {
    flags.push({
      id: 'records-unverified',
      message: `${unverifiedRecords} record entries are still unchecked against ESPN.`,
    });
  }

  const partialSeasons = history.seasons.filter(
    (season) => season.status === 'complete' && !season.standingsComplete,
  ).length;
  if (partialSeasons > 0) {
    flags.push({
      id: 'standings-partial',
      message: `${partialSeasons} seasons have only the top two finishes on file.`,
    });
  }

  for (const conflict of history.conflicts) {
    if (conflict.resolved) continue;
    flags.push({ id: `conflict-${conflict.id}`, message: conflict.note });
  }

  return flags;
}

// ─── Fingerprint and diff ────────────────────────────────────────────────────

/**
 * A stable fingerprint over the facts a reader sees.
 *
 * FNV-1a over a canonical string, the same trick the rule book uses, so it runs
 * identically in the browser and on the server with no crypto import. The
 * commissioner previews a fingerprint and the server refuses to publish
 * anything else.
 */
export function historyFingerprint(history: LeagueHistory): string {
  const parts: string[] = [`season:${history.season}`, `revision:${history.revision}`];

  for (const franchise of [...history.franchises].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push('f', franchise.id, franchise.name, franchise.currentOwner ?? '', String(franchise.active));
  }
  for (const season of [...history.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber)) {
    parts.push('s', season.id, season.label, season.status, String(season.espnSeasonId ?? ''));
    const placements = [...season.placements].sort(
      (a, b) => (a.placement ?? 999) - (b.placement ?? 999) || a.franchiseId.localeCompare(b.franchiseId),
    );
    for (const entry of placements) {
      parts.push('p', entry.franchiseId, entry.ownerName, String(entry.placement ?? ''), entry.source.provenance);
    }
  }
  for (const entry of [...history.records].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(
      'r',
      entry.id,
      entry.categoryId,
      entry.ownerName,
      String(entry.seasonNumber),
      String(entry.period ?? ''),
      entry.value.toFixed(2),
      entry.basis,
      entry.source.provenance,
    );
  }
  for (const category of [...history.recordCategories].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push('c', category.id, category.label, category.basis, String(category.complete));
  }

  const canonical = parts.join(' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    // FNV prime, kept inside 32 bits by Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `lh_${hash.toString(16).padStart(8, '0')}_${canonical.length.toString(36)}`;
}

export type HistoryChangeKind = 'season-added' | 'season-changed' | 'record-added' | 'record-removed' | 'record-changed' | 'franchise-added' | 'franchise-changed';

export interface HistoryChange {
  kind: HistoryChangeKind;
  id: string;
  label: string;
  before?: string;
  after?: string;
}

export interface HistoryDiff {
  changes: HistoryChange[];
  identical: boolean;
}

const seasonSummary = (season: HistorySeason): string => {
  const champion = placementIn(season, 1);
  const runnerUp = placementIn(season, 2);
  return `${season.status}, champion ${champion?.ownerName ?? 'unknown'}, runner-up ${
    runnerUp?.ownerName ?? 'unknown'
  }, ${season.placements.length} teams on file`;
};

const recordSummary = (entry: HistoryRecord): string =>
  `${entry.ownerName} ${formatWhen(entry)} ${entry.value.toFixed(1)} (${entry.basis}, ${entry.source.provenance})`;

/** What changes if the candidate replaces the current history. */
export function diffHistories(before: LeagueHistory, after: LeagueHistory): HistoryDiff {
  const changes: HistoryChange[] = [];

  const oldFranchises = new Map(before.franchises.map((franchise) => [franchise.id, franchise]));
  for (const franchise of after.franchises) {
    const old = oldFranchises.get(franchise.id);
    if (!old) {
      changes.push({ kind: 'franchise-added', id: franchise.id, label: franchise.name });
      continue;
    }
    if (old.name !== franchise.name || old.currentOwner !== franchise.currentOwner) {
      changes.push({
        kind: 'franchise-changed',
        id: franchise.id,
        label: franchise.name,
        before: `${old.name} (${old.currentOwner ?? 'nobody'})`,
        after: `${franchise.name} (${franchise.currentOwner ?? 'nobody'})`,
      });
    }
  }

  const oldSeasons = new Map(before.seasons.map((season) => [season.seasonNumber, season]));
  for (const season of after.seasons) {
    const old = oldSeasons.get(season.seasonNumber);
    if (!old) {
      changes.push({
        kind: 'season-added',
        id: season.id,
        label: season.label,
        after: seasonSummary(season),
      });
      continue;
    }
    const oldText = seasonSummary(old);
    const newText = seasonSummary(season);
    if (oldText !== newText) {
      changes.push({
        kind: 'season-changed',
        id: season.id,
        label: season.label,
        before: oldText,
        after: newText,
      });
    }
  }

  const oldRecords = new Map(before.records.map((entry) => [entry.id, entry]));
  const newRecords = new Map(after.records.map((entry) => [entry.id, entry]));
  for (const [id, entry] of newRecords) {
    const old = oldRecords.get(id);
    if (!old) {
      changes.push({ kind: 'record-added', id, label: entry.ownerName, after: recordSummary(entry) });
      continue;
    }
    if (recordSummary(old) !== recordSummary(entry)) {
      changes.push({
        kind: 'record-changed',
        id,
        label: entry.ownerName,
        before: recordSummary(old),
        after: recordSummary(entry),
      });
    }
  }
  for (const [id, entry] of oldRecords) {
    if (newRecords.has(id)) continue;
    changes.push({ kind: 'record-removed', id, label: entry.ownerName, before: recordSummary(entry) });
  }

  return { changes, identical: changes.length === 0 };
}

// ─── Merging a source in ─────────────────────────────────────────────────────

export interface SeasonImport {
  seasonNumber: number;
  label: string;
  startYear: number;
  endYear: number;
  espnSeasonId: number | null;
  status: HistorySeason['status'];
  standingsComplete: boolean;
  placements: SeasonPlacement[];
  records: HistoryRecord[];
  source: SourceRef;
}

export interface MergeResult {
  history: LeagueHistory;
  conflicts: HistoryConflict[];
  /** Seasons and records the merge actually wrote. */
  applied: string[];
}

/**
 * Fold an imported season into a history document.
 *
 * The stored value always wins. Where the import disagrees, the difference is
 * written down as a conflict for the commissioner, because a record book that
 * quietly overwrites itself is worth nothing.
 */
export function mergeSeasonImport(base: LeagueHistory, incoming: SeasonImport): MergeResult {
  const history = structuredClone(base);
  const conflicts: HistoryConflict[] = [];
  const applied: string[] = [];

  const existing = history.seasons.find((season) => season.seasonNumber === incoming.seasonNumber);
  if (!existing) {
    history.seasons.push({
      id: `season-${incoming.seasonNumber}`,
      seasonNumber: incoming.seasonNumber,
      label: incoming.label,
      startYear: incoming.startYear,
      endYear: incoming.endYear,
      espnSeasonId: incoming.espnSeasonId,
      status: incoming.status,
      standingsComplete: incoming.standingsComplete,
      placements: incoming.placements,
      source: incoming.source,
    });
    history.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    applied.push(`season-${incoming.seasonNumber}`);
  } else {
    const oldByFranchise = new Map(existing.placements.map((entry) => [entry.franchiseId, entry]));
    const added: SeasonPlacement[] = [];
    for (const entry of incoming.placements) {
      const old = oldByFranchise.get(entry.franchiseId);
      if (!old) {
        added.push(entry);
        continue;
      }
      if (old.placement !== entry.placement) {
        conflicts.push({
          id: `conflict-s${incoming.seasonNumber}-${entry.franchiseId}`,
          scope: 'season',
          targetId: existing.id,
          field: `placement:${entry.franchiseId}`,
          values: [
            {
              provenance: old.source.provenance,
              reference: old.source.reference,
              value: String(old.placement ?? 'unknown'),
            },
            {
              provenance: entry.source.provenance,
              reference: entry.source.reference,
              value: String(entry.placement ?? 'unknown'),
            },
          ],
          note: `${entry.ownerName} finished ${String(old.placement ?? 'unknown')} on file and ${String(
            entry.placement ?? 'unknown',
          )} in the import for ${existing.label}. The stored finish stands until the commissioner rules.`,
          resolved: false,
        });
      }
    }
    if (added.length > 0) {
      existing.placements = [...existing.placements, ...added];
      // Only the top two were on file before; a full import fills the rest in.
      existing.standingsComplete = incoming.standingsComplete;
      applied.push(`season-${incoming.seasonNumber}`);
    }
  }

  const byId = new Map(history.records.map((entry) => [entry.id, entry]));
  for (const entry of incoming.records) {
    const old = byId.get(entry.id);
    if (!old) {
      history.records.push(entry);
      applied.push(entry.id);
      continue;
    }
    if (old.value !== entry.value || old.period !== entry.period) {
      conflicts.push({
        id: `conflict-${entry.id}`,
        scope: 'record',
        targetId: entry.id,
        field: 'value',
        values: [
          {
            provenance: old.source.provenance,
            reference: old.source.reference,
            value: `${old.value.toFixed(1)} ${formatWhen(old)}`,
          },
          {
            provenance: entry.source.provenance,
            reference: entry.source.reference,
            value: `${entry.value.toFixed(1)} ${formatWhen(entry)}`,
          },
        ],
        note: `${entry.ownerName}'s ${formatWhen(entry)} score differs between the record book and the import. The stored value stands until the commissioner rules.`,
        resolved: false,
      });
    }
  }

  const knownConflicts = new Set(history.conflicts.map((conflict) => conflict.id));
  for (const conflict of conflicts) {
    if (!knownConflicts.has(conflict.id)) history.conflicts.push(conflict);
  }

  return { history, conflicts, applied };
}

/**
 * Turn a finished season into a reviewed draft.
 *
 * Nothing is published here. The commissioner reads the draft, then confirms.
 */
export function closeSeasonDraft(base: LeagueHistory, incoming: SeasonImport): MergeResult {
  const result = mergeSeasonImport(base, incoming);
  return {
    ...result,
    history: { ...result.history, status: 'draft' },
  };
}

/** Match an old table's name to a franchise, through its aliases. */
export function franchiseForName(history: LeagueHistory, name: string): Franchise | null {
  const wanted = name.trim().toLowerCase();
  const hits = history.franchises.filter(
    (franchise) =>
      franchise.name.toLowerCase() === wanted
      || franchise.aliases.some((alias) => alias.toLowerCase() === wanted),
  );
  // An ambiguous name is no match at all; guessing is how history gets rewritten.
  return hits.length === 1 ? hits[0] : null;
}
