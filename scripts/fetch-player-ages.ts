/**
 * Birth dates and NBA draft years for the draft recap's age and rookie notes.
 *
 * Covers every player ESPN ranks for the season plus everyone in the committed
 * dataset, so any player a team can draft is in the file. Public data only:
 * ESPN's default-league player list and its athlete pages, no credentials.
 *
 * Usage: npx tsx scripts/fetch-player-ages.ts [season] [extra espnIds...]
 * Writes src/data/source/player-ages-<season>.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const season = Number(process.argv[2] ?? 2027);
const extra = process.argv.slice(3).map(Number).filter((id) => Number.isInteger(id) && id > 0);
const dataset = JSON.parse(readFileSync(new URL(`../src/data/league-${season}.json`, import.meta.url), 'utf8')) as {
  players: { espnId: number | null }[];
};

async function rankedIds(): Promise<number[]> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
  const ids: number[] = [];
  for (let page = 0; page < 4; page += 1) {
    const filter = { players: { filterActive: { value: true }, limit: 500, offset: page * 500, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
    const response = await fetch(url, { headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
    if (!response.ok) throw new Error(`ESPN player list answered ${response.status}`);
    const data = await response.json() as { players?: { player?: { id: number; draftRanksByRankType?: { STANDARD?: unknown } } }[] };
    const players = data.players ?? [];
    for (const entry of players) {
      if (entry.player?.draftRanksByRankType?.STANDARD) ids.push(entry.player.id);
    }
    if (players.length < 500) break;
  }
  return ids;
}

interface AthleteRow { born: string | null; draftYear: number | null }

async function athlete(id: number): Promise<AthleteRow | null> {
  const response = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/${id}?lang=en&region=us`);
  if (!response.ok) return null;
  const data = await response.json() as { dateOfBirth?: string; draft?: { year?: number }; experience?: { years?: number } };
  const born = data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : null;
  // An undrafted player has no draft entry; his first season stands in for it.
  const draftYear = data.draft?.year ?? (typeof data.experience?.years === 'number' ? season - 1 - data.experience.years : null);
  return { born, draftYear };
}

const ids = [...new Set([
  ...dataset.players.map((player) => player.espnId).filter((id): id is number => id !== null),
  ...(await rankedIds()),
  ...extra,
])].sort((a, b) => a - b);

const out: Record<string, AthleteRow> = {};
for (let at = 0; at < ids.length; at += 20) {
  const batch = ids.slice(at, at + 20);
  const rows = await Promise.all(batch.map((id) => athlete(id).catch(() => null)));
  batch.forEach((id, index) => { if (rows[index]) out[String(id)] = rows[index]; });
}
writeFileSync(new URL(`../src/data/source/player-ages-${season}.json`, import.meta.url), `${JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"')}\n`);
console.log({ asked: ids.length, saved: Object.keys(out).length });
