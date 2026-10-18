import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatasetPlayer } from '../src/lib/keeper/types.ts';
import {
  buildDraftList,
  cleanListLine,
  isOnAuto,
  listToText,
  nextAutoPick,
  normalizeName,
  parseListText,
  withAuto,
} from '../src/lib/league/autoDraft.ts';

const player = (key: string, fullName: string, name: string): DatasetPlayer => ({
  key,
  espnId: null,
  name,
  fullName,
  positions: ['C'],
  proTeam: 'den',
  fantasyTeam: null,
  stats2026: null,
  api2026: null,
  prior: null,
  keeper: { eligible: false, round: null, maxYears: 0, yearsKept: 0, reason: null } as unknown as DatasetPlayer['keeper'],
});

const pool = [
  player('jokic', 'Nikola Jokic', 'N. Jokic'),
  player('doncic', 'Luka Doncic', 'L. Doncic'),
  player('jjj', 'Jaren Jackson Jr.', 'J. Jackson Jr.'),
  player('reggie', 'Reggie Jackson', 'R. Jackson'),
  player('wemby', 'Victor Wembanyama', 'V. Wembanyama'),
];

test('a pasted line loses its number, bullet and trailing cells', () => {
  assert.equal(cleanListLine('1. Nikola Jokic'), 'Nikola Jokic');
  assert.equal(cleanListLine('12) Luka  Doncic'), 'Luka Doncic');
  assert.equal(cleanListLine('#3 - Victor Wembanyama'), 'Victor Wembanyama');
  assert.equal(cleanListLine('- Jaren Jackson Jr.'), 'Jaren Jackson Jr.');
  assert.equal(cleanListLine('4\tReggie Jackson\tLAC\tPG'), 'Reggie Jackson');
  assert.equal(cleanListLine('Nikola Jokic, DEN, C'), 'Nikola Jokic');
  assert.equal(cleanListLine('   '), '');
});

test('names compare without accents, punctuation or suffixes', () => {
  assert.equal(normalizeName('Nikola Jokić'), 'nikola jokic');
  assert.equal(normalizeName("De'Aaron Fox"), 'de aaron fox');
  assert.equal(normalizeName('Jaren Jackson Jr.'), 'jaren jackson');
});

test('the text becomes names in order, blanks and repeats dropped', () => {
  assert.deepEqual(parseListText('1. Jokic\n\n2. Doncic\r\n3. jokic\n4. Wemby'), ['Jokic', 'Doncic', 'Wemby']);
});

test('a list matches full names, short names, unique last names and initials', () => {
  const list = buildDraftList(
    '1. Nikola Jokić\n2. L. Doncic\n3. Wembanyama\n4. J. Jackson\n5. Jackson\n6. Somebody Made Up',
    pool,
    '2026-10-17T00:00:00.000Z',
  );
  assert.deepEqual(list.entries.map((entry) => [entry.rank, entry.playerKey]), [
    [1, 'jokic'],
    [2, 'doncic'],
    [3, 'wemby'],
    [4, 'jjj'],
    // Two Jacksons: a bare last name matches nobody rather than guessing.
    [5, null],
    [6, null],
  ]);
  assert.equal(list.entries[0].playerName, 'Nikola Jokic');
  assert.equal(list.entries[5].playerName, null);
  assert.equal(listToText(list).split('\n')[0], '1. Nikola Jokić');
  assert.equal(listToText(null), '');
});

test('an auto pick takes the first listed player still there, then the board order', () => {
  const list = buildDraftList('Jokic\nDoncic\nWembanyama', pool, 'now');
  const fallback = [pool[4], pool[2], pool[3]];
  const first = nextAutoPick(list, pool, fallback);
  assert.equal(first?.player.key, 'jokic');
  assert.equal(first?.fromList, true);

  const withoutTop = pool.filter((entry) => entry.key !== 'jokic' && entry.key !== 'doncic');
  const third = nextAutoPick(list, withoutTop, fallback);
  assert.equal(third?.player.key, 'wemby');
  assert.equal(third?.fromList, true);

  const dry = pool.filter((entry) => ['jjj', 'reggie'].includes(entry.key));
  const fromBoard = nextAutoPick(list, dry, fallback);
  assert.equal(fromBoard?.player.key, 'jjj');
  assert.equal(fromBoard?.fromList, false);

  assert.equal(nextAutoPick(null, dry, fallback)?.player.key, 'jjj');
  assert.equal(nextAutoPick(null, dry, [])?.player.key, 'jjj', 'no board order at all still picks someone');
  assert.equal(nextAutoPick(list, [], fallback), null);
});

test('auto owners toggle without touching the rest', () => {
  const on = withAuto(undefined, 'Joel', true);
  assert.deepEqual(on, ['Joel']);
  assert.deepEqual(withAuto(on, 'Ryan', true), ['Joel', 'Ryan']);
  assert.deepEqual(withAuto(['Joel', 'Ryan'], 'Joel', false), ['Ryan']);
  assert.deepEqual(withAuto(['Joel'], 'Joel', true), ['Joel']);
  assert.ok(isOnAuto({ draft: { picks: {}, startedAt: null, autoOwners: ['Joel'] } }, 'Joel'));
  assert.ok(!isOnAuto({ draft: { picks: {}, startedAt: null } }, 'Joel'));
});
