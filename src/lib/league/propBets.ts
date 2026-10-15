/**
 * Prop bets on the draft: "Amy drafts over or under 1.5 Warriors."
 *
 * Any member sets a line on any team's draft, and any member takes the over or
 * the under. Lines always end in .5, so a prop can never push. Props and sides
 * lock when the draft starts. After that the board settles them: an over wins
 * the moment the count passes the line, an under only once the draft is done.
 *
 * Keepers count, because a kept player is on the team's draft board. But a
 * keeper only counts once keepers are public, or the tally would leak them.
 *
 * Pure and shared by client and server. No server, no browser.
 */

export type PropKind = 'team' | 'position' | 'custom';
export type PropSide = 'over' | 'under';

export interface PropTake {
  owner: string;
  side: PropSide;
  at: string;
}

export interface PropBet {
  id: string;
  /** The team whose draft this is about. */
  subject: string;
  kind: PropKind;
  /** An NBA team code, a position, or the setter's own words. */
  target: string;
  line: number;
  createdBy: string;
  createdAt: string;
  takes: PropTake[];
}

export interface PropInput {
  subject: string;
  kind: PropKind;
  target: string;
  line: number;
}

/** Codes match ESPN's proTeam field, which is what the draft board stores. */
export const NBA_TEAMS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'Atl', name: 'Hawks' },
  { code: 'Bos', name: 'Celtics' },
  { code: 'Bkn', name: 'Nets' },
  { code: 'Cha', name: 'Hornets' },
  { code: 'Chi', name: 'Bulls' },
  { code: 'Cle', name: 'Cavaliers' },
  { code: 'Dal', name: 'Mavericks' },
  { code: 'Den', name: 'Nuggets' },
  { code: 'Det', name: 'Pistons' },
  { code: 'GS', name: 'Warriors' },
  { code: 'Hou', name: 'Rockets' },
  { code: 'Ind', name: 'Pacers' },
  { code: 'LAC', name: 'Clippers' },
  { code: 'LAL', name: 'Lakers' },
  { code: 'Mem', name: 'Grizzlies' },
  { code: 'Mia', name: 'Heat' },
  { code: 'Mil', name: 'Bucks' },
  { code: 'Min', name: 'Timberwolves' },
  { code: 'Nor', name: 'Pelicans' },
  { code: 'NY', name: 'Knicks' },
  { code: 'OKC', name: 'Thunder' },
  { code: 'Orl', name: 'Magic' },
  { code: 'Phi', name: '76ers' },
  { code: 'Pho', name: 'Suns' },
  { code: 'Por', name: 'Trail Blazers' },
  { code: 'Sac', name: 'Kings' },
  { code: 'SA', name: 'Spurs' },
  { code: 'Tor', name: 'Raptors' },
  { code: 'Utah', name: 'Jazz' },
  { code: 'Wsh', name: 'Wizards' },
];

export const PROP_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

export const MIN_LINE = 0.5;
export const MAX_LINE = 15.5;
export const MAX_CUSTOM_LENGTH = 80;

/** Other spellings of a team code that turn up in ESPN data. */
const TEAM_ALIASES: Record<string, string> = {
  gsw: 'gs',
  nyk: 'ny',
  no: 'nor',
  nop: 'nor',
  phx: 'pho',
  sas: 'sa',
  uta: 'utah',
  was: 'wsh',
  bk: 'bkn',
  brk: 'bkn',
};

function teamKey(code: string): string {
  const lower = code.trim().toLowerCase();
  return TEAM_ALIASES[lower] ?? lower;
}

export function teamName(code: string): string | null {
  const key = teamKey(code);
  return NBA_TEAMS.find((t) => t.code.toLowerCase() === key)?.name ?? null;
}

/** How the prop reads: "Amy drafts over/under 1.5 Warriors". */
export function propLabel(prop: Pick<PropBet, 'subject' | 'kind' | 'target' | 'line'>): string {
  return `${prop.subject} drafts over/under ${prop.line} ${propThing(prop)}`;
}

/** Just the thing being counted: "Warriors", "centers", or the setter's words. */
export function propThing(prop: Pick<PropBet, 'kind' | 'target'>): string {
  if (prop.kind === 'team') return teamName(prop.target) ?? prop.target;
  if (prop.kind === 'position') return POSITION_NAMES[prop.target] ?? prop.target;
  return prop.target;
}

export const POSITION_NAMES: Record<string, string> = {
  PG: 'point guards',
  SG: 'shooting guards',
  SF: 'small forwards',
  PF: 'power forwards',
  C: 'centers',
};

export type PropInputError =
  | 'subject'
  | 'kind'
  | 'target'
  | 'line';

export type ParseResult =
  | { ok: true; input: PropInput }
  | { ok: false; field: PropInputError; message: string };

/** Check and tidy what the form sent. */
export function parsePropInput(raw: Record<string, unknown>, owners: readonly string[]): ParseResult {
  const subject = typeof raw.subject === 'string' ? raw.subject : '';
  if (!owners.includes(subject)) {
    return { ok: false, field: 'subject', message: 'Pick whose draft this is about.' };
  }
  const kind = raw.kind;
  if (kind !== 'team' && kind !== 'position' && kind !== 'custom') {
    return { ok: false, field: 'kind', message: 'Pick what to count.' };
  }
  let target = typeof raw.target === 'string' ? raw.target.trim() : '';
  if (kind === 'team') {
    const team = NBA_TEAMS.find((t) => t.code.toLowerCase() === teamKey(target));
    if (!team) return { ok: false, field: 'target', message: 'Pick an NBA team.' };
    target = team.code;
  } else if (kind === 'position') {
    target = target.toUpperCase();
    if (!(PROP_POSITIONS as readonly string[]).includes(target)) {
      return { ok: false, field: 'target', message: 'Pick a position.' };
    }
  } else {
    target = target.replace(/\s+/g, ' ');
    if (!target) return { ok: false, field: 'target', message: 'Say what to count.' };
    if (target.length > MAX_CUSTOM_LENGTH) {
      return { ok: false, field: 'target', message: `Keep it under ${MAX_CUSTOM_LENGTH} letters.` };
    }
  }
  const line = typeof raw.line === 'number' ? raw.line : Number(raw.line);
  if (!Number.isFinite(line) || line < MIN_LINE || line > MAX_LINE || !isHalf(line)) {
    return { ok: false, field: 'line', message: `The line must end in .5, from ${MIN_LINE} to ${MAX_LINE}.` };
  }
  return { ok: true, input: { subject, kind, target, line } };
}

function isHalf(n: number): boolean {
  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 && Math.round(n * 2) % 2 === 1;
}

/** Same team, same thing, same line. Case does not matter for custom words. */
export function sameProp(a: PropInput, b: PropInput): boolean {
  return (
    a.subject === b.subject &&
    a.kind === b.kind &&
    a.line === b.line &&
    a.target.toLowerCase() === b.target.toLowerCase()
  );
}

/** True once the draft has started, which freezes every prop and every side. */
export function propsLocked(draftStartedAt: string | null | undefined): boolean {
  return Boolean(draftStartedAt);
}

/** Take a side, switch sides, or (null) step off. */
export function takeSide(prop: PropBet, owner: string, side: PropSide | null, at: string): PropBet {
  const others = prop.takes.filter((t) => t.owner !== owner);
  return { ...prop, takes: side ? [...others, { owner, side, at }] : others };
}

export function sideOf(prop: PropBet, owner: string): PropSide | null {
  return prop.takes.find((t) => t.owner === owner)?.side ?? null;
}

/** Who may take a prop down: whoever set it, or the commissioner. */
export function canRemoveProp(prop: PropBet, owner: string, isCommissioner: boolean): boolean {
  return isCommissioner || prop.createdBy === owner;
}

/** One player on a team's draft board, for counting. */
export interface DraftedPlayer {
  owner: string;
  proTeam: string;
  positions: readonly string[];
}

/** How many of the thing the team has drafted. Null for custom words, which a person settles. */
export function propCount(prop: PropBet, drafted: readonly DraftedPlayer[]): number | null {
  if (prop.kind === 'custom') return null;
  const mine = drafted.filter((p) => p.owner === prop.subject);
  if (prop.kind === 'team') {
    const key = teamKey(prop.target);
    return mine.filter((p) => teamKey(p.proTeam) === key).length;
  }
  return mine.filter((p) => p.positions.includes(prop.target)).length;
}

/** Which side won. Over can win mid-draft; under has to wait for the end. */
export function propResult(line: number, count: number | null, draftDone: boolean): PropSide | null {
  if (count === null) return null;
  if (count > line) return 'over';
  return draftDone ? 'under' : null;
}

/** Props grouped by the team they are about, in league order. */
export function propsBySubject(props: readonly PropBet[], owners: readonly string[]): Array<{ owner: string; props: PropBet[] }> {
  return owners
    .map((owner) => ({
      owner,
      props: props.filter((p) => p.subject === owner).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .filter((group) => group.props.length > 0);
}
