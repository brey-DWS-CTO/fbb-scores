/**
 * Achievements: small jobs around the app that each earn one keeper reveal.
 *
 * Every achievement an owner earns lets them see one other team's keepers,
 * picked at random from the teams that have keepers in. There are ten
 * achievements and nine other teams, so nobody has to do every one.
 *
 * Earned is for good. The server works out what each owner has done from the
 * league's own records, then stamps each new one into a ledger. A mock that is
 * later deleted, or a keeper guess wiped when keepers go public, never takes an
 * achievement back.
 *
 * Pure and shared by client and server. No server, no browser.
 */

export type AchievementId =
  | 'signed'
  | 'first-mock'
  | 'ten-mocks'
  | 'honor-roll'
  | 'trade-offer'
  | 'trade-done'
  | 'prop-bet'
  | 'voted'
  | 'scout'
  | 'dues';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  /** How to earn it, in one short line. */
  how: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'signed', title: 'SIGNED AND SEALED', how: 'Sign the rule book.' },
  { id: 'first-mock', title: 'FIRST MOCK', how: 'Finish a mock draft.' },
  { id: 'ten-mocks', title: 'MOCK ADDICT', how: 'Finish 10 mock drafts.' },
  { id: 'honor-roll', title: 'HONOR ROLL', how: 'Get an A grade on a mock draft.' },
  { id: 'trade-offer', title: 'WHEELER DEALER', how: 'Offer a pick trade.' },
  { id: 'trade-done', title: 'DEAL DONE', how: 'Get a pick trade accepted.' },
  { id: 'prop-bet', title: 'BOOKIE', how: 'Set a prop bet.' },
  { id: 'voted', title: 'VOTER', how: 'Vote in a league poll.' },
  { id: 'scout', title: 'SCOUT', how: "Guess another team's keepers on their keeper page." },
  { id: 'dues', title: 'PAID UP', how: 'Pay your dues.' },
];

export const MOCKS_FOR_ADDICT = 10;

/** What one owner has done, read from the league's records. */
export interface OwnerFacts {
  signedRulebook: boolean;
  /** Finished mocks, lifetime. See `mocksFinished`. */
  mocksFinished: number;
  /** Best grade on any saved mock, e.g. "A-". Null with none saved. */
  bestMockGrade: string | null;
  tradesOffered: number;
  /** Accepted trades this owner was part of, on either side. */
  tradesDone: number;
  propBetsSet: number;
  votesCast: number;
  /** Other teams this owner has guessed keepers for. */
  keeperGuesses: number;
  duesPaid: boolean;
}

export const NO_FACTS: OwnerFacts = {
  signedRulebook: false,
  mocksFinished: 0,
  bestMockGrade: null,
  tradesOffered: 0,
  tradesDone: 0,
  propBetsSet: 0,
  votesCast: 0,
  keeperGuesses: 0,
  duesPaid: false,
};

/** Achievements the facts earn today, in list order. */
export function earnedFrom(facts: OwnerFacts): AchievementId[] {
  const done: Record<AchievementId, boolean> = {
    signed: facts.signedRulebook,
    'first-mock': facts.mocksFinished >= 1,
    'ten-mocks': facts.mocksFinished >= MOCKS_FOR_ADDICT,
    'honor-roll': facts.bestMockGrade !== null && facts.bestMockGrade.startsWith('A'),
    'trade-offer': facts.tradesOffered >= 1,
    'trade-done': facts.tradesDone >= 1,
    'prop-bet': facts.propBetsSet >= 1,
    voted: facts.votesCast >= 1,
    scout: facts.keeperGuesses >= 1,
    dues: facts.duesPaid,
  };
  return ACHIEVEMENTS.filter((a) => done[a.id]).map((a) => a.id);
}

/**
 * Lifetime finished mocks. Members keep only their latest ten, so the saved
 * rows alone undercount; the ledger keeps a running count from the day this
 * shipped, and the rows cover everything before it.
 */
export function mocksFinished(counted: number | undefined, savedRows: number): number {
  return Math.max(counted ?? 0, savedRows);
}

/** The count after one more mock lands. `savedBefore` is the rows before the save. */
export function nextMockCount(counted: number | undefined, savedBefore: number): number {
  return mocksFinished(counted, savedBefore) + 1;
}

/** One keeper reveal: whose keepers this owner gets to see. */
export interface KeeperReveal {
  target: string;
  at: string;
}

/** What the server keeps, inside league state. */
export interface AchievementLedger {
  /** owner -> achievement -> when it was first seen. */
  earned: Record<string, Partial<Record<AchievementId, string>>>;
  /** owner -> the teams they have revealed, oldest first. */
  reveals: Record<string, KeeperReveal[]>;
  /** owner -> finished mocks counted since this shipped. */
  mocks: Record<string, number>;
}

export function emptyLedger(): AchievementLedger {
  return { earned: {}, reveals: {}, mocks: {} };
}

/** Old state rows have no ledger, or a partial one. */
export function ledgerOf(raw: Partial<AchievementLedger> | undefined | null): AchievementLedger {
  return {
    earned: raw?.earned ?? {},
    reveals: raw?.reveals ?? {},
    mocks: raw?.mocks ?? {},
  };
}

/**
 * Stamp anything new into an owner's earned record. Returns null when nothing
 * is new, so the caller can skip the write.
 */
export function stampEarned(
  current: Partial<Record<AchievementId, string>> | undefined,
  now: readonly AchievementId[],
  at: string,
): Partial<Record<AchievementId, string>> | null {
  const next = { ...(current ?? {}) };
  let added = false;
  for (const id of now) {
    if (!next[id]) {
      next[id] = at;
      added = true;
    }
  }
  return added ? next : null;
}

/** How many achievements an owner holds. Ids no longer in the list do not count. */
export function earnedCount(earned: Partial<Record<AchievementId, string>> | undefined): number {
  if (!earned) return 0;
  return ACHIEVEMENTS.filter((a) => earned[a.id]).length;
}

/** Reveals still to spend. Capped at the number of other teams. */
export function revealsLeft(earned: number, used: number, otherTeams: number): number {
  return Math.max(0, Math.min(earned, otherTeams) - used);
}

/** Teams this owner could still reveal: not them, not seen yet, keepers in. */
export function revealCandidates(
  viewer: string,
  owners: readonly string[],
  keeperCounts: Readonly<Record<string, number>>,
  already: readonly KeeperReveal[],
): string[] {
  const seen = new Set(already.map((r) => r.target));
  return owners.filter((o) => o !== viewer && !seen.has(o) && (keeperCounts[o] ?? 0) > 0);
}

/** A fair random pick. `random` is Math.random in the app and fixed in tests. */
export function pickRevealTarget(candidates: readonly string[], random: () => number): string | null {
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index];
}

export type RevealBlock = 'public' | 'commish' | 'none-left' | 'nobody-ready';

export interface RevealCheck {
  ok: boolean;
  reason?: RevealBlock;
  message?: string;
}

/** Whether this owner may spend a reveal now, and why not. */
export function canReveal(input: {
  keepersPublic: boolean;
  isCommissioner: boolean;
  left: number;
  candidates: number;
}): RevealCheck {
  if (input.keepersPublic) {
    return { ok: false, reason: 'public', message: 'Keepers are public now. Everyone can see them.' };
  }
  if (input.isCommissioner) {
    return { ok: false, reason: 'commish', message: 'You already see every keeper.' };
  }
  if (input.left <= 0) {
    return { ok: false, reason: 'none-left', message: 'Each new achievement unlocks one more reveal.' };
  }
  if (input.candidates <= 0) {
    return {
      ok: false,
      reason: 'nobody-ready',
      message: 'No other team has keepers in yet. Your reveal waits until one does.',
    };
  }
  return { ok: true };
}

/** One line per team for the league board. */
export interface AchievementStanding {
  owner: string;
  earned: number;
  revealed: number;
}

/** Most achievements first; ties keep league order. */
export function standings(
  owners: readonly string[],
  ledger: AchievementLedger,
): AchievementStanding[] {
  return owners
    .map((owner, index) => ({
      owner,
      earned: earnedCount(ledger.earned[owner]),
      revealed: (ledger.reveals[owner] ?? []).length,
      index,
    }))
    .sort((a, b) => b.earned - a.earned || a.index - b.index)
    .map(({ owner, earned, revealed }) => ({ owner, earned, revealed }));
}

/** Best grade of a set, "A+" over "A" over "B". Unknown grades rank last. */
const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];

export function bestGrade(grades: readonly string[]): string | null {
  let best: string | null = null;
  for (const g of grades) {
    const rank = GRADE_ORDER.indexOf(g);
    if (rank === -1) continue;
    if (best === null || rank < GRADE_ORDER.indexOf(best)) best = g;
  }
  return best;
}
