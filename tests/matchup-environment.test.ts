import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NBA_TEAM_ABBREV } from '../src/lib/espn/calculations.ts';
import { parseDefense, parsePace, createMatchupLoader } from '../server/lib/matchupEnvironment.ts';
const sample = JSON.parse(readFileSync(new URL('./fixtures/matchup-source-snippets.json', import.meta.url), 'utf8')) as { defenseRows: string[]; paceRow: string };
const teams = Object.values(NBA_TEAM_ABBREV);
const defense = '<h1>FanDuel NBA Defense Vs. Position | 2026-2027</h1><table id="data-table"><thead><th>Team</th><th>GP</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th><th>STL</th><th>BLK</th><th>TO</th><th>FD PTS</th></thead><tbody>' + teams.flatMap(team => sample.defenseRows.map(row => row.replace('>ATL</span>', `>${team === 'UTA' ? 'UTH' : team}</span>`))).join('') + '</tbody></table>';
const pace = '<h1>Unsupported browser</h1><h1>2026-2027 Hollinger Team Statistics</h1><tr class="colhead"><td>RK</td><td>TEAM</td><td>PACE</td></tr>' + teams.map(team => sample.paceRow.replace('/name/hou/', `/name/${team.toLowerCase()}/`)).join('');
test('real source row structures parse full coverage and normalize Utah', () => {
  assert.equal(Object.keys(parseDefense(defense, 2027)).length, 30);
  assert.equal(parseDefense(defense, 2027).UTA.PG.games, 6);
  assert.equal(Object.keys(parsePace(pace, 2027)).length, 30);
});
test('ignores hidden rolling windows and rejects duplicate, missing, malformed or wrong-season tables', () => {
  const extra = sample.defenseRows[0].replace('GC-0 PG', 'GC-7 PG');
  assert.equal(Object.keys(parseDefense(defense.replace('</tbody>', extra + '</tbody>'), 2027)).length, 30);
  assert.throws(() => parseDefense(defense.replace('</tbody>', sample.defenseRows[0] + '</tbody>'), 2027));
  assert.throws(() => parseDefense(defense.replace(sample.defenseRows[0], ''), 2027));
  assert.throws(() => parseDefense(defense.replace('<b>6</b>', '<b>oops</b>'), 2027));
  assert.throws(() => parseDefense(defense.replace('<th>PTS</th>', '<th>MIN</th>'), 2027));
  assert.throws(() => parseDefense(defense, 2026));
  assert.throws(() => parsePace(pace, 2026));
  assert.throws(() => parsePace(pace.replace('<td>PACE</td>', '<td>AST</td>'), 2027));
  assert.throws(() => parsePace(pace.replace('<td>94.2</td>', '<td>999</td>'), 2027));
});
test('shares in-flight source reads, caches success and uses the sources distinct season conventions', async () => {
  const urls: string[] = [];
  const load = createMatchupLoader(async url => { urls.push(url); return url.includes('fantasypros') ? defense : pace; });
  const [first, second] = await Promise.all([load(2027, 1000), load(2027, 1001)]);
  assert.deepEqual(first, second); assert.equal(first.error, null); assert.equal(urls.length, 2);
  assert.match(urls[0], /year=2026/); assert.match(urls[1], /year\/2027/);
  await load(2027, 2000); assert.equal(urls.length, 2);
});
test('failed source yields explicit baseline fallback and retries after five minutes', async () => {
  let calls = 0; const load = createMatchupLoader(async () => { calls++; throw new Error('offline'); });
  const result = await load(2027, 1000); assert.equal(result.environment, null); assert.ok(result.error);
  await load(2027, 1001); assert.equal(calls, 2);
  await load(2027, 1000 + 5 * 60000); assert.equal(calls, 4);
});
