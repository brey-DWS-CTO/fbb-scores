import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { BoardCell, DraftPickState, LeagueDataset, LeagueDynamicState, ResolvedKeeper } from '../src/lib/keeper/types.ts';
import { buildDraftBoard } from '../src/lib/keeper/engine.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import { buildProjections } from '../src/lib/league/projections.ts';
import {
  ageOn,
  buildDraftRecap,
  gradeForComposite,
  nextRecapSort,
  numbersRoast,
  parseRoast,
  recapCsv,
  recapPage,
  recapRows,
  verdictFor,
  type RecapInput,
  type RecapPick,
} from '../src/lib/league/draftRecap.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const values = valueBoard(dataset.players, fixture, { projectionsOnly: true });
const projections = new Map(buildProjections(values, fixture, { keepers: {}, status: {} })
  .map((row) => [row.key, { total: row.total, games: row.games, adp: row.adp }]));
const teams = dataset.teams.map((team) => ({ owner: team.owner, name: team.espnTeamName, draftPosition: team.draftPosition }));
const OWNERS = teams.map((team) => team.owner);

/** Everyone drafts down the value board; Kyle is on auto, Joel thinks hard, Brey calls clocks. */
function finishedState(): LeagueDynamicState {
  const state: LeagueDynamicState = {
    season: 2027, keepers: {}, keepersRevealed: true,
    draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z' }, locks: { keepersLocked: true },
  };
  const order = values.entries.filter((entry) => entry.seasonValue !== null);
  const board = buildDraftBoard(dataset, state);
  board.forEach((cell, index) => {
    const entry = order[index];
    const owner = cell.pick.currentOwner;
    const pick: DraftPickState = {
      playerKey: entry.player.key,
      playerName: entry.player.name,
      proTeam: entry.player.proTeam,
      positions: entry.player.positions,
      timestamp: new Date(Date.parse('2026-10-18T21:00:00.000Z') + index * 60_000).toISOString(),
      seconds: owner === 'Kyle' ? 0 : owner === 'Joel' ? 150 : 30,
      clockCalledBy: owner === 'Joel' && cell.pick.round === 2 ? 'Brey' : null,
      auto: owner === 'Kyle',
    };
    state.draft.picks[String(cell.pick.overall)] = pick;
  });
  return state;
}

function inputFor(state: LeagueDynamicState, extra: Partial<RecapInput> = {}): RecapInput {
  return {
    season: 2027,
    board: buildDraftBoard(dataset, state),
    values,
    projections,
    teams,
    ages: { [String(dataset.players[0].espnId)]: { born: '2000-10-19', draftYear: 2026 } },
    asOf: '2026-10-18T21:00:00.000Z',
    ...extra,
  };
}

test('ages count whole years, the day before a birthday included', () => {
  assert.equal(ageOn('2000-10-19', '2026-10-18T21:00:00.000Z'), 25);
  assert.equal(ageOn('2000-10-18', '2026-10-18T21:00:00.000Z'), 26);
  assert.equal(ageOn(null, '2026-10-18'), null);
  assert.equal(ageOn('not a date', '2026-10-18'), null);
});

test('verdicts and grades follow their lines', () => {
  assert.equal(verdictFor(null), 'No numbers');
  assert.equal(verdictFor(1), 'Steal');
  assert.equal(verdictFor(0.3), 'Good value');
  assert.equal(verdictFor(0), 'Fair price');
  assert.equal(verdictFor(-0.5), 'A bit early');
  assert.equal(verdictFor(-1.2), 'Reach');
  assert.equal(gradeForComposite(1.8), 'A');
  assert.equal(gradeForComposite(0), 'B');
  assert.equal(gradeForComposite(-1.3), 'C-');
  assert.equal(gradeForComposite(-3), 'D');
});

test('a full draft grades every team once, best composite first', () => {
  const recap = buildDraftRecap(inputFor(finishedState()));
  assert.equal(recap.complete, true);
  assert.equal(recap.picks.length, 140);
  assert.equal(recap.headline.picks, 140);
  assert.deepEqual(new Set(recap.teams.map((team) => team.owner)), new Set(OWNERS));
  assert.deepEqual(recap.teams.map((team) => team.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let i = 1; i < recap.teams.length; i += 1) assert.ok(recap.teams[i - 1].composite >= recap.teams[i].composite);
  for (const team of recap.teams) {
    assert.ok(team.floor <= team.projected && team.projected <= team.ceiling, `${team.owner} floor, projected, ceiling in order`);
    assert.ok(team.best && team.worst);
    assert.ok((team.best!.score ?? 0) >= (team.worst!.score ?? 0));
  }
  // Drafting straight down the value board lands near fair on average; ADP pulls some picks each way.
  const scores = recap.picks.map((pick) => pick.score).filter((score): score is number => score !== null);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  assert.ok(Math.abs(mean) < 0.5, `mean score ${mean}`);
});

test('the clock numbers skip auto picks and count calls both ways', () => {
  const recap = buildDraftRecap(inputFor(finishedState()));
  const kyle = recap.teams.find((team) => team.owner === 'Kyle')!;
  const joel = recap.teams.find((team) => team.owner === 'Joel')!;
  const brey = recap.teams.find((team) => team.owner === 'Brey')!;
  assert.equal(kyle.averageSeconds, null);
  assert.equal(kyle.autoPicks, 14);
  assert.equal(joel.averageSeconds, 150);
  assert.equal(recap.slowest?.owner, 'Joel');
  assert.notEqual(recap.fastest?.owner, 'Kyle');
  assert.equal(recap.fastest?.averageSeconds, 30);
  assert.equal(brey.clockCalls, 1);
  assert.equal(joel.timesClocked, 1);
  assert.equal(recap.headline.autoPicks, 14);
  assert.equal(recap.headline.clockCalls, 1);
  const human = recap.picks.filter((pick) => !pick.auto).map((pick) => pick.seconds!);
  assert.equal(recap.headline.averageSeconds, Math.round(human.reduce((sum, value) => sum + value, 0) / human.length));
  assert.equal(recap.headline.lengthMinutes, 139);
  assert.ok(recap.makeup.some((row) => row.label === 'Most auto picks' && row.who === 'Kyle'));
});

test('a keeper is measured against the pick he cost', () => {
  const state = finishedState();
  const board = buildDraftBoard(dataset, state);
  const star = values.entries[0];
  // Put the best player on the board as a round-eight keeper.
  const cell = board.find((entry) => entry.pick.round === 8)!;
  const kept: BoardCell = {
    ...cell,
    selection: null,
    keeper: { selection: { playerKey: star.player.key, playerName: star.player.name }, player: star.player } as ResolvedKeeper,
  };
  const recap = buildDraftRecap(inputFor(state, { board: board.map((entry) => (entry === cell ? kept : entry)) }));
  const pick = recap.picks.find((entry) => entry.overall === cell.pick.overall)!;
  assert.equal(pick.keeper, true);
  assert.equal(pick.verdict, 'Steal');
  assert.equal(recap.headline.keepers, 1);
  assert.equal(recap.bestKeeper?.overall, cell.pick.overall);
});

test('ages and rookies come from the age file', () => {
  const recap = buildDraftRecap(inputFor(finishedState()));
  const first = recap.picks.find((pick) => pick.key === dataset.players[0].key);
  if (first) {
    assert.equal(first.age, 25);
    assert.equal(first.rookie, true);
  }
});

test('roasts: saved beats draft night, and an empty save hands it to the numbers', () => {
  const seedRoasts = { Joel: 'Draft night line.', Amy: 'Amy line.' };
  const recap = buildDraftRecap(inputFor(finishedState(), { seedRoasts, roasts: { Joel: '  Saved line. ', Amy: '' } }));
  const joel = recap.teams.find((team) => team.owner === 'Joel')!;
  const amy = recap.teams.find((team) => team.owner === 'Amy')!;
  const ryan = recap.teams.find((team) => team.owner === 'Ryan')!;
  assert.equal(joel.roast, 'Saved line.');
  assert.equal(joel.roastSource, 'saved');
  assert.equal(amy.roastSource, 'numbers');
  assert.notEqual(amy.roast, 'Amy line.');
  assert.equal(ryan.roastSource, 'numbers');
  const seeded = buildDraftRecap(inputFor(finishedState(), { seedRoasts }));
  assert.equal(seeded.teams.find((team) => team.owner === 'Amy')!.roast, 'Amy line.');
});

test('the numbers roast says something about an auto drafter', () => {
  const line = numbersRoast(
    { owner: 'Kyle', averageAge: 26, rookies: [], positions: { PG: 4, SG: 4, SF: 2, PF: 2, C: 2 }, stacks: [], autoPicks: 12, best: null, worst: null, clockCalls: 0 },
    [{ owner: 'Kyle', averageAge: 26 }, { owner: 'Amy', averageAge: 29 }, { owner: 'Brey', averageAge: 25 }],
  );
  assert.match(line, /app made 12/);
});

test('the pick table searches every column, sorts with blanks last, and pages', () => {
  const recap = buildDraftRecap(inputFor(finishedState()));
  const joelOnly = recapRows(recap.picks, 'joel', null);
  assert.ok(joelOnly.length >= 14);
  assert.ok(joelOnly.every((pick) => JSON.stringify(pick).toLowerCase().includes('joel')));
  const byAge = recapRows(recap.picks, '', { column: 'age', dir: 'desc' });
  const firstBlank = byAge.findIndex((pick) => pick.age === null);
  assert.ok(firstBlank === -1 || byAge.slice(firstBlank).every((pick) => pick.age === null));
  assert.deepEqual(nextRecapSort(null, 'age'), { column: 'age', dir: 'asc' });
  assert.deepEqual(nextRecapSort({ column: 'age', dir: 'asc' }, 'age'), { column: 'age', dir: 'desc' });
  assert.equal(nextRecapSort({ column: 'age', dir: 'desc' }, 'age'), null);
  const page = recapPage(recap.picks, 3, 50);
  assert.deepEqual([page.page, page.pageCount, page.from, page.to, page.total], [3, 3, 101, 140, 140]);
});

test('the CSV quotes commas and quotes', () => {
  const pick = { overall: 1, round: 1, owner: 'Joel', name: 'Smith, "Big" Jr.', positions: ['C'], proTeam: 'DEN', age: 30, born: null, fppg: 50, games: 70, valueRank: 1, adp: 1.04, seconds: 12, score: 0, verdict: 'Fair price', keeper: false, auto: false } as unknown as RecapPick;
  const csv = recapCsv([pick]);
  assert.match(csv, /^Pick,Team,Player,/);
  assert.match(csv, /"Smith, ""Big"" Jr\."/);
  assert.match(csv, /,12,0,Fair price\n$/);
});

test('a roast must name a league team and stay short', () => {
  assert.deepEqual(parseRoast(OWNERS, { owner: 'Joel', text: '  two\n  lines ' }), { owner: 'Joel', text: 'two lines' });
  assert.deepEqual(parseRoast(OWNERS, { owner: 'Joel', text: '' }), { owner: 'Joel', text: '' });
  assert.throws(() => parseRoast(OWNERS, { owner: 'Nobody', text: 'x' }), /team in the league/);
  assert.throws(() => parseRoast(OWNERS, { owner: 'Joel', text: 5 }), /as text/);
  assert.throws(() => parseRoast(OWNERS, { owner: 'Joel', text: 'x'.repeat(601) }), /600/);
});
