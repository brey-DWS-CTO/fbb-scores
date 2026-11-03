import { NBA_TEAM_ABBREV } from '../../src/lib/espn/calculations.js';
import { normalizeNbaTeamCode } from '../../src/lib/league/schedule.js';
import { MATCHUP_POSITIONS, type MatchupEnvironment, type MatchupFeed, type MatchupTeam, type PositionDefense } from '../../src/lib/league/matchupProjection.js';

export const DVP_URL = 'https://www.fantasypros.com/daily-fantasy/nba/fanduel-defense-vs-position.php';
export const PACE_URL = 'https://www.espn.com/nba/hollinger/teamstats';
const TEAMS = Object.values(NBA_TEAM_ABBREV);
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
const cells = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
function checkSeason(html: string, season: number) {
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(m[1]));
  if (!headings.some(heading => heading.includes(`${season - 1}-${season}`))) throw new Error('Matchup source season does not match');
}

/** Parse only the named season-to-date table, never the hidden 7/15/30-day duplicates. */
export function parseDefense(html: string, season: number): Record<string, MatchupTeam['defense']> {
  checkSeason(html, season);
  const table = html.match(/<table\b[^>]*id="data-table"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error('Defense table missing');
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
  if (headers.join('|') !== 'Team|GP|PTS|REB|AST|3PM|STL|BLK|TO|FD PTS') throw new Error('Defense table format changed');
  const result: Record<string, MatchupTeam['defense']> = {};
  for (const match of table.matchAll(/<tr\b[^>]*class="GC-0 (PG|SG|SF|PF|C)"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const position = match[1] as typeof MATCHUP_POSITIONS[number];
    const teamText = match[2].match(/<span\b[^>]*team-logo[^>]*>([^<]+)<\/span>/i)?.[1] ?? '';
    const team = normalizeNbaTeamCode(teamText === 'UTH' ? 'UTA' : teamText);
    const values = cells(match[2]);
    if (!TEAMS.includes(team) || values.length !== 10) throw new Error('Invalid defense row');
    const numbers = values.slice(1).map(v => v.trim() === '' ? NaN : Number(v));
    if (numbers.some(n => !Number.isFinite(n) || n < 0) || !Number.isInteger(numbers[0]) || numbers[0] > 82) throw new Error('Invalid defense values');
    const [games, pts, reb, ast, threes, stl, blk, to] = numbers;
    const defense: PositionDefense = { games, stats: { '0': pts, '6': reb, '3': ast, '17': threes, '2': stl, '1': blk, '11': to } };
    result[team] ??= {} as MatchupTeam['defense'];
    if (result[team][position]) throw new Error('Duplicate defense row');
    result[team][position] = defense;
  }
  if (Object.keys(result).length !== 30 || TEAMS.some(team => MATCHUP_POSITIONS.some(position => !result[team]?.[position]))) throw new Error('Incomplete defense coverage');
  return result;
}
export function parsePace(html: string, season: number): Record<string, number> {
  checkSeason(html, season);
  const header = html.match(/<tr\b[^>]*class="colhead"[^>]*>([\s\S]*?)<\/tr>/i)?.[1] ?? '';
  if (cells(header).slice(0, 3).join('|') !== 'RK|TEAM|PACE') throw new Error('Pace table format changed');
  const result: Record<string, number> = {};
  for (const match of html.matchAll(/<tr\b[^>]*class="(?:oddrow|evenrow) team-[^"]+"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const values = cells(match[1]);
    const code = match[1].match(/\/nba\/team\/_\/name\/([a-z]+)\//i)?.[1];
    if (!code || values.length !== 12) throw new Error('Pace table format changed');
    const team = normalizeNbaTeamCode(code);
    const pace = Number(values[2]);
    if (!TEAMS.includes(team) || !(pace >= 75 && pace <= 125) || result[team]) throw new Error('Invalid pace row');
    result[team] = pace;
  }
  if (TEAMS.some(team => !result[team]) || Object.keys(result).length !== 30) throw new Error('Incomplete pace coverage');
  return result;
}

export function createMatchupLoader(read: (url: string) => Promise<string>) {
  const cache = new Map<number, { expires: number; promise: Promise<MatchupFeed> }>();
  return function load(season: number, now = Date.now()): Promise<MatchupFeed> {
    const hit = cache.get(season);
    if (hit && hit.expires > now) return hit.promise;
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    const entry = { expires: now + 6 * 60 * 60 * 1000, promise: null as unknown as Promise<MatchupFeed> };
    entry.promise = Promise.all([read(`${DVP_URL}?year=${season - 1}`), read(`${PACE_URL}/_/year/${season}`)])
      .then(([defenseHtml, paceHtml]): MatchupFeed => {
        const defense = parseDefense(defenseHtml, season), pace = parsePace(paceHtml, season);
        const environment: MatchupEnvironment = { season, fetchedAt: new Date(now).toISOString(), teams: {} };
        for (const team of TEAMS) environment.teams[team] = { pace: pace[team], defense: defense[team] };
        return { environment, error: null };
      }).catch((): MatchupFeed => {
        entry.expires = now + 5 * 60 * 1000;
        return { environment: null, error: 'Matchup data unavailable; using baseline estimates.' };
      });
    cache.set(season, entry);
    return entry.promise;
  };
}
export const getMatchupEnvironment = createMatchupLoader(async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'text/html' } });
  if (!response.ok) throw new Error(`Matchup source answered ${response.status}`);
  return response.text();
});
