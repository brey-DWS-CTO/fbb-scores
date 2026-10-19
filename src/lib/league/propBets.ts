/**
 * Prop bets: "Kyle, over/under 3.5 times he asks about the rules."
 *
 * Any member sets a line on anyone else, and any member takes the over or the
 * under. Lines always end in .5, so a prop can never push. Setting and taking
 * sides lock when the draft starts. The app cannot count these, so after the
 * draft a person enters the final number and the line settles itself.
 *
 * Nobody ever sees a prop about themselves: not the member, not the
 * commissioner, and not the commissioner acting as someone else.
 *
 * Pure and shared by client and server. No server, no browser.
 */

export type PropSide = 'over' | 'under';

export interface PropTake {
  owner: string;
  side: PropSide;
  at: string;
}

export interface PropBet {
  id: string;
  /** Who the prop is about. They never see it. */
  subject: string;
  /** What is counted, in the setter's words: "times he asks about the rules". */
  text: string;
  line: number;
  createdBy: string;
  createdAt: string;
  takes: PropTake[];
  /** The final count, once someone enters it. */
  result?: number | null;
  settledBy?: string;
  settledAt?: string;
}

export interface PropInput {
  subject: string;
  text: string;
  line: number;
}

export const MIN_LINE = 0.5;
export const MAX_LINE = 99.5;
export const MAX_TEXT_LENGTH = 100;
export const MAX_RESULT = 999;

/** How the prop reads under the person's name: "Over/under 3.5 times he asks about the rules". */
export function propLabel(prop: Pick<PropBet, 'text' | 'line'>): string {
  return `Over/under ${prop.line} ${prop.text}`;
}

/** The whole line, name included, for confirm boxes. */
export function propSentence(prop: Pick<PropBet, 'subject' | 'text' | 'line'>): string {
  return `${prop.subject}: ${propLabel(prop)}`;
}

export type PropInputError = 'subject' | 'text' | 'line';

export type ParseResult =
  | { ok: true; input: PropInput }
  | { ok: false; field: PropInputError; message: string };

/**
 * Check and tidy what the form sent. `hidden` names who may not be the
 * subject: the member setting it, and anyone acting through them.
 */
export function parsePropInput(
  raw: Record<string, unknown>,
  owners: readonly string[],
  hidden: readonly string[],
): ParseResult {
  const subject = typeof raw.subject === 'string' ? raw.subject : '';
  if (!owners.includes(subject)) {
    return { ok: false, field: 'subject', message: 'Pick who this is about.' };
  }
  if (hidden.includes(subject)) {
    return { ok: false, field: 'subject', message: 'You cannot set a prop on yourself.' };
  }
  const line = typeof raw.line === 'number' ? raw.line : Number(raw.line);
  if (raw.line === '' || raw.line === undefined || !Number.isFinite(line) || line < MIN_LINE || line > MAX_LINE || !isHalf(line)) {
    return { ok: false, field: 'line', message: 'Set a line that ends in .5.' };
  }
  const text = typeof raw.text === 'string' ? raw.text.trim().replace(/\s+/g, ' ') : '';
  if (!text) return { ok: false, field: 'text', message: 'Say what gets counted.' };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, field: 'text', message: `Keep it under ${MAX_TEXT_LENGTH} letters.` };
  }
  return { ok: true, input: { subject, text, line } };
}

function isHalf(n: number): boolean {
  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 && Math.round(n * 2) % 2 === 1;
}

/** Same person, same line, same words. Case does not matter. */
export function sameProp(a: PropInput, b: PropInput): boolean {
  return a.subject === b.subject && a.line === b.line && a.text.toLowerCase() === b.text.toLowerCase();
}

/**
 * Old rows from the first cut counted NBA teams and positions. Read them as
 * plain words so nothing breaks.
 */
export function normalizeProp(raw: PropBet & { kind?: string; target?: string }): PropBet {
  if (typeof raw.text === 'string' && raw.text) return raw;
  return { ...raw, text: raw.target ?? '' };
}

/** The props one member may see: never one about themselves, or about whoever is acting through them. */
export function visibleProps(props: readonly PropBet[], hidden: readonly string[]): PropBet[] {
  return props.filter((p) => !hidden.includes(p.subject));
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

/**
 * Who may enter the final count: the commissioner, or whoever set it. The
 * setter matters for props about the commissioner, which he never sees.
 */
export function canSettleProp(prop: PropBet, owner: string, isCommissioner: boolean): boolean {
  if (prop.subject === owner) return false;
  return isCommissioner || prop.createdBy === owner;
}

/** A final count: a whole number from 0 up, or null to clear it. */
export function parseResult(raw: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw === null) return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === '' || !Number.isInteger(n) || n < 0 || n > MAX_RESULT) {
    return { ok: false, message: 'The final count is a whole number.' };
  }
  return { ok: true, value: n };
}

/** Which side won, once the count is in. */
export function propResult(prop: Pick<PropBet, 'line' | 'result'>): PropSide | null {
  if (prop.result === null || prop.result === undefined) return null;
  return prop.result > prop.line ? 'over' : 'under';
}

/** Props grouped by who they are about, in league order. */
export function propsBySubject(props: readonly PropBet[], owners: readonly string[]): Array<{ owner: string; props: PropBet[] }> {
  return owners
    .map((owner) => ({
      owner,
      props: props.filter((p) => p.subject === owner).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .filter((group) => group.props.length > 0);
}
