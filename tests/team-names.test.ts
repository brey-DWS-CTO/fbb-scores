import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamInfo } from '../src/lib/keeper/types.ts';
import {
  normalizeTeamName,
  previewTeamNameRefresh,
  teamNameOf,
} from '../src/lib/league/teamNames.ts';

function team(owner: string, espnTeamId: number, espnTeamName: string): TeamInfo {
  return {
    owner,
    fullName: `${owner} Tester`,
    espnTeamId,
    espnTeamName,
    draftPosition: espnTeamId,
  };
}

const teams: TeamInfo[] = [
  team('Bryan', 6, 'So many RULES'),
  team('Amy', 2, 'Tu Mamacita'),
  team('Ryan', 1, 'Trump is my Herro'),
];

test('collapses runs of whitespace and trims', () => {
  assert.equal(normalizeTeamName('Tu  Mamacita'), 'Tu Mamacita');
  assert.equal(normalizeTeamName('Trump is my Herro '), 'Trump is my Herro');
  assert.equal(normalizeTeamName('\tSo   many\nRULES  '), 'So many RULES');
  assert.equal(normalizeTeamName('   '), '');
});

test('does not report a whitespace-only difference as a change', () => {
  const preview = previewTeamNameRefresh(teams, [
    { espnTeamId: 2, name: 'Tu  Mamacita', ownerName: 'Amy Shaug' },
    { espnTeamId: 1, name: 'Trump is my Herro ', ownerName: 'Ryan Shaug' },
  ]);
  assert.deepEqual(preview.changes, []);
  assert.deepEqual(
    preview.unchanged.map((row) => row.owner).sort(),
    ['Amy', 'Ryan'],
  );
  assert.equal(preview.nextNames.Amy, 'Tu Mamacita');
  assert.equal(preview.nextNames.Ryan, 'Trump is my Herro');
});

test('reports a real rename, old name to new', () => {
  const preview = previewTeamNameRefresh(teams, [
    { espnTeamId: 6, name: 'Team Clown Baby', ownerName: 'Bryan Russell' },
  ]);
  assert.deepEqual(preview.changes, [
    { owner: 'Bryan', espnTeamId: 6, before: 'So many RULES', after: 'Team Clown Baby' },
  ]);
  assert.equal(preview.nextNames.Bryan, 'Team Clown Baby');
});

test('matches on the ESPN team ID, never on the name', () => {
  const preview = previewTeamNameRefresh(teams, [
    { espnTeamId: 6, name: 'Tu Mamacita', ownerName: 'Bryan Russell' },
  ]);
  assert.deepEqual(preview.changes, [
    { owner: 'Bryan', espnTeamId: 6, before: 'So many RULES', after: 'Tu Mamacita' },
  ]);
});

test('ignores an ESPN team the league does not know', () => {
  const preview = previewTeamNameRefresh(teams, [
    { espnTeamId: 99, name: 'Somebody Else League', ownerName: 'Stranger' },
    { espnTeamId: 6, name: 'Team Clown Baby', ownerName: 'Bryan Russell' },
  ]);
  assert.deepEqual(preview.unknownEspnTeamIds, [99]);
  assert.deepEqual(preview.changes.map((change) => change.owner), ['Bryan']);
  assert.deepEqual(Object.keys(preview.nextNames), ['Bryan']);
});

test('keeps the stored name for a team ESPN did not send back', () => {
  const preview = previewTeamNameRefresh(
    teams,
    [{ espnTeamId: 6, name: 'Team Clown Baby', ownerName: 'Bryan Russell' }],
    { Amy: 'Mamacita Reloaded' },
  );
  assert.deepEqual(
    preview.missing.map((row) => ({ owner: row.owner, name: row.name })),
    [
      { owner: 'Amy', name: 'Mamacita Reloaded' },
      { owner: 'Ryan', name: 'Trump is my Herro' },
    ],
  );
  assert.equal(preview.nextNames.Amy, 'Mamacita Reloaded');
  assert.equal(preview.nextNames.Ryan, undefined);
});

test('compares against the stored live name, not the committed one', () => {
  const preview = previewTeamNameRefresh(
    teams,
    [{ espnTeamId: 6, name: 'Team Clown Baby', ownerName: 'Bryan Russell' }],
    { Bryan: 'Team Clown Baby' },
  );
  assert.deepEqual(preview.changes, []);
  assert.deepEqual(preview.unchanged.map((row) => row.owner), ['Bryan']);
});

test('refuses a response that names the same ESPN team twice', () => {
  assert.throws(
    () =>
      previewTeamNameRefresh(teams, [
        { espnTeamId: 6, name: 'One', ownerName: '' },
        { espnTeamId: 6, name: 'Two', ownerName: '' },
      ]),
    /Duplicate ESPN team ID 6/,
  );
});

test('falls back to the committed name when there is no override', () => {
  const bryan = teams[0];
  assert.equal(teamNameOf(bryan, undefined), 'So many RULES');
  assert.equal(teamNameOf(bryan, {}), 'So many RULES');
  assert.equal(teamNameOf(bryan, { Bryan: '   ' }), 'So many RULES');
  assert.equal(teamNameOf(bryan, { Amy: 'Elsewhere' }), 'So many RULES');
  assert.equal(teamNameOf(bryan, { Bryan: 'Team  Clown Baby ' }), 'Team Clown Baby');
  assert.equal(teamNameOf(null, { Bryan: 'Team Clown Baby' }), '');
});
