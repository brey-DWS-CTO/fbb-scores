/**
 * The live mock: a person at one table, nine teams picking for themselves,
 * rebuilt from the seed and the person's choices every time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import { autoPick, nextLiveSlot, oddsGoneByNextPick, replayLive } from '../src/lib/league/liveMock.ts';
import { buildMockBoard, createMockRun, defaultMockSettings, prepareMock, runMock } from '../src/lib/league/mockDraft.ts';
import { applyPlayerPoolToDataset, playerPoolFromDataset } from '../src/lib/league/playerPool.ts';

const committed = rawDataset as unknown as LeagueDataset;
const known = new Set(committed.players.map((player) => player.espnId));
const dataset = applyPlayerPoolToDataset(committed, [
  ...playerPoolFromDataset(committed.players),
  ...fixture.players.filter((entry) => !known.has(entry.espnId)).map((entry) => ({
    key: `p${entry.espnId}`, espnId: entry.espnId, fullName: entry.fullName,
    proTeam: entry.proTeam, positions: entry.positions, sourceStatus: 'fetched' as const,
  })),
]);
const values = valueBoard(dataset.players, fixture);
const OWNERS = dataset.teams.map((team) => team.owner);
const select = (fullName: string) => {
  const found = dataset.players.find((player) => player.fullName === fullName);
  assert.ok(found, fullName);
  return { playerKey: found.key, playerName: found.name };
};
const state: LeagueDynamicState = {
  season: 2027, keepers: { Brey: [select('Cade Cunningham')] }, keepersRevealed: false,
  draft: { picks: {}, startedAt: null }, locks: { keepersLocked: false },
};
const board = buildMockBoard(dataset, { viewer: 'Brey', state, scenario: { Joel: [select('Nikola Jokic')] } });
const prepared = prepareMock({ board, values, settings: defaultMockSettings('realistic', OWNERS, 7) });

test('a pick at a time gives the same draft as the whole run', () => {
  const whole = runMock(prepared, 7);
  const run = createMockRun(prepared, 7);
  while (run.nextSlot()) run.next();
  assert.deepEqual(run.result().picks, whole.picks);
  assert.deepEqual(run.result().warnings, whole.warnings);
});

test('the replay stops at the person\'s first live pick and waits', () => {
  const live = replayLive(prepared, 7, 'Brey', {});
  // 1.9 is Cade, a keeper, so Brey's first live pick is 2.2 (overall 12).
  assert.equal(live.waitingOn?.pick.overall, 12);
  assert.equal(live.picks.length, 11);
  assert.equal(live.over, false);
  assert.ok(live.picks.every((pick) => pick.owner !== 'Brey' || pick.how === 'keeper'));
  assert.equal(live.picks[8].playerName, 'C. Cunningham');
  assert.equal(nextLiveSlot(prepared, 'Brey', 12)?.pick.overall, 29);
});

test('a choice is honoured, the rest follow, and undo is dropping the choice', () => {
  const first = replayLive(prepared, 7, 'Brey', {});
  const wanted = first.run.available()[3];
  const withPick = replayLive(prepared, 7, 'Brey', { 12: wanted.playerKey });
  assert.equal(withPick.picks[11].playerKey, wanted.playerKey);
  assert.equal(withPick.picks[11].how, 'pick');
  assert.equal(withPick.waitingOn?.pick.overall, 29);
  // The other teams' picks before his choice did not move.
  assert.deepEqual(withPick.picks.slice(0, 11), first.picks);
  // The same choices twice give the same draft.
  const again = replayLive(prepared, 7, 'Brey', { 12: wanted.playerKey });
  assert.deepEqual(again.picks, withPick.picks);
  // Undo: back to waiting at 12, and the board has him again.
  const undone = replayLive(prepared, 7, 'Brey', {});
  assert.equal(undone.waitingOn?.pick.overall, 12);
  assert.ok(undone.run.available().some((candidate) => candidate.playerKey === wanted.playerKey));
});

test('a gone or unknown player cannot be forced', () => {
  const live = replayLive(prepared, 7, 'Brey', {});
  const gone = live.picks.find((pick) => pick.how === 'pick')!.playerKey!;
  assert.throws(() => replayLive(prepared, 7, 'Brey', { 12: gone }), /already gone/);
  assert.throws(() => replayLive(prepared, 7, 'Brey', { 12: 'nobody' }), /No such player/);
});

test('the draft runs to the end with the person always taking the best value', () => {
  const choices: Record<number, string> = {};
  let live = replayLive(prepared, 7, 'Brey', choices);
  let guard = 0;
  while (live.waitingOn && guard < 20) {
    choices[live.waitingOn.pick.overall] = autoPick(live)!.playerKey;
    live = replayLive(prepared, 7, 'Brey', choices);
    guard += 1;
  }
  assert.equal(live.over, true);
  assert.equal(live.waitingOn, null);
  assert.equal(live.picks.length, board.slots.length);
  const result = live.run.result();
  assert.equal(result.lineups.Brey.open.length, 0, 'best value each time still fills a legal lineup');
});

test('odds of a player being gone by the next pick are between 0 and 1 and never count his own pick', () => {
  const live = replayLive(prepared, 7, 'Brey', {});
  const odds = oddsGoneByNextPick(prepared, 7, 'Brey', live, 30);
  assert.ok(odds.size > 5);
  for (const share of odds.values()) assert.ok(share > 0 && share <= 1);
  // 16 picks pass between 2.2 and 3.9, so the best values on the board are mostly gone.
  const best = live.run.available().slice(0, 3);
  assert.ok(best.some((candidate) => (odds.get(candidate.playerKey) ?? 0) > 0.5));
  // Nobody picked before now shows up.
  for (const pick of live.picks) if (pick.playerKey) assert.equal(odds.has(pick.playerKey), false);
});
