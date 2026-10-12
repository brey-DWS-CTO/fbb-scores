/**
 * A write-in pick: a player who is not in the locked ESPN pool. Rare, but
 * a rookie signed the week of the draft must not stop the draft. The
 * entering team types a name, position and NBA team; the server checks the
 * same way the screen does.
 */
export const WRITE_IN_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type WriteInPosition = (typeof WRITE_IN_POSITIONS)[number];

export interface WriteInPlayer {
  /** `writein-` plus the name and team, so it can never collide with the pool. */
  key: string;
  name: string;
  proTeam: string;
  positions: WriteInPosition[];
}

export type WriteInParse = { ok: true; player: WriteInPlayer } | { ok: false; error: string };

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Check a write-in from a form or a request body. */
export function parseWriteIn(input: unknown): WriteInParse {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'Type the player\'s name' };
  const proTeam = typeof body.proTeam === 'string' ? body.proTeam.trim().toLowerCase() : '';
  if (!/^[a-z]{2,4}$/.test(proTeam)) return { ok: false, error: 'NBA team is the two to four letter code, like DEN' };
  const raw = Array.isArray(body.positions) ? body.positions : [];
  const positions: WriteInPosition[] = [];
  for (const entry of raw) {
    const code = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
    if (!(WRITE_IN_POSITIONS as readonly string[]).includes(code)) return { ok: false, error: `Position must be one of ${WRITE_IN_POSITIONS.join(', ')}` };
    if (!positions.includes(code as WriteInPosition)) positions.push(code as WriteInPosition);
  }
  if (positions.length === 0) return { ok: false, error: 'Pick at least one position' };
  if (positions.length > 2) return { ok: false, error: 'Two positions at most' };
  return { ok: true, player: { key: `writein-${slug(name)}-${proTeam}`, name, proTeam, positions } };
}

/** Whether a name is already on the board, so a write-in cannot double up. */
export function nameTaken(
  name: string,
  picks: Readonly<Record<string, { playerName?: string }>>,
  pool: readonly { name: string; fullName: string | null; key: string }[],
  taken: ReadonlySet<string>,
): boolean {
  const wanted = name.trim().toLowerCase();
  for (const pick of Object.values(picks)) if (pick.playerName?.trim().toLowerCase() === wanted) return true;
  for (const player of pool) {
    if (!taken.has(player.key)) continue;
    if (player.name.toLowerCase() === wanted || player.fullName?.toLowerCase() === wanted) return true;
  }
  return false;
}
