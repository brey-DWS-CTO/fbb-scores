import assert from 'node:assert/strict';
import test from 'node:test';
import { shortName } from '../src/lib/league/format.ts';

test('a name reads first initial, dot, last name', () => {
  assert.equal(shortName('Giannis Antetokounmpo'), 'G. Antetokounmpo');
  assert.equal(shortName('Jayson Tatum'), 'J. Tatum');
  assert.equal(shortName('  Jalen   Brunson '), 'J. Brunson');
});

test('a hyphenated last name keeps its hyphen', () => {
  assert.equal(shortName('Shai Gilgeous-Alexander'), 'S. Gilgeous-Alexander');
  assert.equal(shortName('Talen Horton-Tucker'), 'T. Horton-Tucker');
});

test('a suffix stays on the end', () => {
  assert.equal(shortName('Gary Trent Jr.'), 'G. Trent Jr.');
  assert.equal(shortName('Trey Murphy III'), 'T. Murphy III');
});

test('a last name of two words stays whole', () => {
  assert.equal(shortName('Tristan da Silva'), 'T. da Silva');
});

test('a one-word name stays as it is', () => {
  assert.equal(shortName('Nene'), 'Nene');
  assert.equal(shortName(''), '');
  assert.equal(shortName(null), '');
});

test('a "Player 12345" placeholder stays whole', () => {
  assert.equal(shortName('Player 12345'), 'Player 12345');
});
