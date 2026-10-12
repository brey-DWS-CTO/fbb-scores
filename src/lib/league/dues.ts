/**
 * League dues: who has paid, who says they have, and who the commissioner has
 * checked.
 *
 * The app cannot see Venmo, so a payment moves through three states:
 *
 *   unpaid   -> nobody has said anything
 *   paid     -> the member says they sent it
 *   verified -> a commissioner saw it land and confirmed it
 *
 * A member may only speak for their own team, and may take back "I paid" until
 * a commissioner has confirmed it. Confirming, and every other change, is the
 * commissioner's. Owner names are the key here, as everywhere: whoever the
 * commissioners are, they can confirm.
 *
 * Pure and shared by client and server, so the buttons a member sees are the
 * ones the server allows.
 */

/** Rule 9.1.3: $250 entry plus the $54 weekly bonus fee. */
export const DUES_FULL = 304;
/** Rule 9.1.3.1: half the entry fee, the full weekly bonus fee. */
export const DUES_HALF = 179;
/** Rule 9.1.3.1: at most two teams may pay half. */
export const DUES_HALF_MAX_TEAMS = 2;

export interface DuesRow {
  season: number;
  owner: string;
  /** The team invoked the half entry fee exception. */
  half: boolean;
  /** When the member (or a commissioner) said it was sent. */
  paidAt: string | null;
  /** When a commissioner confirmed it arrived. */
  verifiedAt: string | null;
  verifiedBy: string | null;
  updatedAt: string;
}

export interface DuesSettings {
  season: number;
  /** The Venmo username that collects, without the @. Empty until set. */
  venmo: string;
  /** The owner who collects, for the page to name. Empty until set. */
  payee: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type DuesStatus = 'unpaid' | 'paid' | 'verified';

export type DuesAction = 'paid' | 'unpaid' | 'verify' | 'unverify' | 'half' | 'full';

export const DUES_ACTIONS: readonly DuesAction[] = ['paid', 'unpaid', 'verify', 'unverify', 'half', 'full'];

export function blankDuesRow(season: number, owner: string): DuesRow {
  return { season, owner, half: false, paidAt: null, verifiedAt: null, verifiedBy: null, updatedAt: '' };
}

export function duesStatus(row: DuesRow): DuesStatus {
  if (row.verifiedAt) return 'verified';
  if (row.paidAt) return 'paid';
  return 'unpaid';
}

export function amountDue(row: Pick<DuesRow, 'half'>): number {
  return row.half ? DUES_HALF : DUES_FULL;
}

export type DuesResult = { ok: true; row: DuesRow } | { ok: false; status: number; message: string };

const refuse = (status: number, message: string): DuesResult => ({ ok: false, status, message });

/**
 * Apply one change to one team's dues.
 *
 * `rows` is every team's row this season, needed only to hold the half-fee
 * exception to two teams.
 */
export function applyDuesAction(input: {
  row: DuesRow;
  action: DuesAction;
  actor: string;
  isCommissioner: boolean;
  now: string;
  rows: readonly DuesRow[];
}): DuesResult {
  const { action, actor, isCommissioner, now, rows } = input;
  const row: DuesRow = { ...input.row, updatedAt: now };
  const own = actor === row.owner;
  const status = duesStatus(input.row);

  switch (action) {
    case 'paid':
      if (!own && !isCommissioner) return refuse(403, 'You can only mark your own team paid.');
      if (status !== 'unpaid') return refuse(409, `${row.owner} is already marked paid.`);
      row.paidAt = now;
      return { ok: true, row };

    case 'unpaid':
      if (!own && !isCommissioner) return refuse(403, 'You can only change your own team.');
      if (status === 'unpaid') return refuse(409, `${row.owner} is not marked paid.`);
      if (status === 'verified' && !isCommissioner) {
        return refuse(409, 'A commissioner already confirmed this. Ask them to undo it.');
      }
      row.paidAt = null;
      row.verifiedAt = null;
      row.verifiedBy = null;
      return { ok: true, row };

    case 'verify':
      if (!isCommissioner) return refuse(403, 'Only a commissioner can confirm a payment.');
      if (status === 'verified') return refuse(409, `${row.owner} is already confirmed.`);
      // Confirming a team that never tapped "I paid" records it as paid now,
      // for cash or a payment the member forgot to mark.
      row.paidAt = row.paidAt ?? now;
      row.verifiedAt = now;
      row.verifiedBy = actor;
      return { ok: true, row };

    case 'unverify':
      if (!isCommissioner) return refuse(403, 'Only a commissioner can undo a confirmation.');
      if (status !== 'verified') return refuse(409, `${row.owner} is not confirmed.`);
      row.verifiedAt = null;
      row.verifiedBy = null;
      return { ok: true, row };

    case 'half': {
      if (!isCommissioner) return refuse(403, 'Only a commissioner can grant the half fee.');
      if (row.half) return refuse(409, `${row.owner} already pays half.`);
      const taken = rows.filter((r) => r.half && r.owner !== row.owner).length;
      if (taken >= DUES_HALF_MAX_TEAMS) {
        return refuse(409, `Only ${DUES_HALF_MAX_TEAMS} teams may pay half.`);
      }
      row.half = true;
      return { ok: true, row };
    }

    case 'full':
      if (!isCommissioner) return refuse(403, 'Only a commissioner can change the fee.');
      if (!row.half) return refuse(409, `${row.owner} already pays the full fee.`);
      row.half = false;
      return { ok: true, row };
  }
}

export interface DuesLine {
  owner: string;
  status: DuesStatus;
  amount: number;
  half: boolean;
  paidAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export interface DuesBoard {
  lines: DuesLine[];
  /** Teams that said they paid, confirmed or not. */
  paid: number;
  verified: number;
  /** Dollars a commissioner has confirmed. */
  collected: number;
  /** Dollars owed by the whole league. */
  expected: number;
}

/** Every member's line, in league order, with a blank line for anyone not on file. */
export function duesBoard(season: number, owners: readonly string[], rows: readonly DuesRow[]): DuesBoard {
  const lines = owners.map((owner): DuesLine => {
    const row = rows.find((r) => r.owner === owner && r.season === season) ?? blankDuesRow(season, owner);
    return {
      owner,
      status: duesStatus(row),
      amount: amountDue(row),
      half: row.half,
      paidAt: row.paidAt,
      verifiedAt: row.verifiedAt,
      verifiedBy: row.verifiedBy,
    };
  });
  return {
    lines,
    paid: lines.filter((l) => l.status !== 'unpaid').length,
    verified: lines.filter((l) => l.status === 'verified').length,
    collected: lines.filter((l) => l.status === 'verified').reduce((sum, l) => sum + l.amount, 0),
    expected: lines.reduce((sum, l) => sum + l.amount, 0),
  };
}

/**
 * A Venmo username from whatever the commissioner pasted: `@name`, `name`, or
 * a profile link such as https://venmo.com/u/name. Null when it is none of those.
 */
export function parseVenmoHandle(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  const link = /^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(text);
  const handle = link ? link[1] : text.replace(/^@/, '');
  return /^[A-Za-z0-9_-]{2,30}$/.test(handle) ? handle : null;
}

/** The profile link the commissioner gave, for showing. */
export function venmoProfileUrl(handle: string): string {
  return `https://venmo.com/u/${encodeURIComponent(handle)}`;
}

/**
 * A link that opens Venmo with the payment filled in. On a phone it opens the
 * app; on a computer it opens the profile, where the member pays by hand.
 */
export function venmoPayUrl(handle: string, amount: number, note: string): string {
  // %20, not +, for spaces: Venmo shows a + in the note literally.
  return `${venmoProfileUrl(handle)}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`;
}

export function duesNote(season: number, owner: string): string {
  return `Nerds ${season} dues - ${owner}`;
}

export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}
