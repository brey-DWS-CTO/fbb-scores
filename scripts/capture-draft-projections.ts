/** Trim saved ESPN responses to public player data and the league's scoring. */
import { readFileSync, writeFileSync } from 'node:fs';
import { NBA_TEAM_ABBREV } from '../src/lib/espn/calculations.js';

const [responsePath, scoringPath, outputPath] = process.argv.slice(2);
if (!responsePath || !scoringPath || !outputPath) {
  throw new Error('Usage: capture-draft-projections response.json scoring.json output.json');
}
const raw = JSON.parse(readFileSync(responsePath, 'utf8').replace(/^\uFEFF/, ''));
const dataset = JSON.parse(readFileSync(new URL('../src/data/league-2027.json', import.meta.url), 'utf8'));
const known = new Set(dataset.players.map((player: { espnId: number }) => player.espnId));
const positions: Record<number, string> = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' };
interface RawPlayer {
  id: number; fullName: string; proTeamId: number; defaultPositionId: number;
  eligibleSlots?: number[]; injuryStatus?: string;
  ownership?: { averageDraftPosition?: number; percentOwned?: number };
  draftRanksByRankType?: Record<string, { rank: number; auctionValue?: number }>;
  stats?: Array<{ id: string; seasonId: number; statSourceId: number; statSplitTypeId: number;
    scoringPeriodId: number; stats: Record<string, number>; averageStats?: Record<string, number> }>;
}
const players = (raw as RawPlayer[])
  .filter((player) => player.draftRanksByRankType?.STANDARD || known.has(player.id))
  .map((player) => {
    const row = player.stats?.find((stat) => stat.id === '102027');
    const rank = (type: string) => {
      const entry = player.draftRanksByRankType?.[type];
      return entry ? { rank: entry.rank, auctionValue: entry.auctionValue ?? null } : null;
    };
    const eligible = [...new Set((player.eligibleSlots ?? []).map((slot) => positions[slot]).filter(Boolean))];
    return {
      espnId: player.id, fullName: player.fullName,
      proTeam: player.proTeamId === 0 ? 'FA' : NBA_TEAM_ABBREV[player.proTeamId],
      positions: eligible.length ? eligible : [positions[player.defaultPositionId - 1]].filter(Boolean),
      injuryStatus: player.injuryStatus ?? null,
      adp: player.ownership?.averageDraftPosition ?? null,
      percentOwned: player.ownership?.percentOwned ?? null,
      standard: rank('STANDARD'), roto: rank('ROTO'),
      projection: row ? { ...row, averageStats: row.averageStats ?? null } : null,
    };
  }).sort((a, b) => (a.standard?.rank ?? Infinity) - (b.standard?.rank ?? Infinity) || a.espnId - b.espnId);
const scoringItems = JSON.parse(readFileSync(scoringPath, 'utf8').replace(/^\uFEFF/, ''))
  .map((item: { statId: number; points: number }) => ({ statId: item.statId, points: item.points }));
writeFileSync(outputPath, JSON.stringify({
  note: 'Real ESPN response, filtered to STANDARD-ranked players plus the committed dataset. Raw projection metadata retained. Scoring items fetched from league mSettings. No credentials or member data.',
  capturedAt: new Date().toISOString(), season: 2027, source: 'espn-kona',
  sourceUrl: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/players?view=kona_player_info',
  scoringSource: 'League 100537 mSettings, captured with the same session',
  scoringItems, players,
}, null, 2) + '\n');
console.log({ players: players.length, projected: players.filter((player) => player.projection).length });
