import assert from 'node:assert/strict';
import test from 'node:test';
import { castAction, castOwnership, castRunningTotals, castShortName } from '../src/lib/league/castPresentation.js';
import { LEAGUE_SCORING } from '../src/lib/league/partyScore.js';
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

test('compact names use first name and last initial, omitting suffixes', () => {
  assert.equal(castShortName('Darius Garland'), 'Darius G.');
  assert.equal(castShortName('Michael Porter Jr.'), 'Michael P.');
  assert.equal(castShortName('Karl-Anthony Towns'), 'Karl-Anthony T.');
});

test('running totals include negative plays and reset per NBA game', () => {
  const players = [{ athleteId: '1', name: 'Darius Garland', shortName: 'D. Garland', team: 'LAC', played: true, stats: {} }];
  const plays = parseCastPlays({ plays: [{ id: '1', text: 'Darius Garland makes two point shot' }, { id: '2', text: 'Darius Garland misses 24-foot three point jumper' }] }, '1', 'SAC @ LAC', players);
  const next = parseCastPlays({ plays: [{ id: '1', text: 'Darius Garland makes free throw 1 of 1' }] }, '2', 'LAC @ BOS', players);
  const totals = castRunningTotals([...plays, ...next], LEAGUE_SCORING);
  assert.equal(totals.get(plays[0].changes[0]), 3);
  assert.equal(totals.get(plays[1].changes[0]), 2.3);
  assert.equal(totals.get(next[0].changes[0]), 1);
});
