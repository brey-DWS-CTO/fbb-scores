/**
 * The acceptance test: the commissioner's own text message from 6 September
 * 2026, quoted in docs/MOCK-DRAFT-HANDOFF.md.
 *
 *   1. Joel - Jokic          6. Dustin - keeps Tatum
 *   2. Ryan - SGA/Giannis    7. Aaron's pick
 *   3. Pat - whoever is left 8. Derek - keeps Wemby
 *   4. Bryan - could take Cade
 *   5. Your pick (Kyle)      9. My pick (Brey)
 *                           10. Amy - keeps Luka
 *
 * "If we don't do this deal I'll keep Cade." So the deal world has Cade on the
 * board and Brey picking at 1.9; the no-deal world has Cade at 1.9 as a keeper.
 *
 * The numbers are ESPN's real 2026-27 draft ranks and ADP, captured into the
 * fixture. If the odds below look wrong to a fantasy basketball fan, they are
 * wrong, and the test should change only after the model does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import {
  availabilityAt,
  buildMockBoard,
  defaultMockSettings,
  describeRound,
  simulateDraft,
  simulateMany,
  type AvailabilityReport,
  type MockMode,
} from '../src/lib/league/mockDraft.ts';
import { applyPlayerPoolToDataset, playerPoolFromDataset } from '../src/lib/league/playerPool.ts';
import { leagueSchedule2027 } from '../src/lib/league/scheduleData.ts';

const committed = rawDataset as unknown as LeagueDataset;

// The draft pool is the committed dataset plus everyone ESPN ranks that it
// lacks, which is what the accepted player pool does in the app. Rookies and
// returning veterans have no season behind them and still have to be draftable.
const known = new Set(committed.players.map((player) => player.espnId));
const pool = [
  ...playerPoolFromDataset(committed.players),
  ...fixture.players
    .filter((entry) => !known.has(entry.espnId))
    .map((entry) => ({
      key: `p${entry.espnId}`,
      espnId: entry.espnId,
      fullName: entry.fullName,
      proTeam: entry.proTeam,
      positions: entry.positions,
      sourceStatus: 'fetched' as const,
    })),
];
const dataset = applyPlayerPoolToDataset(committed, pool);
const snapshot = { players: fixture.players.map((entry) => ({ ...entry, projection: null })), scoringItems: [] };
const values = valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027 });
const OWNERS = dataset.teams.map((team) => team.owner);

const select = (fullName: string) => {
  const found = dataset.players.find((player) => player.fullName === fullName);
  assert.ok(found, `fixture needs ${fullName}`);
  return { playerKey: found.key, playerName: found.name };
};

const state: LeagueDynamicState = {
  season: 2027,
  keepers: {},
  keepersRevealed: false,
  draft: { picks: {}, startedAt: null },
  locks: { keepersLocked: false },
};

const textMessage = {
  Joel: [select('Nikola Jokic')],
  Dustin: [select('Jayson Tatum')],
  Derek: [select('Victor Wembanyama')],
  Amy: [select('Luka Doncic')],
};

const dealWorld = buildMockBoard(dataset, { viewer: 'Brey', state, scenario: textMessage });
const RUNS = 200;
const SEED = 7;

function run(mode: MockMode) {
  return simulateMany({ board: dealWorld, values, settings: defaultMockSettings(mode, OWNERS, SEED) }, RUNS);
}

const share = (report: AvailabilityReport, name: string): number =>
  report.rows.find((row) => row.playerName === name)?.availableShare ?? 0;
const takenMostOften = (report: AvailabilityReport): string[] =>
  [...report.rows].sort((a, b) => b.takenHere - a.takenHere).slice(0, 2).map((row) => row.playerName);

test('round one reads like the text message: keepers in their slots, the rest live', () => {
  assert.deepEqual(dealWorld.rejected, [], 'every assumed keeper is legal');
  const roundOne = dealWorld.slots.filter((slot) => slot.pick.round === 1);
  assert.deepEqual(
    roundOne.map((slot) => `${slot.pick.slot} ${slot.pick.currentOwner}${slot.keeper ? ' - ' + slot.keeper.playerName : ''}`),
    [
      '1 Joel - N. Jokic',
      '2 Ryan',
      '3 Patrick',
      '4 Bryan',
      '5 Kyle',
      '6 Dustin - J. Tatum',
      '7 Aaron',
      '8 Derek - V. Wembanyama',
      '9 Brey',
      '10 Amy - L. Doncic',
    ],
  );
  assert.ok(roundOne.filter((slot) => slot.keeper).every((slot) => slot.keeper?.status === 'assumed'));
  assert.deepEqual(dealWorld.assumedOwners.length, 9);
});

test('realistic: Ryan and Pat split SGA and Giannis, and Bryan can take Cade', () => {
  const results = run('realistic');
  const at2 = availabilityAt(results, 2);
  const at3 = availabilityAt(results, 3);
  const at5 = availabilityAt(results, 5);
  const sgaOrGiannisAt2 = at2.rows
    .filter((row) => ['S. Gilgeous-Alexander', 'G. Antetokounmpo'].includes(row.playerName))
    .reduce((total, row) => total + row.takenHereShare, 0);
  assert.ok(sgaOrGiannisAt2 >= 0.95, `Ryan takes SGA or Giannis: ${sgaOrGiannisAt2}`);
  const leftoverAt3 = at3.rows
    .filter((row) => ['S. Gilgeous-Alexander', 'G. Antetokounmpo'].includes(row.playerName))
    .reduce((total, row) => total + row.takenHereShare, 0);
  // Giannis (ADP 5.3) and Edwards (ADP 6.7) overlap in real rooms, so a
  // realistic Pat takes Edwards over the leftover about a quarter of the time.
  assert.ok(leftoverAt3 >= 0.7, `Pat usually takes whoever is left: ${leftoverAt3}`);
  assert.ok(share(at5, 'S. Gilgeous-Alexander') <= 0.1, 'SGA is gone by Kyle');
  assert.ok(share(at5, 'G. Antetokounmpo') <= 0.1, 'so is Giannis');
  assert.ok(share(at5, 'C. Cunningham') >= 0.5, `Cade is usually still there for Kyle: ${share(at5, 'C. Cunningham')}`);
  assert.ok(share(at5, 'C. Cunningham') < 1, 'but Bryan sometimes takes him, as the message says');
  assert.ok(share(at5, 'A. Edwards') >= 0.2 && share(at5, 'A. Edwards') <= 0.7, `Edwards is a coin flip at 5: ${share(at5, 'A. Edwards')}`);
  assert.ok(share(at5, 'A. Davis') >= 0.8, 'the room lets Davis slide, as his ADP says');
});

test('realistic: at Brey pick 9 the board is a distribution, not a name', () => {
  const results = run('realistic');
  const at5 = availabilityAt(results, 5);
  const at9 = availabilityAt(results, 9);
  assert.equal(at9.label, '1.9');
  assert.equal(at9.owner, 'Brey');
  assert.ok(share(at9, 'C. Cunningham') <= 0.3, `Cade rarely lasts to 9: ${share(at9, 'C. Cunningham')}`);
  assert.ok(share(at9, 'C. Cunningham') < share(at5, 'C. Cunningham'), 'and less often than at 5');
  assert.ok(share(at9, 'A. Davis') >= 0.3 && share(at9, 'A. Davis') <= 0.75, `Davis is the real question at 9: ${share(at9, 'A. Davis')}`);
  assert.ok(share(at9, 'L. James') >= 0.5, `LeBron is usually there: ${share(at9, 'L. James')}`);
  assert.ok(share(at9, 'D. Sabonis') >= 0.85, `Sabonis nearly always: ${share(at9, 'D. Sabonis')}`);
  for (const keeper of ['N. Jokic', 'J. Tatum', 'V. Wembanyama', 'L. Doncic']) {
    assert.equal(share(at9, keeper), 0, `${keeper} is kept and never on the board`);
  }
  const likely = ['A. Davis', 'L. James', 'C. Cunningham', 'D. Sabonis', 'K. Towns', 'T. Maxey', 'T. Young', 'J. Harden'];
  for (const name of takenMostOften(at9)) {
    assert.ok(likely.includes(name), `Brey most often takes someone a fan would expect, not ${name}`);
  }
  assert.ok(results.every((result) => result.warnings.length === 0), 'every roster fills legally');
});

test('sharp and realistic disagree, and the disagreement is the bargain', () => {
  const realistic = availabilityAt(run('realistic'), 9);
  const sharp = availabilityAt(run('sharp'), 9);
  // Davis: our value says top six, the room's ADP says twelfth. A sharp room
  // takes him before 9; a realistic one leaves him there half the time.
  assert.ok(share(realistic, 'A. Davis') - share(sharp, 'A. Davis') >= 0.25, `Davis: realistic ${share(realistic, 'A. Davis')}, sharp ${share(sharp, 'A. Davis')}`);
  // Sabonis: ESPN ranks him ninth, the room drafts him nineteenth. Sharp
  // rooms take him earlier than realistic ones do.
  assert.ok(share(realistic, 'D. Sabonis') > share(sharp, 'D. Sabonis'), 'the room lets Sabonis slide further than value would');
});

test('the no-deal world keeps Cade at 1.9 and takes him off the board', () => {
  const noDeal = buildMockBoard(dataset, {
    viewer: 'Brey',
    state,
    scenario: { ...textMessage, Brey: [select('Cade Cunningham')] },
  });
  const nine = noDeal.slots.find((slot) => slot.pick.overall === 9)!;
  assert.equal(nine.pick.currentOwner, 'Brey');
  assert.equal(nine.keeper?.playerName, 'C. Cunningham');
  assert.equal(nine.keeper?.status, 'assumed', 'his own what-if, not a locked keeper');
  assert.ok(noDeal.taken.includes(select('Cade Cunningham').playerKey));

  const one = simulateDraft({ board: noDeal, values, settings: defaultMockSettings('realistic', OWNERS, SEED) });
  assert.equal(one.picks[8].how, 'keeper');
  assert.equal(one.picks.filter((pick) => pick.playerName === 'C. Cunningham').length, 1);
  const results = simulateMany({ board: noDeal, values, settings: defaultMockSettings('realistic', OWNERS, SEED) }, 50);
  assert.equal(availabilityAt(results, 5).rows.some((row) => row.playerName === 'C. Cunningham'), false, 'Bryan cannot take Cade now');
  assert.match(describeRound(one, 1)[8], /^1\.9 Brey: C\. Cunningham \(assumed keeper\)$/);
});
