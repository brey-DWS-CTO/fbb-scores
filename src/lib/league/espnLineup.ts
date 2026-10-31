import type { LineupPlayer, LineupSlot, LineupSnapshot } from './lineup.js';

type RecordValue = Record<string, unknown>;
type SlotRules = Record<string, { count: number; unlimited: boolean }>;
export interface EspnLineupBinding { leagueId: string; teamId: number; seasonId: number }
const labels: Record<number, string> = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 11: 'UTIL', 12: 'Bench', 13: 'IR' };

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): RecordValue {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Malformed ESPN lineup data.');
  return value as RecordValue;
}
function number(value: unknown, minimum = 0): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, 'Malformed ESPN numeric field.');
  return value;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'Malformed ESPN settings.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = object(value);
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/**
 * Canonical content for a server-side SHA-256 revision. Contains settings and
 * roster data: hash on the server, rather than exposing this string in logs.
 * fetchedAt and revision are intentionally excluded.
 */
export function espnLineupRevisionContent(snapshot: LineupSnapshot, settingsRaw: unknown): string {
  const root = object(settingsRaw);
  const rules = (snapshot as LineupSnapshot & { slotRules?: SlotRules }).slotRules;
  return canonical({ leagueId: root.id, seasonId: root.seasonId, scoringPeriodId: root.scoringPeriodId,
    settings: object(root.settings), snapshot: { leagueId: snapshot.leagueId, teamId: snapshot.teamId,
      scoringPeriodId: snapshot.scoringPeriodId, lockMode: snapshot.lockMode, periodLockAt: snapshot.periodLockAt,
      slots: snapshot.slots, players: snapshot.players, ...(rules ? { slotRules: rules } : {}) } });
}

/**
 * Parse the observed mSettings / mRoster response shapes for read-only use.
 * No game schedule or ordinary-manager lock timestamp is present in those
 * responses. Null timestamps deliberately prevent shared move validation.
 */
export function parseEspnLineup(
  settingsRaw: unknown,
  rosterRaw: unknown,
  binding: EspnLineupBinding,
  fetchedAt: Date,
): LineupSnapshot {
  requireValue(binding && typeof binding.leagueId === 'string' && /^\d+$/.test(binding.leagueId)
    && Number.isSafeInteger(binding.teamId) && binding.teamId > 0
    && Number.isSafeInteger(binding.seasonId) && binding.seasonId > 0
    && Number.isFinite(fetchedAt.getTime()), 'Invalid ESPN lineup binding or fetch time.');
  const settingsRoot = object(settingsRaw);
  const rosterRoot = object(rosterRaw);
  const leagueId = number(settingsRoot.id, 1);
  const seasonId = number(settingsRoot.seasonId, 1);
  const scoringPeriodId = number(settingsRoot.scoringPeriodId);
  requireValue(String(leagueId) === binding.leagueId && seasonId === binding.seasonId
    && number(rosterRoot.id, 1) === leagueId && number(rosterRoot.seasonId, 1) === seasonId
    && number(rosterRoot.scoringPeriodId) === scoringPeriodId, 'ESPN returned a different league, season, or scoring period.');
  const rosterSettings = object(object(settingsRoot.settings).rosterSettings);
  requireValue(rosterSettings.lineupLocktimeType === 'INDIVIDUAL_GAME', 'Unsupported ESPN lineup lock configuration.');
  requireValue(rosterSettings.rosterLocktimeType === 'FIRSTGAME_SCORINGPERIOD', 'Unsupported ESPN roster lock configuration.');
  requireValue(typeof rosterSettings.isBenchUnlimited === 'boolean', 'Missing ESPN bench settings.');
  const countsRaw = object(rosterSettings.lineupSlotCounts);
  const counts = new Map<number, number>();
  for (const [key, count] of Object.entries(countsRaw)) {
    requireValue(/^(0|[1-9]\d*)$/.test(key), 'Malformed ESPN slot type.');
    const slotType = number(Number(key));
    counts.set(slotType, number(count));
  }
  requireValue([...counts.values()].some(count => count > 0), 'Missing configured ESPN lineup slots.');
  requireValue(Array.isArray(rosterRoot.teams), 'Missing ESPN team roster.');
  const teamIds = new Set<number>();
  let team: RecordValue | undefined;
  for (const rawTeam of rosterRoot.teams) {
    const candidate = object(rawTeam);
    const id = number(candidate.id, 1);
    requireValue(!teamIds.has(id), 'Duplicate ESPN team.');
    teamIds.add(id);
    if (id === binding.teamId) team = candidate;
  }
  requireValue(team, 'The authorized ESPN team is absent.');
  const entries = object(team.roster).entries;
  requireValue(Array.isArray(entries), 'Missing ESPN roster entries.');
  const players: LineupPlayer[] = [];
  const playerIds = new Set<number>();
  const occupants = new Map<number, number[]>();
  for (const rawEntry of entries) {
    const entry = object(rawEntry);
    const pool = object(entry.playerPoolEntry);
    const player = object(pool.player);
    const id = number(entry.playerId, 1);
    const slotType = number(entry.lineupSlotId);
    requireValue(number(pool.id, 1) === id && number(player.id, 1) === id
      && number(pool.onTeamId, 1) === binding.teamId, 'ESPN player identity or team does not match.');
    requireValue(!playerIds.has(id), 'Duplicate ESPN player.');
    playerIds.add(id);
    requireValue(counts.has(slotType) && (counts.get(slotType)! > 0
      || (slotType === 12 && rosterSettings.isBenchUnlimited)), 'ESPN player occupies an unconfigured slot.');
    requireValue(typeof player.fullName === 'string' && player.fullName.trim().length > 0
      && typeof pool.lineupLocked === 'boolean' && Array.isArray(player.eligibleSlots)
      && player.eligibleSlots.length > 0, 'Missing ESPN player name, eligibility, or lock information.');
    const eligibleSlotIds = player.eligibleSlots.map(value => number(value)).sort((a, b) => a - b);
    requireValue(new Set(eligibleSlotIds).size === eligibleSlotIds.length, 'Duplicate ESPN eligibility.');
    // ESPN includes IR eligibility for healthy players too. This raw list is
    // not a claim that a reserve move is legal; the provider must prove that.
    players.push({ id, name: player.fullName, eligibleSlotIds, locked: pool.lineupLocked, lockAt: null,
      ...(Number.isSafeInteger(player.proTeamId) && Number(player.proTeamId) >= 0 ? { proTeamId: Number(player.proTeamId) } : {}) });
    occupants.set(slotType, [...(occupants.get(slotType) ?? []), id]);
  }
  players.sort((a, b) => a.id - b.id);
  const slots: Array<LineupSlot & { kind: 'starter' | 'bench' | 'reserve' }> = [];
  const slotRules: SlotRules = {};
  for (const [slotType, configured] of [...counts.entries()].sort(([a], [b]) => a - b)) {
    const ids = (occupants.get(slotType) ?? []).sort((a, b) => a - b);
    const unlimitedBench = slotType === 12 && rosterSettings.isBenchUnlimited;
    slotRules[String(slotType)] = { count: configured, unlimited: unlimitedBench };
    requireValue(unlimitedBench || ids.length <= configured, 'ESPN roster exceeds a configured slot count.');
    const count = unlimitedBench ? Math.max(configured, ids.length) : configured;
    requireValue(count <= 100 && slots.length + count <= 200, 'ESPN slot configuration is too large.');
    for (let index = 0; index < count; index++) {
      slots.push({ id: `${slotType}:${index}`, label: labels[slotType] ?? `ESPN slot ${slotType}`,
        eligibilityId: slotType, playerId: ids[index] ?? null,
        kind: slotType === 12 ? 'bench' : slotType === 13 ? 'reserve' : 'starter' });
    }
  }
  const result: LineupSnapshot & { slotRules: SlotRules } = { leagueId: binding.leagueId, teamId: binding.teamId, scoringPeriodId,
    fetchedAt: fetchedAt.toISOString(), revision: '', slots, players, slotRules, lockMode: 'individual', periodLockAt: null };
  const content = espnLineupRevisionContent(result, settingsRaw);
  // Same browser-safe FNV convention as rulebookFingerprint. This read-only
  // fingerprint is NOT a write precondition: server reads must replace it with
  // SHA-256 of espnLineupRevisionContent before enabling any execution path.
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) hash = Math.imul(hash ^ content.charCodeAt(index), 0x01000193) >>> 0;
  result.revision = `espn-readonly-${hash.toString(16).padStart(8, '0')}-${content.length.toString(36)}`;
  return result;
}
