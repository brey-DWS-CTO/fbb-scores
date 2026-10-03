import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import {
  buildProjections,
  changeTone,
  filterProjections,
  gamesTone,
  keeperIndex,
  nextSort,
  pageOf,
  projectionsToCsv,
  sortProjections,
  type PlayerProjection,
} from '../src/lib/league/projections.ts';
import { leagueSchedule2027 } from '../src/lib/league/scheduleData.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const values = valueBoard(dataset.players, fixture, { schedule: leagueSchedule2027 });
const find = (rows: readonly PlayerProjection[], name: string) => {
  const row = rows.find((entry) => entry.name === name);
  assert.ok(row, `${name} is on the board`);
  return row;
};
const keyOf = (name: string) => dataset.players.find((player) => (player.fullName ?? player.name) === name)!.key;

const NO_KEEPERS = { keepers: {}, status: {} };
const rows = buildProjections(values, fixture, NO_KEEPERS);

test('one row per player on the board, in board order', () => {
  assert.equal(rows.length, values.entries.length);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.valueRank), [1, 2, 3, 4, 5]);
});

test('Jokic: ESPN line plus the double-double bonus adds up to his FPPG', () => {
  const jokic = find(rows, 'Nikola Jokic');
  assert.equal(jokic.source, 'projection');
  assert.equal(jokic.games, 72);
  assert.ok(jokic.fppg! > 63 && jokic.fppg! < 67, `fppg ${jokic.fppg}`);
  assert.ok(jokic.base! > 59 && jokic.base! < 62, `base ${jokic.base}`);
  assert.equal(Math.round((jokic.base! + jokic.bonus!) * 10) / 10, jokic.fppg);
  assert.ok(jokic.ddOdds! > 0.85, `dd ${jokic.ddOdds}`);
  assert.ok(jokic.tdOdds! > 0.35, `td ${jokic.tdOdds}`);
  // 2034 points over 72 games.
  assert.equal(jokic.line!.pts, 28.3);
  assert.equal(jokic.lastSeason, 64.2);
  assert.equal(jokic.change, Math.round((jokic.fppg! - 64.2) * 10) / 10);
});

test('a guard who never reaches ten boards gets almost no bonus', () => {
  const guard = rows.find((row) => row.source === 'projection' && row.line && row.line.reb < 4 && row.line.ast < 5);
  assert.ok(guard);
  assert.ok(guard.bonus! < 0.3, `${guard.name} bonus ${guard.bonus}`);
});

test('a player with no projection keeps his row with the projection columns empty', () => {
  const bare = rows.find((row) => row.source !== 'projection');
  assert.ok(bare);
  assert.equal(bare.base, null);
  assert.equal(bare.bonus, null);
  assert.equal(bare.line, null);
});

test('without scoring there is no base or bonus, only the line', () => {
  const unscored = buildProjections(values, { ...fixture, scoringItems: [] }, NO_KEEPERS);
  const jokic = find(unscored, 'Nikola Jokic');
  assert.equal(jokic.base, null);
  assert.equal(jokic.bonus, null);
  assert.ok(jokic.line);
});

test('keepers are tagged known or projected, with the owner', () => {
  const tatum = keyOf('Jayson Tatum');
  const luka = keyOf('Luka Doncic');
  const sets = {
    keepers: { Dustin: [{ playerKey: tatum, playerName: 'Jayson Tatum' }], Amy: [{ playerKey: luka, playerName: 'Luka Doncic' }] },
    status: { Dustin: 'known' as const, Amy: 'assumed' as const },
  };
  assert.equal(keeperIndex(sets).size, 2);
  const tagged = buildProjections(values, fixture, sets);
  assert.deepEqual([find(tagged, 'Jayson Tatum').tag, find(tagged, 'Jayson Tatum').keptBy], ['keeper', 'Dustin']);
  assert.deepEqual([find(tagged, 'Luka Doncic').tag, find(tagged, 'Luka Doncic').keptBy], ['projected', 'Amy']);
  assert.equal(find(tagged, 'Nikola Jokic').tag, 'open');

  const open = filterProjections(tagged, { hideKept: true });
  assert.equal(open.length, tagged.length - 2);
  assert.ok(!open.some((row) => row.name === 'Luka Doncic'));
});

test('filter by position and by words across columns', () => {
  const centres = filterProjections(rows, { position: 'C' });
  assert.ok(centres.length > 20);
  assert.ok(centres.every((row) => row.positions.includes('C')));
  assert.deepEqual(filterProjections(rows, { query: 'jokic' }).map((row) => row.name), ['Nikola Jokic']);
  const den = filterProjections(rows, { query: '  DEN  jokic ' });
  assert.deepEqual(den.map((row) => row.name), ['Nikola Jokic']);
  assert.equal(filterProjections(rows, { query: 'nobody-by-this-name' }).length, 0);
});

test('sort cycles best-first, flipped, then board order', () => {
  const first = nextSort(null, 'fppg');
  assert.deepEqual(first, { column: 'fppg', dir: 'desc' });
  const second = nextSort(first, 'fppg');
  assert.deepEqual(second, { column: 'fppg', dir: 'asc' });
  assert.equal(nextSort(second, 'fppg'), null);
  assert.deepEqual(nextSort(second, 'adp'), { column: 'adp', dir: 'asc' });
});

test('sorting puts blanks last both ways and never loses a row', () => {
  for (const dir of ['asc', 'desc'] as const) {
    const sorted = sortProjections(rows, { column: 'games', dir });
    assert.equal(sorted.length, rows.length);
    const firstBlank = sorted.findIndex((row) => row.games === null);
    assert.ok(firstBlank > 0);
    assert.ok(sorted.slice(firstBlank).every((row) => row.games === null));
    const numbers = sorted.slice(0, firstBlank).map((row) => row.games!);
    const ordered = [...numbers].sort((a, b) => (dir === 'asc' ? a - b : b - a));
    assert.deepEqual(numbers, ordered);
  }
  const byFppg = sortProjections(rows, { column: 'fppg', dir: 'desc' });
  assert.equal(byFppg[0].name, 'Nikola Jokic');
  assert.deepEqual(sortProjections(byFppg, null).map((row) => row.key), rows.map((row) => row.key));
});

test('pages clamp and count from one', () => {
  const page = pageOf(rows, 1, 50);
  assert.equal(page.rows.length, 50);
  assert.deepEqual([page.from, page.to, page.total], [1, 50, rows.length]);
  const last = pageOf(rows, 999, 50);
  assert.equal(last.page, last.pageCount);
  assert.equal(last.to, rows.length);
  const empty = pageOf([], 3, 50);
  assert.deepEqual([empty.page, empty.pageCount, empty.from, empty.to], [1, 1, 0, 0]);
});

test('colour thresholds', () => {
  assert.equal(changeTone(3), 'good');
  assert.equal(changeTone(-3.4), 'bad');
  assert.equal(changeTone(1), null);
  assert.equal(changeTone(null), null);
  assert.equal(gamesTone(72), 'good');
  assert.equal(gamesTone(60), 'warn');
  assert.equal(gamesTone(40), 'bad');
});

test('CSV has a header, one line per row, and quotes what needs it', () => {
  const sample = [{ ...find(rows, 'Nikola Jokic'), name: 'Jokic, "The Joker"' }];
  const lines = projectionsToCsv(sample).trimEnd().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('#,Player,Team'));
  assert.ok(lines[1].startsWith('1,'));
  assert.ok(lines[1].includes('"Jokic, ""The Joker"""'));
});

test('the full stat line: minutes, shooting, and percents from makes over tries', () => {
  const line = find(rows, 'Nikola Jokic').line!;
  // Season totals over 72 games: 2563.2 min, 762/1325 FG, 388/475 FT.
  assert.equal(line.min, 35.6);
  assert.equal(line.fgm, 10.6);
  assert.equal(line.fga, 18.4);
  assert.equal(line.fgPct, 57.5);
  assert.equal(line.ftm, 5.4);
  assert.equal(line.fta, 6.6);
  assert.equal(line.ftPct, 81.7);
});

test('on the forecast alone, last season ranks nobody', () => {
  const forecast = valueBoard(dataset.players, fixture, { schedule: leagueSchedule2027, projectionsOnly: true });
  assert.ok(forecast.entries.length > 250);
  assert.ok(forecast.entries.every((entry) => entry.source === 'projection' && entry.player.proTeam.toUpperCase() !== 'FA'));
  assert.ok(forecast.entries.every((entry) => entry.fppg !== null));
  assert.deepEqual(forecast.entries.map((entry) => entry.rank), forecast.entries.map((_, index) => index + 1));
  assert.ok(forecast.counts['last-season'] === 0);
  // The default still falls back, for anything that wants history.
  assert.ok(values.counts['last-season'] > 0);
  // No ESPN numbers at all: nobody is valued, rather than valued on last season.
  assert.equal(valueBoard(dataset.players, null, { projectionsOnly: true }).entries.length, 0);
});

test('season total is FPPG times projected games, and sorts', () => {
  const jokic = find(rows, 'Nikola Jokic');
  assert.equal(jokic.total, Math.round(jokic.fppg! * 72));
  const bare = rows.find((row) => row.games === null);
  assert.equal(bare?.total ?? null, null);
  const byTotal = sortProjections(rows, { column: 'total', dir: 'desc' });
  const totals = byTotal.filter((row) => row.total !== null).map((row) => row.total!);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
});

test('columns: VS LAST sits beside ESPN; hidden ones drop out; the player always stays', async () => {
  const { PROJECTION_COLUMNS, visibleColumns, parseHiddenColumns } = await import('../src/lib/league/projections.ts');
  const ids = PROJECTION_COLUMNS.map((column) => column.id);
  assert.equal(ids.indexOf('change'), ids.indexOf('base') + 1);
  const shown = visibleColumns(new Set(['pts', 'name', 'fgPct'])).map((column) => column.id);
  assert.ok(!shown.includes('pts') && !shown.includes('fgPct'));
  assert.ok(shown.includes('name'));
  assert.deepEqual([...parseHiddenColumns(JSON.stringify(['pts', 'name', 'nope', 3]))], ['pts']);
  assert.equal(parseHiddenColumns('garbage').size, 0);
  const csv = projectionsToCsv(rows.slice(0, 1), visibleColumns(new Set(['proTeam']))).split('\r\n')[0];
  assert.ok(csv.startsWith('#,Player,Positions'));
});

test('play-in and playoff games come from the schedule, and points scale with games missed', async () => {
  const { teamScheduleSummaries2027 } = await import('../src/lib/league/scheduleData.ts');
  const jokic = find(rows, 'Nikola Jokic');
  const den = teamScheduleSummaries2027.find((team) => team.teamCode === 'DEN')!;
  assert.equal(jokic.playInGames, den.playIn.total);
  assert.equal(jokic.playoffGames, den.playoffs.total);
  assert.equal(jokic.postPoints, Math.round(jokic.fppg! * den.postseasonTotal * Math.min(1, jokic.games! / 82)));
  assert.ok(jokic.playInGames! > 0 && jokic.playoffGames! > 0);
});
