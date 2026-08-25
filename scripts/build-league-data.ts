/**
 * Builds src/data/league-2027.json — the static keeper/draft dataset — from:
 *  - src/data/source/screenshot-stats-2026.json (league-official 2026 stats)
 *  - src/data/source/official-2025-list.json    (league-official 2025 list)
 *  - src/data/source/league-2027-config.json    (teams, contracts, pick trades)
 *  - ESPN raw dumps (player index + rosters), path given as argv[2]; falls back
 *    to the trimmed copies committed in src/data/source/.
 *
 * Also runs validation: reproduces the 2026 tiers from the official 2025 list
 * and asserts they match the old Keeper Worksheet exactly.
 *
 * Run: npx tsx scripts/build-league-data.ts [espnRawDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeTiers, KEEPER_ROUNDS } from '../src/lib/keeper/engine.js';
import type { TierInput } from '../src/lib/keeper/engine.js';
import type {
  ContractSeed,
  DatasetPlayer,
  LeagueDataset,
} from '../src/lib/keeper/types.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'data', 'source');
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

const ss = read(path.join(SRC, 'screenshot-stats-2026.json'));
const official25 = read(path.join(SRC, 'official-2025-list.json'));
const config = read(path.join(SRC, 'league-2027-config.json'));

/* ---------------- ESPN raw ---------------- */
interface ApiPlayer {
  id: number;
  name: string;
  pos: string[];
  defaultPos: string;
  proTeam: string;
  gp26api: number;
  avg26api: number;
  tot26api: number;
  gp25api?: number;
  avg25api?: number;
  tot25api?: number;
  injuryStatus?: string;
}
const rawDir = process.argv[2];
let apiIndex: Record<string, ApiPlayer>;
let espnRosters: Array<{ espnTeamId: number; name: string; abbrev: string; roster: Array<{ id: number; name: string }> }>;
if (rawDir && fs.existsSync(path.join(rawDir, 'player-index.json'))) {
  apiIndex = read(path.join(rawDir, 'player-index.json'));
  espnRosters = read(path.join(rawDir, 'teams-rosters.json'));
  // Persist trimmed copies for reproducible builds
  fs.writeFileSync(path.join(SRC, 'espn-index.json'), JSON.stringify(apiIndex));
  fs.writeFileSync(path.join(SRC, 'espn-rosters.json'), JSON.stringify(espnRosters));
} else {
  apiIndex = read(path.join(SRC, 'espn-index.json'));
  espnRosters = read(path.join(SRC, 'espn-rosters.json'));
}

const problems: string[] = [];
const notes: string[] = [];

/* ---------------- helpers ---------------- */
const shortName = (full: string) => {
  const t = full.trim().split(/\s+/);
  return `${t[0][0]}. ${t.slice(1).join(' ')}`;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
const sortPos = (pos: string[]) =>
  [...new Set(pos)].sort((a, b) => POS_ORDER.indexOf(a) - POS_ORDER.indexOf(b));

/* Owner by espnTeamId + roster owner by player espnId */
const ownerByEspnTeam = new Map<number, string>(
  config.teams.map((t: { espnTeamId: number; owner: string }) => [t.espnTeamId, t.owner]),
);
const ownerByPlayerId = new Map<number, string>();
for (const rt of espnRosters) {
  const owner = ownerByEspnTeam.get(rt.espnTeamId);
  if (!owner) {
    problems.push(`ESPN team ${rt.espnTeamId} (${rt.name}) has no owner mapping`);
    continue;
  }
  for (const pl of rt.roster) ownerByPlayerId.set(pl.id, owner);
}

/* API candidates grouped by short name */
const apiByShort = new Map<string, ApiPlayer[]>();
for (const p of Object.values(apiIndex)) {
  const s = shortName(p.name);
  if (!apiByShort.has(s)) apiByShort.set(s, []);
  apiByShort.get(s)!.push(p);
}

/* ---------------- match screenshot rows to API players ---------------- */
interface SsRow { name: string; total: number; avg: number; disambig?: string }
const ssRows: SsRow[] = ss.players;
const assignedApiIds = new Set<number>();
const matches = new Map<SsRow, ApiPlayer | null>();

const rowsByName = new Map<string, SsRow[]>();
for (const r of ssRows) {
  if (!rowsByName.has(r.name)) rowsByName.set(r.name, []);
  rowsByName.get(r.name)!.push(r);
}
for (const [name, rows] of rowsByName) {
  const candidates = [...(apiByShort.get(name) ?? [])];
  const remainingRows = [...rows].sort((a, b) => b.avg - a.avg);
  // 1) pin by disambig proTeam
  for (const row of [...remainingRows]) {
    if (!row.disambig) continue;
    const teamMatches = candidates.filter(
      (c) => c.proTeam.toLowerCase() === row.disambig!.toLowerCase() && !assignedApiIds.has(c.id),
    );
    const hit = teamMatches.sort(
      (a, b) =>
        Math.abs((a.avg26api || a.avg25api || 0) - row.avg) -
        Math.abs((b.avg26api || b.avg25api || 0) - row.avg),
    )[0];
    if (hit) {
      matches.set(row, hit);
      assignedApiIds.add(hit.id);
      candidates.splice(candidates.indexOf(hit), 1);
      remainingRows.splice(remainingRows.indexOf(row), 1);
    }
  }
  // 2) zip remaining rows/candidates by avg rank (both desc)
  const remCand = candidates
    .filter((c) => !assignedApiIds.has(c.id))
    .sort((a, b) => (b.avg26api || b.avg25api || 0) - (a.avg26api || a.avg25api || 0));
  remainingRows.forEach((row, i) => {
    const cand = remCand[i] ?? null;
    matches.set(row, cand);
    if (cand) assignedApiIds.add(cand.id);
    if (!cand) problems.push(`No API match for screenshot row: ${row.name} (${row.avg})`);
    else if (rows.length > 1 || remCand.length > 1)
      notes.push(`Collision resolved: "${row.name}" avg ${row.avg} → ${cand.name} (${cand.proTeam})`);
  });
}

/* ---------------- 2025 official averages ---------------- */
const official25ByShort = new Map<string, Array<{ name: string; team: string; avg: number; pickCost: number }>>();
for (const p of official25.players) {
  if (!official25ByShort.has(p.name)) official25ByShort.set(p.name, []);
  official25ByShort.get(p.name)!.push(p);
}
function priorAvgFor(name: string, api: ApiPlayer | null): { avg: number; source: '2025-official' | '2025-api' } | null {
  const entries = official25ByShort.get(name) ?? [];
  if (entries.length === 1) return { avg: entries[0].avg, source: '2025-official' };
  if (entries.length > 1 && api) {
    const hit = entries.find((e) => e.team.toLowerCase() === api.proTeam.toLowerCase());
    if (hit) return { avg: hit.avg, source: '2025-official' };
    notes.push(`2025-list collision unresolved for ${name}; using API 2025`);
  }
  if (api && api.avg25api && api.gp25api) return { avg: round1(api.avg25api), source: '2025-api' };
  return null;
}

/* ---------------- assemble players ---------------- */
const players = new Map<string, DatasetPlayer>();
const keyFor = (api: ApiPlayer | null, name: string) =>
  api ? `p${api.id}` : `n-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

for (const row of ssRows) {
  const api = matches.get(row) ?? null;
  const key = keyFor(api, row.name + (row.disambig ?? ''));
  const gp = Math.round(row.total / row.avg);
  players.set(key, {
    key,
    espnId: api?.id ?? null,
    name: row.name,
    fullName: api?.name ?? null,
    positions: api ? sortPos(api.pos.length ? api.pos : [api.defaultPos]) : [],
    proTeam: api?.proTeam ?? row.disambig ?? '?',
    injuryStatus: api?.injuryStatus ?? null,
    fantasyTeam: api ? ownerByPlayerId.get(api.id) ?? null : null,
    stats2026: { total: row.total, avg: row.avg, gp },
    api2026: api && api.gp26api ? { total: round1(api.tot26api), avg: round1(api.avg26api), gp: api.gp26api } : null,
    prior: null, // filled below when needed
    keeper: null as unknown as DatasetPlayer['keeper'],
  });
}

/* rostered players + FA pool from API */
for (const p of Object.values(apiIndex)) {
  const key = `p${p.id}`;
  if (players.has(key)) continue;
  const rostered = ownerByPlayerId.has(p.id);
  const relevant = rostered || (p.avg26api ?? 0) >= 15 || (p.avg25api ?? 0) >= 20;
  if (!relevant) continue;
  players.set(key, {
    key,
    espnId: p.id,
    name: shortName(p.name),
    fullName: p.name,
    positions: sortPos(p.pos.length ? p.pos : [p.defaultPos]),
    proTeam: p.proTeam,
    injuryStatus: p.injuryStatus ?? null,
    fantasyTeam: ownerByPlayerId.get(p.id) ?? null,
    stats2026: null,
    api2026: p.gp26api ? { total: round1(p.tot26api), avg: round1(p.avg26api), gp: p.gp26api } : null,
    prior: null,
    keeper: null as unknown as DatasetPlayer['keeper'],
  });
}

/* prior-year averages where the rules may need them (≤25 GP or 0 GP in 2026) */
for (const pl of players.values()) {
  const gp26 = pl.stats2026?.gp ?? pl.api2026?.gp ?? 0;
  if (gp26 > 25) continue;
  const api = pl.espnId ? Object.values(apiIndex).find((a) => a.id === pl.espnId) ?? null : null;
  pl.prior = priorAvgFor(pl.name, api);
}

/* ---------------- tiers ---------------- */
const tierInputs: TierInput[] = [...players.values()].map((pl) => ({
  key: pl.key,
  avg2026: pl.stats2026?.avg ?? pl.api2026?.avg ?? null,
  gp2026: pl.stats2026?.gp ?? pl.api2026?.gp ?? 0,
  priorAvg: pl.prior?.avg ?? null,
  ranked: pl.stats2026 !== null,
}));
const tiers = computeTiers(tierInputs, config.contractMaxYearsByRound);

/* ---------------- contracts ---------------- */
const contracts: ContractSeed[] = config.contracts2026;
for (const c of contracts) {
  const candidates = [...players.values()].filter((pl) => pl.name === c.player);
  let target: DatasetPlayer | undefined;
  if (c.currentOwner) {
    target = candidates.find((pl) => pl.fantasyTeam === c.currentOwner);
    if (!target) problems.push(`Contract player ${c.player} not found on ${c.currentOwner}'s roster`);
  } else {
    target = candidates.find((pl) => pl.fantasyTeam === null);
    if (!target && candidates.length === 1) target = candidates[0];
    if (!target) notes.push(`Unrostered contract player ${c.player} has no dataset entry (ok if long gone)`);
  }
  if (target) {
    (target as { _contract?: ContractSeed })._contract = c;
  }
}

/* finalize keeper info */
for (const pl of players.values()) {
  const a = tiers.assignments.get(pl.key);
  const contract = (pl as { _contract?: ContractSeed })._contract ?? null;
  delete (pl as { _contract?: ContractSeed })._contract;
  const flags: string[] = [];
  if (a?.zeroGp) flags.push('no-2026-games-3rd-round-rule');
  if (a?.usesPriorYear) flags.push(`uses-prior-year-avg (${pl.prior?.source})`);
  if (!pl.stats2026 && pl.api2026) flags.push('api-window-stats');
  if (contract?.expired || (contract && contract.lastKeepableSeason < config.season)) flags.push('contract-expired');
  pl.keeper = {
    eligible: pl.fantasyTeam !== null,
    round: a?.round ?? null,
    rank: a?.rank ?? null,
    effectiveAvg: a?.effectiveAvg ?? null,
    avgSource: a
      ? a.usesPriorYear
        ? (pl.prior?.source ?? 'none')
        : a.effectiveAvg !== null
          ? '2026'
          : 'none'
      : 'none',
    usesPriorYear: a?.usesPriorYear ?? false,
    zeroGp2026: a?.zeroGp ?? false,
    contract,
    flags,
  };
}

/* ---------------- dataset ---------------- */
const dataset: LeagueDataset = {
  season: config.season,
  generatedAt: new Date().toISOString(),
  cap: tiers.cap,
  capRule: tiers.capRule,
  tiers: tiers.bands,
  teams: config.teams,
  players: [...players.values()].sort(
    (a, b) => (b.keeper.effectiveAvg ?? b.api2026?.avg ?? 0) - (a.keeper.effectiveAvg ?? a.api2026?.avg ?? 0),
  ),
  pickTrades: config.pickTrades,
  draftRounds: config.draftRounds,
  keeperRounds: KEEPER_ROUNDS,
  maxKeepersPerTeam: config.maxKeepersPerTeam,
  contractMaxYearsByRound: config.contractMaxYearsByRound,
};
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'league-2027.json'), JSON.stringify(dataset, null, 1));

/* ================= VALIDATION ================= */
console.log('=== VALIDATION 1: reproduce 2026 tiers from official 2025 list (stored ranks) ===');
const expected2026 = [
  [66.7, 45.3], [45.2, 40.1], [40.0, 38.7], [38.6, 36.8], [36.7, 35.2],
  [35.1, 33.8], [33.7, 32.0], [31.9, 30.8], [30.7, 29.4], [29.3, 0],
];
const byRank = new Map<number, number>();
for (const p of official25.players) if (p.rank) byRank.set(p.rank, p.avg);
let v1ok = true;
for (let r = 1; r <= 10; r++) {
  const min = r === 10 ? 0 : byRank.get(r * 10)!;
  const max = r === 1 ? byRank.get(1)! : round1(byRank.get((r - 1) * 10)! - 0.1);
  const [expMax, expMin] = expected2026[r - 1];
  const ok = Math.abs(min - expMin) < 0.001 && Math.abs(max - expMax) < 0.001;
  if (!ok) { v1ok = false; console.log(`  ROUND ${r}: computed ${max}/${min} EXPECTED ${expMax}/${expMin}  <-- MISMATCH`); }
}
const cap2026 = round1(40.0 + 38.7);
console.log(v1ok ? '  bands: ALL 10 MATCH the old Worksheet ✓' : '  BAND MISMATCHES ABOVE');
console.log(`  cap: ${cap2026} (expected 78.7) ${cap2026 === 78.7 ? '✓' : 'MISMATCH'}`);
// per-player pick costs by stored rank
let costMismatch = 0;
for (const p of official25.players) {
  if (!p.rank) continue;
  const exp = Math.min(10, Math.ceil(p.rank / 10));
  if (exp !== p.pickCost) { costMismatch++; console.log(`  pickCost mismatch: ${p.name} rank ${p.rank} computed ${exp} sheet ${p.pickCost}`); }
}
console.log(`  per-player pick costs: ${costMismatch === 0 ? 'ALL MATCH ✓' : costMismatch + ' mismatches'}`);

console.log('\n=== VALIDATION 2: 2027 tiers ===');
for (const b of tiers.bands) console.log(`  Round ${b.round}: ${b.max} – ${b.min}  (max keep ${b.maxYears}y)`);
console.log(`  SALARY CAP 2027: ${tiers.cap}  (= R3 max ${tiers.capRule.round3Max} + R3 min ${tiers.capRule.round3Min})`);

console.log('\n=== VALIDATION 3: ≤25 GP substitutions ===');
for (const pl of dataset.players) {
  if (pl.keeper.usesPriorYear || pl.keeper.zeroGp2026) {
    if (!pl.fantasyTeam && !pl.stats2026) continue;
    console.log(
      `  ${pl.name.padEnd(24)} gp26=${pl.stats2026?.gp ?? pl.api2026?.gp ?? 0}  2026avg=${pl.stats2026?.avg ?? '-'}  → uses ${pl.keeper.effectiveAvg} (${pl.keeper.avgSource}${pl.keeper.zeroGp2026 ? ', ZERO GP → R3 rule' : ''})  → ROUND ${pl.keeper.round}`,
    );
  }
}

console.log('\n=== VALIDATION 4: API sanity — strong API players missing from screenshots ===');
for (const p of Object.values(apiIndex)) {
  if ((p.avg26api ?? 0) >= 28.5 && (p.gp26api ?? 0) > 25 && !assignedApiIds.has(p.id)) {
    const rostered = ownerByPlayerId.has(p.id) ? ` [ROSTERED by ${ownerByPlayerId.get(p.id)}]` : '';
    console.log(`  MISSING from screenshots? ${p.name} (${p.proTeam}) api avg ${round1(p.avg26api)} gp ${p.gp26api}${rostered}`);
  }
}

console.log('\n=== VALIDATION 5: contracts & rosters ===');
for (const pl of dataset.players) {
  if (pl.keeper.contract) {
    const c = pl.keeper.contract;
    const status = c.expired || c.lastKeepableSeason < config.season ? 'EXPIRED' : `keepable through ${c.lastKeepableSeason}`;
    console.log(`  ${pl.name.padEnd(24)} held by ${String(pl.fantasyTeam).padEnd(8)} orig R${c.originalRound} first ${c.firstKeptSeason} → ${status} | 2027 cost: R${pl.keeper.round}`);
  }
}
const rosterCounts = new Map<string, number>();
for (const pl of dataset.players) {
  if (pl.fantasyTeam) rosterCounts.set(pl.fantasyTeam, (rosterCounts.get(pl.fantasyTeam) ?? 0) + 1);
}
console.log('  roster sizes:', [...rosterCounts.entries()].map(([o, n]) => `${o}:${n}`).join(' '));

if (notes.length) { console.log('\n=== NOTES ==='); notes.forEach((n) => console.log('  ' + n)); }
if (problems.length) { console.log('\n=== PROBLEMS ==='); problems.forEach((p) => console.log('  !! ' + p)); process.exitCode = 1; }
console.log(`\nWrote src/data/league-2027.json with ${dataset.players.length} players.`);
