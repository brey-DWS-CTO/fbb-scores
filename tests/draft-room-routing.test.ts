import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import {
  callDraftClock, clearDraftPick, expireDraftClock, fetchLeagueState,
  joinTestDraft, leaveTestDraft, pauseDraftClock, resumeDraftClock, submitDraftPick,
} from '../src/lib/league/api.js';
import { draftRoomHeaders, type DraftRoom } from '../src/lib/league/testDraft.js';

test('draft actions keep the displayed room when another tab changes storage', async (t) => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const sent: Array<Record<string, string>> = [];
  t.mock.method(axios, 'post', async (_url: string, _body: unknown, config: { headers: Record<string, string> }) => {
    sent.push(config.headers); return { data: {} };
  });
  t.mock.method(axios, 'delete', async (_url: string, config: { headers: Record<string, string> }) => {
    sent.push(config.headers); return { data: {} };
  });
  t.mock.method(axios, 'get', async (_url: string, config: { headers: Record<string, string> }) => {
    sent.push(config.headers); return { data: {} };
  });
  const identity = { owner: 'Joel', pin: 'test-only' };
  const testRoom: DraftRoom = { side: 'test', startedAt: '2026-10-17T20:00:00.000Z' };
  const pick = { overallPick: 1, playerKey: 'player', playerName: 'Player' };
  joinTestDraft();
  leaveTestDraft(); // another tab leaves while this tab still shows its test board
  await submitDraftPick(identity, pick, testRoom);
  await clearDraftPick(identity, 1, testRoom);
  await callDraftClock(identity, testRoom);
  await expireDraftClock(identity, 1, testRoom);
  await pauseDraftClock(identity, testRoom);
  await resumeDraftClock(identity, testRoom);
  for (const headers of sent) {
    assert.equal(headers['x-test-draft'], '1');
    assert.equal(headers['x-test-draft-started-at'], testRoom.startedAt);
  }
  await fetchLeagueState(identity, true);
  assert.equal(sent.at(-1)!['x-test-draft'], '1');
  joinTestDraft(); // another tab joins while this one still shows the live board
  await submitDraftPick(identity, pick, { side: 'league' });
  assert.equal(sent.at(-1)!['x-test-draft'], undefined);
  assert.throws(() => draftRoomHeaders({ side: 'test', startedAt: null }), /load/);
});
