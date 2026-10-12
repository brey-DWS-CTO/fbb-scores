import assert from 'node:assert/strict';
import test from 'node:test';
import { nameTaken, parseWriteIn } from '../src/lib/league/writeIn.js';

test('a write-in needs a name, a team code and one or two positions', () => {
  const good = parseWriteIn({ name: '  Cooper   Flagg ', proTeam: 'DAL', positions: ['sf', 'PF'] });
  assert.deepEqual(good, { ok: true, player: { key: 'writein-cooper-flagg-dal', name: 'Cooper Flagg', proTeam: 'dal', positions: ['SF', 'PF'] } });
  assert.equal(parseWriteIn({ name: 'C', proTeam: 'DAL', positions: ['SF'] }).ok, false);
  assert.equal(parseWriteIn({ name: 'Cooper Flagg', proTeam: 'Dallas', positions: ['SF'] }).ok, false);
  assert.equal(parseWriteIn({ name: 'Cooper Flagg', proTeam: 'DAL', positions: [] }).ok, false);
  assert.equal(parseWriteIn({ name: 'Cooper Flagg', proTeam: 'DAL', positions: ['SF', 'PF', 'C'] }).ok, false);
  assert.equal(parseWriteIn({ name: 'Cooper Flagg', proTeam: 'DAL', positions: ['G'] }).ok, false);
  assert.equal(parseWriteIn(null).ok, false);
  // The same position twice is one position.
  const dup = parseWriteIn({ name: 'Cooper Flagg', proTeam: 'DAL', positions: ['C', 'c'] });
  assert.ok(dup.ok && dup.player.positions.length === 1);
});

test('a name already picked, or a taken pool player, is taken', () => {
  const picks = { '3': { playerName: 'Cooper Flagg' } };
  const pool = [{ key: 'jokic', name: 'N. Jokic', fullName: 'Nikola Jokic' }, { key: 'luka', name: 'L. Doncic', fullName: 'Luka Doncic' }];
  assert.equal(nameTaken('cooper flagg', picks, pool, new Set()), true);
  assert.equal(nameTaken('Nikola Jokic', picks, pool, new Set(['jokic'])), true);
  assert.equal(nameTaken('Nikola Jokic', picks, pool, new Set()), false, 'in the pool but still available');
  assert.equal(nameTaken('Luka Doncic', picks, pool, new Set(['jokic'])), false);
});
