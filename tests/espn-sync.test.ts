import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nameList,
  partsToSave,
  summarizePlayers,
  summarizeRankings,
  summarizeTeams,
} from '../src/lib/league/espnSync.ts';

const player = (fullName: string) => ({
  key: fullName, espnId: fullName.length, fullName, proTeam: 'Den', positions: ['C'], sourceStatus: 'fetched' as const,
});
const emptyPool = {
  added: [], removed: [], retainedMissing: [], nameChanged: [], teamChanged: [], positionChanged: [],
  nextPlayers: [player('Nikola Jokic'), player('Jamal Murray')],
};
const same = { currentSnapshotId: 'a', candidateSnapshotId: 'a' };
const differs = { currentSnapshotId: 'a', candidateSnapshotId: 'b' };

test('a short list stays whole; a long one says how many more', () => {
  assert.equal(nameList(['A', 'B']), 'A, B');
  assert.equal(nameList(['A', 'B', 'C', 'D'], 2), 'A, B and 2 more');
});

test('players: no change reads as no change and is not saved', () => {
  const summary = summarizePlayers(emptyPool, same);
  assert.equal(summary.changed, false);
  assert.equal(summary.headline, 'No change. 2 players.');
});

test('players: new, gone and team moves are counted and named', () => {
  const summary = summarizePlayers({
    ...emptyPool,
    added: [player('Cooper Flagg')],
    removed: [player('Old Guy')],
    teamChanged: [{ key: 'k', espnId: 1, fullName: 'Kevin Durant', before: 'Pho', after: 'Hou' }],
    retainedMissing: [player('Hurt Keeper')],
  }, differs);
  assert.equal(summary.changed, true);
  assert.equal(summary.headline, '1 new, 1 gone, 1 changed team. 2 players in all.');
  assert.deepEqual(summary.details, ['New: Cooper Flagg.', 'Gone: Old Guy.', 'New team: Kevin Durant (Hou).']);
  assert.match(summary.warnings[0], /Hurt Keeper/);
});

test('players: once the draft starts the list is locked and never saved', () => {
  const summary = summarizePlayers({ ...emptyPool, added: [player('Late Signing')] }, differs, true);
  assert.equal(summary.changed, false);
  assert.ok(summary.warnings.some((line) => line.includes('locked')));
});

const rankings = {
  counts: { players: 400, ranked: 390, withAdp: 300, projected: 348 },
  previousCounts: { players: 400, ranked: 390, withAdp: 300, projected: 340 },
  added: [],
  removed: [],
  moved: [{ espnId: 1, fullName: 'Josh Giddey', before: 25, after: 16, delta: 9 }],
  projectionArrived: false,
  scoringChanged: false,
  nextScoringItems: [{ statId: 0, points: 1 }],
};

test('rankings: projections and moves in one line', () => {
  const summary = summarizeRankings(rankings, differs);
  assert.equal(summary.changed, true);
  assert.equal(summary.headline, '348 projected (8 more), 1 rank move.');
  assert.deepEqual(summary.details, ['Biggest moves: Josh Giddey 25 to 16.']);
  assert.deepEqual(summary.warnings, []);
});

test('rankings: missing or changed scoring is a warning', () => {
  assert.match(summarizeRankings({ ...rankings, nextScoringItems: [] }, differs).warnings[0], /no scoring/);
  assert.match(summarizeRankings({ ...rankings, scoringChanged: true }, differs).warnings[0], /scoring on ESPN changed/);
  assert.equal(summarizeRankings(rankings, same).headline, 'No change. 348 projected.');
});

test('team names: each rename on its own line', () => {
  const summary = summarizeTeams({
    changes: [{ owner: 'Kyle', espnTeamId: 5, before: 'Old Name', after: 'New Name' }],
    missing: [],
  });
  assert.equal(summary.changed, true);
  assert.equal(summary.headline, '1 team renamed.');
  assert.deepEqual(summary.details, ['Kyle: Old Name → New Name']);
  assert.equal(summarizeTeams({ changes: [], missing: [] }).changed, false);
});

test('only changed parts are saved, players first', () => {
  const teams = summarizeTeams({ changes: [{ owner: 'Kyle', espnTeamId: 5, before: 'a', after: 'b' }], missing: [] });
  const players = summarizePlayers({ ...emptyPool, added: [player('X')] }, differs);
  const ranks = summarizeRankings(rankings, same);
  assert.deepEqual(partsToSave([teams, ranks, players, null]), ['players', 'teams']);
  assert.deepEqual(partsToSave([null, null, null]), []);
});
