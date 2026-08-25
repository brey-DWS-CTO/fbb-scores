/**
 * Fetches player season stats + final rosters from ESPN for keeper calculations.
 * Writes raw JSON to scratch dir for inspection, run with:
 *   npx tsx scripts/fetch-keeper-data.ts <outDir>
 */
import 'dotenv/config';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

const LEAGUE_ID = process.env.ESPN_LEAGUE_ID;
const COOKIE =
  process.env.ESPN_COOKIE_STRING ||
  `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`;

if (!LEAGUE_ID) throw new Error('ESPN_LEAGUE_ID missing');

const outDir = process.argv[2] || 'scratch-espn';
fs.mkdirSync(outDir, { recursive: true });

const HEADERS = {
  Cookie: COOKIE,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `https://fantasy.espn.com/basketball/league?leagueId=${LEAGUE_ID}`,
  Origin: 'https://fantasy.espn.com',
};

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba';

async function get(url: string, params: Record<string, unknown>, filter?: object) {
  const res = await axios.get(url, {
    params,
    headers: filter ? { ...HEADERS, 'x-fantasy-filter': JSON.stringify(filter) } : HEADERS,
    maxRedirects: 0,
    validateStatus: (s) => s < 400,
    paramsSerializer: { indexes: null },
  });
  if (res.status === 302 || typeof res.data === 'string') {
    throw new Error(`ESPN auth failed (status ${res.status}) for ${url}`);
  }
  return res.data;
}

async function fetchSeasonPlayers(season: number) {
  const filter = {
    players: {
      limit: 500,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}`;
  try {
    return await get(url, { view: 'kona_player_info' }, filter);
  } catch (e) {
    console.log(`seasons/${season} failed (${(e as Error).message}), trying leagueHistory...`);
    const hist = await get(
      `${BASE}/leagueHistory/${LEAGUE_ID}`,
      { seasonId: season, view: 'kona_player_info' },
      filter,
    );
    return Array.isArray(hist) ? hist[0] : hist;
  }
}

async function fetchRostersAndTeams(season: number) {
  const url = `${BASE}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}`;
  try {
    return await get(url, { view: ['mRoster', 'mTeam', 'mSettings'] });
  } catch (e) {
    console.log(`rosters seasons/${season} failed (${(e as Error).message}), trying leagueHistory...`);
    const hist = await get(`${BASE}/leagueHistory/${LEAGUE_ID}`, {
      seasonId: season,
      view: ['mRoster', 'mTeam', 'mSettings'],
    });
    return Array.isArray(hist) ? hist[0] : hist;
  }
}

async function main() {
  console.log('Fetching 2026 season players...');
  const p2026 = await fetchSeasonPlayers(2026);
  const players26 = p2026.players ?? [];
  console.log(`  got ${players26.length} players`);
  fs.writeFileSync(path.join(outDir, 'players-2026-raw.json'), JSON.stringify(p2026));

  console.log('Fetching 2025 season players...');
  const p2025 = await fetchSeasonPlayers(2025);
  const players25 = p2025.players ?? [];
  console.log(`  got ${players25.length} players`);
  fs.writeFileSync(path.join(outDir, 'players-2025-raw.json'), JSON.stringify(p2025));

  console.log('Fetching 2026 rosters + teams...');
  const rosters = await fetchRostersAndTeams(2026);
  fs.writeFileSync(path.join(outDir, 'rosters-2026-raw.json'), JSON.stringify(rosters));
  console.log(`  got ${rosters.teams?.length ?? 0} teams`);

  // Quick shape check: print top 15 by season applied average
  for (const entry of players26.slice(0, 15)) {
    const pl = entry.player ?? entry;
    const seasonStat = (pl.stats ?? []).find(
      (s: any) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.seasonId === 2026,
    );
    console.log(
      `${pl.fullName} | avg=${seasonStat?.appliedAverage?.toFixed(1)} | total=${seasonStat?.appliedTotal?.toFixed(1)} | gp=${seasonStat?.stats?.['42'] ?? '?'}`,
    );
  }

  // Team names
  for (const t of rosters.teams ?? []) {
    console.log(`team ${t.id}: ${t.name ?? `${t.location} ${t.nickname}`} | abbrev=${t.abbrev} | roster=${t.roster?.entries?.length ?? 0} players`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
