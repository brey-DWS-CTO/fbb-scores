import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeSeasonDraft,
  diffHistories,
  formatWhen,
  franchiseForName,
  franchiseTotals,
  historyFingerprint,
  memberTotals,
  mergeSeasonImport,
  rankRecords,
  reviewFlags,
  seasonRows,
  sortRankedRecords,
  validateHistory,
  type Franchise,
  type HistoryRecord,
  type LeagueHistory,
  type SeasonImport,
  type SourceRef,
} from '../src/lib/league/history.js';
import { leagueHistorySeed } from '../src/lib/league/historyData.js';
import { parseEspnSeason, weeklyRecordId } from '../src/lib/league/historyImport.js';

const rulebookSource: SourceRef = {
  provenance: 'rulebook',
  reference: 'constitution appendix B',
  verified: false,
};
const espnSource: SourceRef = { provenance: 'espn', reference: 'espn:test', verified: false };

function franchise(id: string, name: string, owner: string | null): Franchise {
  return {
    id,
    name,
    currentOwner: owner,
    currentOwnerKey: owner,
    active: owner !== null,
    aliases: [name.split(' ')[0]],
    source: rulebookSource,
  };
}

/** A small history where the intent is easy to read. */
function toyHistory(): LeagueHistory {
  return {
    schemaVersion: 1,
    season: 2027,
    revision: 1,
    status: 'draft',
    title: 'Toy',
    franchises: [
      franchise('fr-a', 'Ann Adams', 'Ann'),
      franchise('fr-b', 'Bo Brooks', 'Bo'),
      { ...franchise('fr-c', 'Cal Chase', null), formerMember: true },
    ],
    seasons: [
      {
        id: 'season-1',
        seasonNumber: 1,
        label: '2010-2011',
        startYear: 2010,
        endYear: 2011,
        espnSeasonId: 2011,
        status: 'complete',
        standingsComplete: false,
        placements: [
          { franchiseId: 'fr-a', ownerName: 'Ann Adams', placement: 1, source: rulebookSource },
          { franchiseId: 'fr-c', ownerName: 'Cal Chase', placement: 2, source: rulebookSource },
        ],
        source: rulebookSource,
      },
      {
        id: 'season-2',
        seasonNumber: 2,
        label: '2011-2012',
        startYear: 2011,
        endYear: 2012,
        espnSeasonId: 2012,
        status: 'complete',
        standingsComplete: false,
        placements: [
          { franchiseId: 'fr-a', ownerName: 'Ann Adams', placement: 1, source: rulebookSource },
          { franchiseId: 'fr-b', ownerName: 'Bo Brooks', placement: 2, source: rulebookSource },
        ],
        source: rulebookSource,
      },
    ],
    recordCategories: [
      {
        id: 'weekly-high-score',
        label: 'Highest scoring weeks',
        criteria: '1200 pts minimum',
        basis: 'raw',
        complete: false,
        higherIsBetter: true,
      },
    ],
    records: [
      record('r1', 'fr-a', 'Ann Adams', 1, 3, 1300),
      record('r2', 'fr-b', 'Bo Brooks', 2, 5, 1250),
      record('r3', 'fr-c', 'Cal Chase', 1, 9, 1300),
    ],
    conflicts: [],
  };
}

function record(
  id: string,
  franchiseId: string,
  ownerName: string,
  seasonNumber: number,
  period: number | null,
  value: number,
): HistoryRecord {
  return {
    id,
    categoryId: 'weekly-high-score',
    franchiseId,
    ownerName,
    seasonNumber,
    period,
    opponentFranchiseId: null,
    opponentName: null,
    value,
    basis: 'raw',
    source: rulebookSource,
  };
}

// ─── Totals ────────────────────────────────────────────────────────────────

test('titles and runner-up finishes are counted, never typed', () => {
  const totals = franchiseTotals(toyHistory());
  const ann = totals.find((row) => row.franchiseId === 'fr-a');
  assert.equal(ann?.titles, 2);
  assert.equal(ann?.runnerUps, 0);
  assert.equal(ann?.seasonsPlayed, 2);
  assert.equal(ann?.lastTitleSeason, 2);
  const cal = totals.find((row) => row.franchiseId === 'fr-c');
  assert.equal(cal?.runnerUps, 1);
});

test('totals come out in the same order every time', () => {
  const history = toyHistory();
  const once = franchiseTotals(history).map((row) => row.franchiseId);
  const twice = franchiseTotals(structuredClone(history)).map((row) => row.franchiseId);
  assert.deepEqual(once, twice);
  assert.equal(once[0], 'fr-a', 'most titles first');
});

test('a franchise keeps its history when the owner changes', () => {
  const history = toyHistory();
  // Cal leaves, Ann takes the team over. The old finishes stay on that team.
  history.franchises = history.franchises.map((entry) =>
    entry.id === 'fr-c'
      ? { ...entry, name: 'Cal Chase', currentOwner: 'Ann Adams', currentOwnerKey: 'Ann', active: true }
      : entry,
  );
  const totals = franchiseTotals(history);
  assert.equal(totals.find((row) => row.franchiseId === 'fr-c')?.runnerUps, 1);
  assert.equal(
    history.seasons[0].placements[1].ownerName,
    'Cal Chase',
    'the season still says who ran the team that year',
  );

  const members = memberTotals(history);
  const annRow = members.find((row) => row.currentOwnerKey === 'Ann');
  assert.equal(annRow?.inherited, true, 'a handover is shown, not hidden');
  assert.equal(annRow?.titles, 2);
  assert.equal(annRow?.runnerUps, 1);
});

// ─── Records ───────────────────────────────────────────────────────────────

test('records rank by value and equal scores share a rank', () => {
  const ranked = rankRecords(toyHistory().records, 'weekly-high-score');
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 1, 3]);
  assert.equal(ranked[2].value, 1250);
});

test('the seed no longer lists a lower score above a higher one', () => {
  const ranked = rankRecords(leagueHistorySeed.records, 'weekly-high-score');
  const aaron = ranked.find((entry) => entry.value === 1243);
  const eric = ranked.find((entry) => entry.value === 1241.6);
  assert.ok(aaron && eric);
  assert.ok(aaron.rank < eric.rank, "Aaron's 1243.0 outranks Eric's 1241.6");
});

test('sorting a column keeps each entry with the rank it earned', () => {
  const ranked = rankRecords(toyHistory().records, 'weekly-high-score');
  const byOwner = sortRankedRecords(ranked, 'owner', false);
  assert.deepEqual(byOwner.map((entry) => entry.ownerName), ['Ann Adams', 'Bo Brooks', 'Cal Chase']);
  assert.equal(byOwner[1].rank, 3, 'Bo keeps rank 3 even sorted by name');
});

test('an unknown week sorts to the bottom either way', () => {
  const history = toyHistory();
  history.records.push(record('r4', 'fr-a', 'Ann Adams', 2, null, 1210));
  const ranked = rankRecords(history.records, 'weekly-high-score');
  const up = sortRankedRecords(ranked, 'period', false);
  const down = sortRankedRecords(ranked, 'period', true);
  assert.equal(up[up.length - 1].period, null);
  assert.equal(down[down.length - 1].period, null);
});

test('a missing week reads as unknown rather than as week zero', () => {
  assert.equal(formatWhen({ seasonNumber: 14, period: null }), 'S14W?');
  assert.equal(formatWhen({ seasonNumber: 14, period: 8 }), 'S14W8');
});

// ─── Validation ────────────────────────────────────────────────────────────

test('a finished season needs one champion and one runner-up', () => {
  const history = toyHistory();
  history.seasons[0].placements = [
    { franchiseId: 'fr-a', ownerName: 'Ann Adams', placement: 1, source: rulebookSource },
  ];
  const kinds = validateHistory(history).map((problem) => problem.kind);
  assert.ok(kinds.includes('no-runner-up'));
});

test('two teams cannot share a finish', () => {
  const history = toyHistory();
  history.seasons[0].placements.push({
    franchiseId: 'fr-b',
    ownerName: 'Bo Brooks',
    placement: 1,
    source: rulebookSource,
  });
  const problems = validateHistory(history);
  assert.ok(problems.some((problem) => problem.kind === 'two-champions' && problem.severity === 'error'));
});

test('a season that has not finished needs no champion', () => {
  const history = toyHistory();
  history.seasons[0].status = 'in-progress';
  history.seasons[0].placements = [];
  const kinds = validateHistory(history).map((problem) => problem.kind);
  assert.ok(!kinds.includes('no-champion'));
});

test('a placement for an unknown franchise is refused', () => {
  const history = toyHistory();
  history.seasons[0].placements[0].franchiseId = 'fr-nobody';
  assert.ok(validateHistory(history).some((problem) => problem.kind === 'unknown-franchise'));
});

test('a season must run one year into the next', () => {
  const history = toyHistory();
  history.seasons[0].endYear = 2013;
  assert.ok(validateHistory(history).some((problem) => problem.kind === 'season-bounds'));
});

test('the same score entered twice is caught', () => {
  const history = toyHistory();
  history.records.push({ ...history.records[0], id: 'r1-copy' });
  assert.ok(
    validateHistory(history).some(
      (problem) => problem.kind === 'duplicate-record' && problem.severity === 'error',
    ),
  );
});

test('one score filed under two different weeks is flagged, not blocked', () => {
  const history = toyHistory();
  history.records.push({ ...history.records[0], id: 'r1-week-found', period: 4 });
  const problems = validateHistory(history).filter((problem) => problem.kind === 'duplicate-record');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, 'review');
});

test('the committed seed passes every blocking check', () => {
  const errors = validateHistory(leagueHistorySeed).filter((problem) => problem.severity === 'error');
  assert.deepEqual(errors, []);
});

test('the seed keeps its known-shaky bits as review notes', () => {
  const flags = reviewFlags(leagueHistorySeed).map((flag) => flag.id);
  assert.ok(flags.includes('category-incomplete-weekly-high-score'), 'the list says it is incomplete');
  assert.ok(flags.includes('records-missing-week'), "Aaron's week is unknown and stays unknown");
  assert.ok(
    flags.some((id) => id.startsWith('conflict-')),
    'the sources disagree about Bryan Russell and that is on the record',
  );
});

// ─── Seed facts ────────────────────────────────────────────────────────────

test('the seed carries all sixteen seasons with the 2025-26 result', () => {
  const rows = seasonRows(leagueHistorySeed);
  assert.equal(rows.length, 16);
  assert.equal(rows[0].season.label, '2025-2026');
  assert.equal(rows[0].champion?.ownerName, 'Amy Shaug');
  assert.equal(rows[0].runnerUp?.ownerName, 'Brey Funkhouser');
  assert.equal(rows[0].season.source.provenance, 'commissioner');
});

test('counting fixes the front matter: Amy has four titles, Brey two runner-up finishes', () => {
  const totals = franchiseTotals(leagueHistorySeed);
  assert.equal(totals.find((row) => row.name === 'Amy Shaug')?.titles, 4);
  assert.equal(totals.find((row) => row.name === 'Brey Funkhouser')?.runnerUps, 2);
  assert.equal(totals.find((row) => row.name === 'Brey Funkhouser')?.titles, 3);
});

test('every seed fact says where it came from', () => {
  for (const season of leagueHistorySeed.seasons) {
    assert.ok(season.source.reference.length > 0, `${season.label} has no source`);
  }
  for (const entry of leagueHistorySeed.records) {
    assert.ok(['espn', 'rulebook', 'commissioner'].includes(entry.source.provenance));
    assert.equal(entry.basis, 'raw', 'records are raw totals, as the commissioner ruled');
  }
});

test('a name that could mean two franchises matches neither', () => {
  const history = toyHistory();
  assert.equal(franchiseForName(history, 'Ann')?.id, 'fr-a');
  history.franchises.push({ ...franchise('fr-d', 'Ann Other', 'Andy'), aliases: ['Ann'] });
  assert.equal(franchiseForName(history, 'Ann'), null);
});

// ─── Merging and versions ──────────────────────────────────────────────────

const seasonThree: SeasonImport = {
  seasonNumber: 3,
  label: '2012-2013',
  startYear: 2012,
  endYear: 2013,
  espnSeasonId: 2013,
  status: 'complete',
  standingsComplete: true,
  placements: [
    { franchiseId: 'fr-b', ownerName: 'Bo Brooks', placement: 1, source: espnSource },
    { franchiseId: 'fr-a', ownerName: 'Ann Adams', placement: 2, source: espnSource },
  ],
  records: [{ ...record('hs-s3-w2-fr-b', 'fr-b', 'Bo Brooks', 3, 2, 1400), source: espnSource }],
  source: espnSource,
};

test('an import adds a season the record book did not have', () => {
  const merged = mergeSeasonImport(toyHistory(), seasonThree);
  assert.equal(merged.history.seasons.length, 3);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.history.records.length, 4);
});

test('sources that disagree are written down, and the stored value stands', () => {
  const history = toyHistory();
  const clash: SeasonImport = {
    ...seasonThree,
    seasonNumber: 1,
    label: '2010-2011',
    startYear: 2010,
    endYear: 2011,
    espnSeasonId: 2011,
    placements: [
      { franchiseId: 'fr-a', ownerName: 'Ann Adams', placement: 2, source: espnSource },
      { franchiseId: 'fr-c', ownerName: 'Cal Chase', placement: 1, source: espnSource },
    ],
    records: [],
  };
  const merged = mergeSeasonImport(history, clash);
  assert.equal(merged.conflicts.length, 2, 'both finishes disagree');
  const season = merged.history.seasons.find((entry) => entry.seasonNumber === 1);
  assert.equal(season?.placements[0].placement, 1, 'Ann is still the champion on file');
  assert.equal(merged.history.conflicts.length, 2, 'the disagreement is kept for the commissioner');
});

test('a record whose score differs between sources becomes a conflict, not an overwrite', () => {
  const history = toyHistory();
  const clash: SeasonImport = {
    ...seasonThree,
    records: [{ ...record('r1', 'fr-a', 'Ann Adams', 1, 3, 1310), source: espnSource }],
  };
  const merged = mergeSeasonImport(history, clash);
  assert.equal(merged.history.records.find((entry) => entry.id === 'r1')?.value, 1300);
  assert.ok(merged.conflicts.some((conflict) => conflict.scope === 'record'));
});

test('closing a season leaves a draft, never a published document', () => {
  const published: LeagueHistory = { ...toyHistory(), status: 'published' };
  const closed = closeSeasonDraft(published, seasonThree);
  assert.equal(closed.history.status, 'draft');
  assert.equal(closed.history.seasons.length, 3);
});

test('the fingerprint moves only when a fact moves', () => {
  const history = toyHistory();
  const before = historyFingerprint(history);
  assert.equal(before, historyFingerprint(structuredClone(history)), 'the same facts hash the same');

  const retitled = structuredClone(history);
  retitled.title = 'A different name for the document';
  assert.equal(historyFingerprint(retitled), before, 'the document title is not a fact');

  const changed = structuredClone(history);
  changed.seasons[0].placements[0].placement = 3;
  assert.notEqual(historyFingerprint(changed), before);
});

test('a diff names the season and the record that changed', () => {
  const before = toyHistory();
  const after = mergeSeasonImport(before, seasonThree).history;
  const diff = diffHistories(before, after);
  assert.equal(diff.identical, false);
  assert.ok(diff.changes.some((change) => change.kind === 'season-added'));
  assert.ok(diff.changes.some((change) => change.kind === 'record-added'));
  assert.equal(diffHistories(before, structuredClone(before)).identical, true);
});

// ─── ESPN import ───────────────────────────────────────────────────────────

const espnFixture = {
  id: 12345,
  seasonId: 2013,
  status: { isActive: false, finalScoringPeriod: 170 },
  teams: [
    { id: 1, name: 'Ann Adams', rankCalculatedFinal: 2 },
    { id: 2, name: 'Bo Brooks', rankCalculatedFinal: 1 },
  ],
  schedule: [
    {
      matchupPeriodId: 2,
      playoffTierType: 'NONE',
      home: { teamId: 2, totalPoints: 1400.4 },
      away: { teamId: 1, totalPoints: 1100 },
    },
    {
      matchupPeriodId: 20,
      playoffTierType: 'WINNERS_BRACKET',
      home: { teamId: 2, totalPoints: 1250 },
      away: { teamId: 1, totalPoints: 1150 },
    },
  ],
};

const importOptions = {
  seasonNumber: 3,
  label: '2012-2013',
  startYear: 2012,
  endYear: 2013,
  espnSeasonId: 2013,
  teamMap: [
    { espnTeamId: 1, franchiseId: 'fr-a', ownerName: 'Ann Adams' },
    { espnTeamId: 2, franchiseId: 'fr-b', ownerName: 'Bo Brooks' },
  ],
  categoryId: 'weekly-high-score',
  recordMinimum: 1200,
  basis: 'raw' as const,
  fetchedAt: '2026-08-31T00:00:00.000Z',
};

test('an ESPN season reads into placements and records', () => {
  const parsed = parseEspnSeason(espnFixture, importOptions);
  assert.deepEqual(parsed.problems, []);
  assert.ok(parsed.seasonImport);
  assert.equal(parsed.seasonImport.standingsComplete, true);
  assert.equal(
    parsed.seasonImport.placements.find((entry) => entry.placement === 1)?.ownerName,
    'Bo Brooks',
  );
  assert.equal(parsed.seasonImport.records.length, 2, 'only weeks over the minimum count');
  assert.equal(parsed.seasonImport.records[0].value, 1400.4);
  assert.equal(parsed.seasonImport.records[0].opponentName, 'Ann Adams');
  assert.equal(parsed.seasonImport.records[0].source.provenance, 'espn');
  assert.equal(parsed.seasonImport.records[0].source.verified, false, 'an import is not yet checked');
});

test('an unmapped ESPN team blocks the import and names itself', () => {
  const parsed = parseEspnSeason(espnFixture, { ...importOptions, teamMap: [importOptions.teamMap[0]] });
  assert.equal(parsed.seasonImport, null);
  assert.ok(parsed.problems.some((problem) => problem.kind === 'unmapped-team'));
  assert.equal(parsed.espnTeams.length, 2, 'the team list comes back so the mapping can be built');
});

test('the wrong season, or a season still running, is refused', () => {
  const wrong = parseEspnSeason({ ...espnFixture, seasonId: 2014 }, importOptions);
  assert.ok(wrong.problems.some((problem) => problem.kind === 'wrong-season'));
  const running = parseEspnSeason(
    { ...espnFixture, status: { isActive: true } },
    importOptions,
  );
  assert.ok(running.problems.some((problem) => problem.kind === 'season-in-progress'));
  assert.equal(running.seasonImport, null);
});

test('with no final ranking the title game decides the top two and the rest stay unknown', () => {
  const thin = {
    ...espnFixture,
    teams: [
      { id: 1, name: 'Ann Adams' },
      { id: 2, name: 'Bo Brooks' },
    ],
  };
  const parsed = parseEspnSeason(thin, importOptions);
  assert.ok(parsed.seasonImport);
  assert.equal(parsed.seasonImport.standingsComplete, false);
  assert.equal(parsed.seasonImport.placements.length, 2);
  assert.ok(parsed.problems.some((problem) => problem.kind === 'no-final-rankings'));
});

test('an old season ESPN has nothing for cannot be imported', () => {
  const empty = parseEspnSeason({ seasonId: 2011, teams: [], schedule: [] }, {
    ...importOptions,
    espnSeasonId: 2011,
    teamMap: [],
  });
  assert.equal(empty.seasonImport, null);
  assert.ok(empty.problems.some((problem) => problem.kind === 'no-teams'));
});

test('record ids are the same however the score is reached', () => {
  assert.equal(weeklyRecordId(9, 10, 'fr-funkhouser', 'Brey'), 'hs-s9-w10-fr-funkhouser');
  assert.equal(weeklyRecordId(14, null, null, 'Aaron'), 'hs-s14-wx-aaron');
  assert.ok(
    leagueHistorySeed.records.some((entry) => entry.id === 'hs-s9-w10-fr-funkhouser'),
    'the seed already uses that identity, so a re-import lines up',
  );
});
