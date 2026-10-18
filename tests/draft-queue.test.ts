import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanQueue, firstQueued, MAX_QUEUE } from '../src/lib/league/draftQueue.js';

test('the top queued player still there is taken', () => {
  assert.equal(firstQueued(['jokic', 'luka', 'sga'], new Set(['sga', 'luka'])), 'luka');
  assert.equal(firstQueued(['jokic'], new Set(['sga'])), null);
  assert.equal(firstQueued(undefined, new Set(['sga'])), null);
});

test('a saved queue is a list of keys, no repeats, capped', () => {
  assert.deepEqual(cleanQueue(['a', 'b', 'a']), ['a', 'b']);
  assert.equal(cleanQueue('a'), null);
  assert.equal(cleanQueue(['a', 3]), null);
  assert.equal(cleanQueue(Array.from({ length: 90 }, (_, i) => `p${i}`))?.length, MAX_QUEUE);
});
