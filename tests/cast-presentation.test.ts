import assert from 'node:assert/strict';
import test from 'node:test';
import { castAction, castOwnership } from '../src/lib/league/castPresentation.js';
import { parseCastPlays } from '../src/lib/league/fantasyCast.js';

test('keeps the full missed-shot detail without repeating the player or generic stat', () => {
  const [play] = parseCastPlays({ plays: [{ text: 'Naz Reid misses 24-foot three point jumper' }] }, '1', 'CHA @ BKN', [{ athleteId: '1', name: 'Naz Reid', shortName: 'N. Reid', team: 'CHA', played: true, stats: {} }]);
  assert.equal(castAction(play, play.changes[0]), 'misses 24-foot three point jumper');
  assert.equal(play.changes[0].stats['23'], 1);
});

test('ownership stays independent of positive and negative point changes', () => {
  assert.equal(castOwnership(1, 1, 2), 'own');
  assert.equal(castOwnership(2, 1, 2), 'opponent');
  assert.equal(castOwnership(3, 1, 2), 'neutral');
  assert.equal(castOwnership(undefined, 1, 2), 'neutral');
  assert.equal(castOwnership(1, undefined, undefined), 'neutral');
});
