import test from 'node:test';
import assert from 'node:assert/strict';
import { matchupTableRows } from '../src/lib/league/matchupTables.ts';
import { sharedDefensePoints, MATCHUP_POSITIONS, type MatchupEnvironment } from '../src/lib/league/matchupProjection.ts';
const scoring = [{ statId: 0, points: 1 }, { statId: 6, points: 2 }, { statId: 11, points: -1 }];
function environment(): MatchupEnvironment {
  return { season: 2027, fetchedAt: '2026-10-31T12:00:00Z', teams: Object.fromEntries(['DEN', 'BOS', 'HOU'].map((team, i) => [team,
    { pace: i === 2 ? 90 : 100, defense: Object.fromEntries(MATCHUP_POSITIONS.map(position => [position, { games: 5, stats: { '0': 20, '6': i + 1, '11': 2, '13': 1000 } }])) }])) } as MatchupEnvironment;
}
test('pace ranks use competition ties and stable team ordering without mutating input', () => {
  const data = environment(); const original = structuredClone(data);
  assert.deepEqual(matchupTableRows(data, 'pace', 'PG', scoring).map(r => [r.team, r.rank]), [['BOS', 1], ['DEN', 1], ['HOU', 3]]);
  assert.deepEqual(data, original);
});
test('position table uses exactly the model shared-category scoring and selected position', () => {
  const data = environment(); data.teams.DEN.defense.C.stats['0'] = 80;
  const center = matchupTableRows(data, 'defense', 'C', scoring);
  assert.equal(center[0].team, 'DEN');
  assert.equal(center[0].value, sharedDefensePoints(data.teams.DEN.defense.C, scoring));
  assert.equal(center[0].value, 80);
  assert.equal(matchupTableRows(data, 'defense', 'PG', scoring)[0].team, 'HOU');
});
test('zero-sample allowances stay unranked instead of presenting a misleading zero', () => {
  const data = environment(); data.teams.BOS.defense.PG.games = 0;
  const rows = matchupTableRows(data, 'defense', 'PG', scoring);
  assert.equal(rows.at(-1)?.team, 'BOS'); assert.equal(rows.at(-1)?.value, null); assert.equal(rows.at(-1)?.rank, null);
});
