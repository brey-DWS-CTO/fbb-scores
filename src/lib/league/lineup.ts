/** ESPN-neutral lineup validation. All times and eligibility come from the provider. */
export interface LineupSlot {
  /** Unique instance, including when several slots have the same position. */
  id: string;
  label: string;
  eligibilityId: number;
  playerId: number | null;
}

export interface LineupPlayer {
  id: number;
  name: string;
  eligibleSlotIds: number[];
  lockAt: string | null;
  locked: boolean;
}

export interface LineupSnapshot {
  leagueId: string;
  teamId: number;
  scoringPeriodId: number;
  revision: string;
  fetchedAt: string;
  slots: LineupSlot[];
  players: LineupPlayer[];
  lockMode: 'daily' | 'weekly' | 'individual';
  periodLockAt: string | null;
}

export interface MoveRequest {
  playerId: number;
  destinationSlotId: string;
  revision: string;
}

export interface LineupAssignment {
  playerId: number;
  fromSlotId: string;
  toSlotId: string;
}

export interface LineupMove {
  assignments: LineupAssignment[];
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Reject local wall-clock strings: a lock must identify one absolute instant. */
function timestamp(value: unknown): number {
  ensure(typeof value === 'string', 'Reliable lock and snapshot times are required');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  ensure(parts, 'Reliable lock and snapshot times are required');
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  ensure(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59
    && (!parts[7] || (Number(parts[8]) <= 23 && Number(parts[9]) <= 59)),
  'Reliable lock and snapshot times are required');
  const ms = Date.parse(value);
  ensure(Number.isFinite(ms), 'Reliable lock and snapshot times are required');
  return ms;
}

/**
 * Plan only a move or a reciprocal swap. The provider must separately confirm
 * that it can execute this complete plan legally, including intermediate steps.
 * Call again with a fresh snapshot immediately before executing.
 */
export function validateMove(
  snapshot: LineupSnapshot,
  request: MoveRequest,
  now: Date,
  cutoffMinutes = 10,
): LineupMove {
  ensure(snapshot && request, 'A lineup and move are required');
  ensure(Number.isFinite(now.getTime()), 'A valid current time is required');
  ensure(Number.isFinite(cutoffMinutes) && cutoffMinutes >= 0, 'Invalid safety cutoff');
  ensure(text(snapshot.leagueId) && integer(snapshot.teamId, 1)
    && integer(snapshot.scoringPeriodId) && text(snapshot.revision), 'Invalid lineup identity');
  ensure(['daily', 'weekly', 'individual'].includes(snapshot.lockMode), 'Reliable lock information is required');
  const age = now.getTime() - timestamp(snapshot.fetchedAt);
  ensure(age >= -5_000 && age <= 30_000, 'The ESPN lineup is stale. Refresh before moving a player');
  ensure(request.revision === snapshot.revision, 'The ESPN lineup changed. Refresh before moving a player');
  ensure(integer(request.playerId, 1) && text(request.destinationSlotId), 'Invalid move');
  ensure(Array.isArray(snapshot.players) && Array.isArray(snapshot.slots)
    && snapshot.players.length > 0 && snapshot.slots.length > 0, 'Invalid lineup');

  const players = new Map<number, LineupPlayer>();
  for (const player of snapshot.players) {
    ensure(player && integer(player.id, 1) && text(player.name) && typeof player.locked === 'boolean'
      && Array.isArray(player.eligibleSlotIds) && player.eligibleSlotIds.length > 0
      && player.eligibleSlotIds.every(id => integer(id))
      && !players.has(player.id), 'Invalid or duplicate lineup player');
    ensure(player.lockAt === null || typeof player.lockAt === 'string', 'Reliable lock information is required');
    if (player.lockAt !== null) timestamp(player.lockAt);
    players.set(player.id, player);
  }
  const slots = new Map<string, LineupSlot>();
  const assigned = new Set<number>();
  for (const slot of snapshot.slots) {
    ensure(slot && text(slot.id) && text(slot.label) && integer(slot.eligibilityId)
      && !slots.has(slot.id), 'Invalid or duplicate lineup slot');
    if (slot.playerId !== null) {
      ensure(integer(slot.playerId, 1) && players.has(slot.playerId)
        && !assigned.has(slot.playerId), 'Invalid or duplicate player assignment');
      assigned.add(slot.playerId);
    }
    slots.set(slot.id, slot);
  }
  ensure(assigned.size === players.size, 'The lineup is incomplete');
  let periodLock: number | null = null;
  if (snapshot.periodLockAt !== null) periodLock = timestamp(snapshot.periodLockAt);
  ensure(snapshot.lockMode === 'individual' || periodLock !== null, 'Reliable period lock information is required');

  const source = snapshot.slots.find(slot => slot.playerId === request.playerId);
  const destination = slots.get(request.destinationSlotId);
  ensure(source && destination, 'Player or destination is not on this team');
  ensure(source.id !== destination.id, 'Choose a different lineup slot');
  const assignments: LineupAssignment[] = [
    { playerId: request.playerId, fromSlotId: source.id, toSlotId: destination.id },
  ];
  if (destination.playerId !== null) {
    assignments.push({ playerId: destination.playerId, fromSlotId: destination.id, toSlotId: source.id });
  }
  for (const assignment of assignments) {
    const player = players.get(assignment.playerId)!;
    const target = slots.get(assignment.toSlotId)!;
    ensure(player.eligibleSlotIds.includes(target.eligibilityId), `${player.name} is not eligible for ${target.label}`);
    ensure(!player.locked, `${player.name} is locked`);
    const personalLock = player.lockAt === null ? null : timestamp(player.lockAt);
    ensure(snapshot.lockMode !== 'individual' || personalLock !== null, 'Reliable player lock information is required');
    const locks = [periodLock, personalLock].filter((value): value is number => value !== null);
    ensure(locks.length > 0 && locks.every(lock => now.getTime() < lock - cutoffMinutes * 60_000),
      `${player.name} is inside the lineup safety cutoff`);
  }
  return { assignments };
}
