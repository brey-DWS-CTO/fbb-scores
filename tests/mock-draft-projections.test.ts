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
 * The numbers are ESPN's live projections, ranks and ADP, captured into the
 * fixture. If the odds below look wrong to a fantasy basketball fan, they are
 * wrong, and the test should change only after the model does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
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
const snapshot = fixture;
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

test('projections: the realistic room keeps stars early and leaves several options at 1.9', () => {
  const results = run('realistic');
  const at2 = availabilityAt(results, 2);
  const at5 = availabilityAt(results, 5);
  const at9 = availabilityAt(results, 9);
  assert.equal(values.primary, 'projection');
  assert.equal(values.counts.projection, 348);
  const starsAt2 = at2.rows.filter((row) => ['S. Gilgeous-Alexander', 'G. Antetokounmpo'].includes(row.playerName))
    .reduce((sum, row) => sum + row.takenHereShare, 0);
  assert.ok(starsAt2 >= 0.95);
  assert.ok(share(at5, 'S. Gilgeous-Alexander') <= 0.1);
  assert.ok(share(at5, 'G. Antetokounmpo') <= 0.2);
  assert.ok(share(at5, 'C. Cunningham') > 0.5 && share(at5, 'C. Cunningham') < 1);
  assert.ok(share(at9, 'C. Cunningham') < share(at5, 'C. Cunningham'));
  assert.ok(share(at9, 'D. Mitchell') > 0.5 && share(at9, 'D. Mitchell') < 0.9);
  assert.ok(takenMostOften(at9).includes('D. Mitchell'));
  for (const keeper of ['N. Jokic', 'J. Tatum', 'V. Wembanyama', 'L. Doncic']) {
    assert.equal(share(at9, keeper), 0);
  }
  assert.ok(results.every((result) => result.warnings.length === 0));
});

test('projections: Jalen Johnson goes early in a sharp room and Mitchell is the pick at 1.9', () => {
  const sharpRuns = run('sharp');
  const sharp5 = availabilityAt(sharpRuns, 5);
  const realistic5 = availabilityAt(run('realistic'), 5);
  assert.ok(share(sharp5, 'J. Johnson') < 0.1);
  assert.ok(share(realistic5, 'J. Johnson') > 0.6);
  const sharp9 = availabilityAt(sharpRuns, 9);
  assert.equal(takenMostOften(sharp9)[0], 'D. Mitchell');
  assert.ok(sharp9.rows.find((row) => row.playerName === 'D. Mitchell')!.takenHereShare > 0.5);
  assert.ok(sharpRuns.every((result) => result.warnings.length === 0));
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


if (process.env.REPORT_PROJECTIONS === '1') {
  for (const mode of ['sharp', 'realistic'] as const) {
    const results = run(mode);
    console.log(mode, describeRound(simulateDraft({ board: dealWorld, values, settings: defaultMockSettings(mode, OWNERS, SEED) }), 1));
    for (const pick of [5, 9]) {
      console.log(mode, pick, availabilityAt(results, pick).rows.slice(0, 18).map((row) => [row.playerName, row.availableShare, row.takenHereShare]));
    }
  }
  console.log('Value top 25', values.counts, values.entries.slice(0, 25).map((entry) => [entry.player.fullName, entry.rank, entry.espnRank, entry.fppg, entry.availability]));
}
