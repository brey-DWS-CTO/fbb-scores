/**
 * Achievements: small jobs around the app that each earn one keeper reveal.
 *
 * Every achievement an owner earns shows them one keeper: a random team that
 * still has a keeper they have not seen, then a random keeper on it. The nine
 * other teams keep up to eighteen players, and there are more achievements
 * than that, so nobody has to do every one.
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
  | 'hancock'
  | 'first-mock'
  | 'ten-mocks'
  | 'marathon'
  | 'honor-roll'
  | 'valedictorian'
  | 'thief'
  | 'what-if'
  | 'trade-offer'
  | 'haggler'
  | 'closer'
  | 'taker'
  | 'prop-bet'
  | 'bookmaker'
  | 'action'
  | 'all-in'
  | 'voted'
  | 'lawmaker'
  | 'scout'
  | 'close-call'
  | 'dues';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  /** How to earn it, in one short line. */
  how: string;
}

export const MOCKS_FOR_ADDICT = 10;
export const MOCKS_FOR_MARATHON = 25;
/** How far past his ADP a player must fall to you for THIEF. */
export const STEAL_FOR_THIEF = 15;
export const PROPS_FOR_BOOKMAKER = 5;
export const SIDES_FOR_ACTION = 5;
/** ALL IN needs at least this many props to cover, or one prop would do it. */
export const PROPS_FOR_ALL_IN = 3;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'signed', title: 'SIGNED AND SEALED', how: 'Sign the rule book.' },
  { id: 'hancock', title: 'JOHN HANCOCK', how: 'Draw your signature when you sign.' },
  { id: 'first-mock', title: 'FIRST MOCK', how: 'Finish a mock draft.' },
  { id: 'ten-mocks', title: 'MOCK ADDICT', how: `Finish ${MOCKS_FOR_ADDICT} mock drafts.` },
  { id: 'marathon', title: 'MOCK MARATHON', how: `Finish ${MOCKS_FOR_MARATHON} mock drafts.` },
  { id: 'honor-roll', title: 'HONOR ROLL', how: 'Get an A on a mock draft.' },
  { id: 'valedictorian', title: 'VALEDICTORIAN', how: 'Get an A+ on a mock draft.' },
  { id: 'thief', title: 'THIEF', how: `Draft a player ${STEAL_FOR_THIEF} or more picks after his ADP in a mock.` },
  { id: 'what-if', title: 'WHAT IF', how: 'Finish a mock with one of your trade offers switched on.' },
  { id: 'trade-offer', title: 'WHEELER DEALER', how: 'Offer a pick trade.' },
  { id: 'haggler', title: 'HAGGLER', how: 'Change a trade offer after you send it.' },
  { id: 'closer', title: 'CLOSER', how: 'Get a trade offer of yours accepted.' },
  { id: 'taker', title: 'TAKER', how: 'Accept a trade someone offered you.' },
  { id: 'prop-bet', title: 'BOOKIE', how: 'Set a prop bet.' },
  { id: 'bookmaker', title: 'BOOKMAKER', how: `Set ${PROPS_FOR_BOOKMAKER} prop bets.` },
  { id: 'action', title: 'ACTION', how: `Take a side on ${SIDES_FOR_ACTION} prop bets.` },
  { id: 'all-in', title: 'ALL IN', how: `Take a side on every prop you can see, ${PROPS_FOR_ALL_IN} at least.` },
  { id: 'voted', title: 'VOTER', how: 'Vote in a league poll.' },
  { id: 'lawmaker', title: 'LAWMAKER', how: 'Start a league vote.' },
  { id: 'scout', title: 'SCOUT', how: "Name a team's exact keepers on your first saved guess." },
  { id: 'close-call', title: 'CLOSE CALL', how: "Name one of a team's keepers on your first saved guess." },
  { id: 'dues', title: 'PAID UP', how: 'Pay your dues and get it confirmed.' },
];

/** What one owner has done, read from the league's records. */
export interface OwnerFacts {
  signedRulebook: boolean;
  /** Signed with a drawn signature, not just a tap. */
  drewSignature: boolean;
  /** Finished mocks, lifetime, from the log that is never trimmed. */
  mocksFinished: number;
  /** Best grade on any finished mock, e.g. "A-". Null with none. */
  bestMockGrade: string | null;
  /** Biggest steal on a saved mock, in picks past ADP. */
  bestSteal: number;
  /** Finished a mock with a trade offer switched on. */
  mockedWithTrade: boolean;
  tradesOffered: number;
  offersRevised: number;
  /** Their offers that the other side accepted. */
  offersClosed: number;
  /** Offers made to them that they accepted. */
  offersTaken: number;
  propBetsSet: number;
  propSidesTaken: number;
  /** Took a side on every prop they can see, and there were enough of them. */
  allPropsCovered: boolean;
  votesCast: number;
  pollsOpened: number;
  /** Teams whose exact keepers this owner guessed on the first save. */
  scoutHits: number;
  /** Teams where the first guess named at least one real keeper. */
  closeCalls: number;
  /** Dues the collector has confirmed, not just marked sent. */
  duesPaid: boolean;
}

export const NO_FACTS: OwnerFacts = {
  signedRulebook: false,
  drewSignature: false,
  mocksFinished: 0,
  bestMockGrade: null,
  bestSteal: 0,
  mockedWithTrade: false,
  tradesOffered: 0,
  offersRevised: 0,
  offersClosed: 0,
  offersTaken: 0,
  propBetsSet: 0,
  propSidesTaken: 0,
  allPropsCovered: false,
  votesCast: 0,
  pollsOpened: 0,
  scoutHits: 0,
  closeCalls: 0,
  duesPaid: false,
};

/** Achievements the facts earn today, in list order. */
export function earnedFrom(facts: OwnerFacts): AchievementId[] {
  const done: Record<AchievementId, boolean> = {
    signed: facts.signedRulebook,
    hancock: facts.drewSignature,
    'first-mock': facts.mocksFinished >= 1,
    'ten-mocks': facts.mocksFinished >= MOCKS_FOR_ADDICT,
    marathon: facts.mocksFinished >= MOCKS_FOR_MARATHON,
    'honor-roll': facts.bestMockGrade !== null && facts.bestMockGrade.startsWith('A'),
    valedictorian: facts.bestMockGrade === 'A+',
    thief: facts.bestSteal >= STEAL_FOR_THIEF,
    'what-if': facts.mockedWithTrade,
    'trade-offer': facts.tradesOffered >= 1,
    haggler: facts.offersRevised >= 1,
    closer: facts.offersClosed >= 1,
    taker: facts.offersTaken >= 1,
    'prop-bet': facts.propBetsSet >= 1,
    bookmaker: facts.propBetsSet >= PROPS_FOR_BOOKMAKER,
    action: facts.propSidesTaken >= SIDES_FOR_ACTION,
    'all-in': facts.allPropsCovered,
    voted: facts.votesCast >= 1,
    lawmaker: facts.pollsOpened >= 1,
    scout: facts.scoutHits >= 1,
    'close-call': facts.closeCalls >= 1,
    dues: facts.duesPaid,
  };
  return ACHIEVEMENTS.filter((a) => done[a.id]).map((a) => a.id);
}

/** ALL IN: a side on every prop you can see, with enough of them to mean something. */
export function coversAllProps(visible: number, taken: number): boolean {
  return visible >= PROPS_FOR_ALL_IN && taken >= visible;
}

/** One keeper reveal: which player on which team. */
export interface KeeperReveal {
  target: string;
  playerKey: string;
  at: string;
}

/** The first keeper guess a member saved for one team. Later edits never replace it. */
export interface FirstGuess {
  keys: string[];
  at: string;
}

/** What the server keeps, inside league state. */
export interface AchievementLedger {
  /** owner -> achievement -> when it was first seen. */
  earned: Record<string, Partial<Record<AchievementId, string>>>;
  /** owner -> the keepers they have revealed, oldest first. */
  reveals: Record<string, KeeperReveal[]>;
  /** viewer -> team -> the first keeper guess they saved for that team. */
  firstGuesses: Record<string, Record<string, FirstGuess>>;
  /** owner -> achievements whose unlock toast they have already seen. */
  seen: Record<string, string[]>;
}

export function emptyLedger(): AchievementLedger {
  return { earned: {}, reveals: {}, firstGuesses: {}, seen: {} };
}

/**
 * Old state rows have no ledger, or a partial one. Reveals from the first cut
 * showed a whole team and carry no player; they are dropped, so those owners
 * get the reveal back under the one-keeper rule.
 */
export function ledgerOf(raw: Partial<AchievementLedger> | undefined | null): AchievementLedger {
  const reveals: Record<string, KeeperReveal[]> = {};
  for (const [owner, list] of Object.entries(raw?.reveals ?? {})) {
    reveals[owner] = (list ?? []).filter((r) => typeof r.playerKey === 'string' && r.playerKey !== '');
  }
  return {
    earned: raw?.earned ?? {},
    reveals,
    firstGuesses: raw?.firstGuesses ?? {},
    seen: raw?.seen ?? {},
  };
}

/** Earned, in list order, and not yet shown in a toast. */
export function unseenAchievements(ledger: AchievementLedger, owner: string): AchievementId[] {
  const earned = ledger.earned[owner] ?? {};
  const seen = new Set(ledger.seen[owner] ?? []);
  return ACHIEVEMENTS.filter((a) => earned[a.id] && !seen.has(a.id)).map((a) => a.id);
}

/** Add ids to an owner's seen list, keeping only real achievement ids, once each. */
export function markSeen(current: readonly string[] | undefined, ids: readonly string[]): string[] {
  const known = new Set<string>(ACHIEVEMENTS.map((a) => a.id));
  return [...new Set([...(current ?? []), ...ids.filter((id) => known.has(id))])];
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

/** Reveals earned and not yet spent. */
export function revealsLeft(earned: number, used: number): number {
  return Math.max(0, earned - used);
}

/** Keepers this owner could still be shown, by team. Teams with none left are left out. */
export function hiddenKeepers(
  viewer: string,
  owners: readonly string[],
  keepers: Readonly<Record<string, ReadonlyArray<{ playerKey: string }>>>,
  already: readonly KeeperReveal[],
): Array<{ target: string; playerKeys: string[] }> {
  const seen = new Set(already.map((r) => `${r.target}:${r.playerKey}`));
  return owners
    .filter((o) => o !== viewer)
    .map((target) => ({
      target,
      playerKeys: (keepers[target] ?? []).map((k) => k.playerKey).filter((key) => !seen.has(`${target}:${key}`)),
    }))
    .filter((team) => team.playerKeys.length > 0);
}

export function hiddenCount(teams: ReadonlyArray<{ playerKeys: readonly string[] }>): number {
  return teams.reduce((n, t) => n + t.playerKeys.length, 0);
}

/**
 * A random team first, then a random keeper on it, so every team has the same
 * odds whether it keeps one player or two. `random` is Math.random in the app
 * and fixed in tests.
 */
export function pickReveal(
  teams: ReadonlyArray<{ target: string; playerKeys: readonly string[] }>,
  random: () => number,
): { target: string; playerKey: string } | null {
  if (teams.length === 0) return null;
  const at = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  const team = teams[at(teams.length)];
  return { target: team.target, playerKey: team.playerKeys[at(team.playerKeys.length)] };
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
  hidden: number;
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
  if (input.hidden <= 0) {
    return {
      ok: false,
      reason: 'nobody-ready',
      message: 'No keeper left to show you yet. Your reveal waits until someone saves one.',
    };
  }
  return { ok: true };
}

/** What a badge should count: reveals you could actually spend now. */
export function revealsReady(left: number, hidden: number): number {
  return Math.min(left, hidden);
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

/**
 * What to record as the first guess, or null to leave things alone. A guess
 * already on file wins. A guess saved before this shipped counts as the first.
 * An empty save is not a guess.
 */
export function firstGuessToRecord(
  existing: FirstGuess | undefined,
  saved: readonly string[],
  next: readonly string[],
  at: string,
): FirstGuess | null {
  if (existing) return null;
  if (saved.length > 0) return { keys: [...saved], at };
  if (next.length > 0) return { keys: [...next], at };
  return null;
}

/** A first guess that counts: made, and made before you revealed any of that team. */
function guessCounts(guess: FirstGuess | undefined, actual: readonly string[], revealedAt: string | null): guess is FirstGuess {
  if (!guess || guess.keys.length === 0 || actual.length === 0) return false;
  return revealedAt === null || revealedAt > guess.at;
}

/** SCOUT: the first guess names exactly the team's keepers. */
export function guessHit(guess: FirstGuess | undefined, actual: readonly string[], revealedAt: string | null): boolean {
  if (!guessCounts(guess, actual, revealedAt)) return false;
  if (guess.keys.length !== actual.length) return false;
  const want = new Set(actual);
  return guess.keys.every((key) => want.has(key));
}

/** CLOSE CALL: the first guess names at least one of the team's keepers. */
export function guessNear(guess: FirstGuess | undefined, actual: readonly string[], revealedAt: string | null): boolean {
  if (!guessCounts(guess, actual, revealedAt)) return false;
  const want = new Set(actual);
  return guess.keys.some((key) => want.has(key));
}
