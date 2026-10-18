import assert from 'node:assert/strict';
import test from 'node:test';
import { inRoom, PRESENCE_WINDOW_MS, roomChanges } from '../src/lib/league/presence.js';

const ORDER = ['Joel', 'Ryan', 'Patrick', 'Brey'];
const NOW = Date.parse('2026-10-16T20:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('owners seen inside the window are in, in draft order', () => {
  const rows = [
    { owner: 'Brey', seenAt: ago(1_000) },
    { owner: 'Ryan', seenAt: ago(PRESENCE_WINDOW_MS) },
    { owner: 'Joel', seenAt: ago(PRESENCE_WINDOW_MS + 1) },
  ];
  assert.deepEqual(inRoom(rows, NOW, ORDER), ['Ryan', 'Brey']);
});

test('joins and leaves between two looks; the first look reports nothing', () => {
  assert.deepEqual(roomChanges(null, ['Brey']), { joined: [], left: [] });
  assert.deepEqual(roomChanges(['Brey', 'Joel'], ['Brey', 'Ryan']), { joined: ['Ryan'], left: ['Joel'] });
  assert.deepEqual(roomChanges(['Brey'], ['Brey']), { joined: [], left: [] });
});
