/**
 * Member-to-member draft pick trades.
 *
 * Pure and shared by client and server, so the review screen a member reads is
 * the same arithmetic the server enforces on accept.
 *
 * Draft picks only. No players, keeper rights, or cash.
 *
 * A pick's identity is the draft it belongs to, its round, and the team it
 * originally belonged to. None of the three ever changes. Who owns it right now
 * is derived: start from the committed preseason seed in `dataset.pickTrades`,
 * then replay the append-only ledger of accepted in-app transfers. Replaying is
 * what lets one pick pass through several owners and still show its whole chain
 * of custody.
 *
 * Exactly one draft is tradeable at a time. It is the current one until the
 * commissioner closes the draft, and next season's from that moment. The rule
 * book forbids trading a pick two or more drafts out, so there is never a third
 * season in play.
 *
 * Keeper cost previews call the keeper engine. None of the rule math lives
 * here.
 */
import {
  buildAllPicks,
  buildDraftBoard,
  pickLabel,
  resolveTeamKeepers,
  KEEPER_ROUNDS,
} from '../keeper/engine.js';
import type {
  BoardCell,
  LeagueDataset,
  LeagueDynamicState,
  PickRef,
  PickSlot,
  PickTradeProposal,
  PickTradeStatus,
  PickTransfer,
  StoredPickRef,
} from '../keeper/types.js';

export type { PickRef, PickTradeProposal, PickTradeStatus, PickTransfer, StoredPickRef };

/** A pending offer goes stale on its own after this long. */
export const PROPOSAL_TTL_DAYS = 7;

/** Most picks one side may put in a single trade. Keeps the review readable. */
export const MAX_PICKS_PER_SIDE = 6;

export const MAX_TRADE_NOTE = 400;

/** The lowest round the rule book lets a team trade. 1st and 2nd are protected. */
export const FIRST_TRADEABLE_ROUND = 3;

/** Most of its own picks a team may have traded away for one draft. */
export const MAX_PICKS_AWAY_PER_SEASON = 2;

/** Most picks one team may hold in a single round of one draft. */
export const MAX_PICKS_PER_ROUND = 2;

/** The last round a team may trade. Keeper tiers span rounds 1-10. */
export function lastTradeableRound(dataset: Pick<LeagueDataset, 'keeperRounds'>): number {
  return dataset.keeperRounds;
}

/* ------------------------------------------------------------------ */
/* Seasons                                                             */
/* ------------------------------------------------------------------ */

/**
 * The draft a stored pick belongs to.
 *
 * Everything saved before picks became season-aware is a pick in the current
 * draft, so a missing season reads as the current one. Nothing already agreed
 * changes meaning, and nothing stored gets rewritten.
 */
export function pickSeason(ref: { season?: number }, currentSeason: number): number {
  return ref.season ?? currentSeason;
}

/** The same pick with its season spelled out. Never mutates the input. */
export function withSeason<T extends { season?: number }>(
  ref: T,
  currentSeason: number,
): T & { season: number } {
  return { ...ref, season: pickSeason(ref, currentSeason) };
}

/**
 * The one draft whose picks may be traded right now.
 *
 * Rule 4.4.1.3 puts picks two or more drafts out off limits, so closing the
 * current draft is what opens next season's. Reopening a draft closed by
 * mistake puts it straight back.
 */
export function tradeableSeason(
  state: Pick<LeagueDynamicState, 'draft'>,
  dataset: Pick<LeagueDataset, 'season'>,
): number {
  return state.draft.closedAt ? dataset.season + 1 : dataset.season;
}

/**
 * The calendar year a season's draft is held in.
 *
 * Season 2027 is the 2026-27 NBA season and its draft runs in October 2026.
 * Owners call that "the 26 draft" and the app calls it 2027, which has confused
 * people, so every pick names the draft by the year it happens.
 */
export function draftCalendarYear(season: number): number {
  return season - 1;
}

/** "Oct 2026 draft". The unambiguous name for one draft. */
export function draftYearLabel(season: number): string {
  return `Oct ${draftCalendarYear(season)} draft`;
}

/**
 * "Round 5, Oct 2027 draft" — a pick in a draft that has no order yet.
 *
 * Next season's draft positions are not known, so a future pick has no slot and
 * no exact label. Round and draft year is all there is to say.
 */
export function futurePickLabel(ref: PickRef): string {
  return `Round ${ref.round}, ${draftYearLabel(ref.season)}`;
}

/* ------------------------------------------------------------------ */
/* Pick identity                                                       */
/* ------------------------------------------------------------------ */

export function pickRefKey(ref: PickRef): string {
  return `${ref.season}:${ref.round}:${ref.originalOwner}`;
}

export function sameRef(a: PickRef, b: PickRef): boolean {
  return a.season === b.season && a.round === b.round && a.originalOwner === b.originalOwner;
}

/** "R3 from Derek", or just "R3" when the team still holds its own. */
export function describeRef(ref: PickRef, holder?: string): string {
  return holder && holder !== ref.originalOwner
    ? `R${ref.round} from ${ref.originalOwner}`
    : `R${ref.round}`;
}

export function refOf(pick: PickSlot): PickRef {
  return { season: pick.season, round: pick.round, originalOwner: pick.originalOwner };
}

/* ------------------------------------------------------------------ */
/* One row per pick                                                    */
/* ------------------------------------------------------------------ */

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'];

/** 1 becomes "1st", 2 "2nd", 11 "11th", 14 "14th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (ORDINAL_SUFFIX[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** "1st Round Pick". The title of one row. */
export function pickTitle(ref: PickRef): string {
  return `${ordinal(ref.round)} Round Pick`;
}

/** One pick on the move, with both ends named. */
export interface TradeAsset {
  ref: PickRef;
  /** The member handing this pick over. */
  from: string;
  /** The member getting it. */
  to: string;
}

/** Which team the pick started with. The line under the title. */
export function assetOrigin(asset: TradeAsset): string {
  return asset.ref.originalOwner === asset.from
    ? `${asset.from}'s own pick`
    : `Originally ${asset.ref.originalOwner}'s`;
}

export interface TradeSides {
  /** Picks coming to the reader. */
  receives: TradeAsset[];
  /** Picks leaving the reader. */
  sends: TradeAsset[];
}

/**
 * The two columns of a trade as one reader sees them.
 *
 * The offer moves proposer to recipient and the request moves recipient to
 * proposer, so the columns swap depending on who is reading. Anyone outside
 * the trade reads it from the proposer's seat.
 */
export function tradeSidesFor(
  proposal: Pick<PickTradeProposal, 'proposer' | 'recipient' | 'offer' | 'request'>,
  reader: string,
): TradeSides {
  const offer = proposal.offer.map((ref) => ({
    ref,
    from: proposal.proposer,
    to: proposal.recipient,
  }));
  const request = proposal.request.map((ref) => ({
    ref,
    from: proposal.recipient,
    to: proposal.proposer,
  }));
  return reader === proposal.recipient
    ? { receives: offer, sends: request }
    : { receives: request, sends: offer };
}

/* ------------------------------------------------------------------ */
/* Reading state safely                                                */
/* ------------------------------------------------------------------ */

/** A stored transfer read back with its season filled in. */
export type SeasonedTransfer = PickTransfer & { season: number };

type LedgerState = Pick<LeagueDynamicState, 'pickTransfers'> & { season?: number };
type ProposalState = Pick<LeagueDynamicState, 'pickTradeProposals'> & { season?: number };

/**
 * The accepted-transfer ledger, every row naming its draft.
 *
 * Rows saved before this feature shipped have no array at all, and rows saved
 * before picks became season-aware have no season. Both read as the current
 * draft, so old agreements keep meaning what they meant.
 */
export function transfersOf(state: LedgerState, currentSeason?: number): SeasonedTransfer[] {
  if (!Array.isArray(state.pickTransfers)) return [];
  const fallback = currentSeason ?? state.season ?? 0;
  return state.pickTransfers.map((t) => withSeason(t, fallback));
}

/** Every proposal, with the season filled in on the offer as well as the row. */
export function proposalsOf(
  state: ProposalState,
  currentSeason?: number,
): PickTradeProposal[] {
  if (!Array.isArray(state.pickTradeProposals)) return [];
  const fallback = currentSeason ?? state.season ?? 0;
  return state.pickTradeProposals.map((proposal) => normalizeProposal(proposal, fallback));
}

/** One proposal with a season on every pick it names. */
export function normalizeProposal(
  proposal: PickTradeProposal,
  currentSeason: number,
): PickTradeProposal {
  const fallback = proposal.season ?? currentSeason;
  const fill = (refs: StoredPickRef[]) => refs.map((ref) => withSeason(ref, fallback));
  return { ...proposal, offer: fill(proposal.offer), request: fill(proposal.request) };
}

/**
 * The dataset with every accepted in-app transfer layered on top of the
 * committed seed. Feed this to anything that needs current pick ownership:
 * the draft board, keeper costs, on-clock permission, the teams page.
 *
 * Transfers for a later season's draft are layered on too, and every row says
 * which draft it is for. The draft board and the keeper engine read only the
 * current season's rows, so a trade of next year's picks cannot touch this
 * year's board.
 */
export function datasetWithTransfers(
  dataset: LeagueDataset,
  transfers: PickTransfer[],
): LeagueDataset {
  if (transfers.length === 0) return dataset;
  return {
    ...dataset,
    pickTrades: [
      ...dataset.pickTrades,
      ...transfers.map((raw) => {
        const t = withSeason(raw, dataset.season);
        return {
          date: t.at.slice(0, 10),
          season: t.season,
          round: t.round,
          from: t.from,
          to: t.to,
          originalOwner: t.originalOwner,
          proposalId: t.proposalId,
          tradeNote: `${t.to} got ${describeRef(t, t.from)} from ${t.from} in an in-app trade.`,
        };
      }),
    ],
  };
}

/** Shorthand for the common "state carries the ledger" case. */
export function datasetForState(
  dataset: LeagueDataset,
  state: LedgerState,
): LeagueDataset {
  return datasetWithTransfers(dataset, transfersOf(state, dataset.season));
}

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export interface ProvenanceStep {
  from: string;
  to: string;
  date: string;
  note?: string;
  proposalId?: string;
}

export interface PickProvenance {
  ref: PickRef;
  currentOwner: string;
  steps: ProvenanceStep[];
}

/** Every hand a pick has passed through, oldest first. */
export function provenanceFor(dataset: LeagueDataset, ref: PickRef): PickProvenance {
  const steps: ProvenanceStep[] = [];
  let holder = ref.originalOwner;
  for (const trade of dataset.pickTrades) {
    if (pickSeason(trade, dataset.season) !== ref.season) continue;
    if (trade.round !== ref.round) continue;
    if ((trade.originalOwner ?? trade.from) !== ref.originalOwner) continue;
    steps.push({
      from: trade.from,
      to: trade.to,
      date: trade.date,
      note: trade.tradeNote,
      proposalId: trade.proposalId,
    });
    holder = trade.to;
  }
  return { ref, currentOwner: holder, steps };
}

/* ------------------------------------------------------------------ */
/* Which picks a member may put in a trade                             */
/* ------------------------------------------------------------------ */

/**
 * One pick in one season, with its board slot when there is one.
 *
 * The current draft has an order, so its picks have a slot and an exact label
 * like 1.9. A later season's draft has no order yet, so its picks have neither.
 */
export interface SeasonPick {
  ref: PickRef;
  currentOwner: string;
  /** Null for a draft that has not been ordered yet. */
  slot: PickSlot | null;
  /** "1.9" for a pick on the board, "Round 5, Oct 2027 draft" for a future one. */
  label: string;
}

/**
 * Every pick in one season's draft, with who owns it now.
 *
 * For the current draft that is the board. For a later one it is built from the
 * team list, because every team starts with its own rounds 1 to `draftRounds`,
 * and then any accepted trades for that season are replayed over the top.
 */
export function seasonPicks(dataset: LeagueDataset, season: number): SeasonPick[] {
  if (season === dataset.season) {
    return buildAllPicks(dataset).map((slot) => ({
      ref: refOf(slot),
      currentOwner: slot.currentOwner,
      slot,
      label: pickLabel(slot),
    }));
  }

  const owners = dataset.teams.map((team) => team.owner);
  const holder = new Map<string, string>();
  const picks: SeasonPick[] = [];
  for (let round = 1; round <= dataset.draftRounds; round++) {
    for (const owner of owners) {
      const ref: PickRef = { season, round, originalOwner: owner };
      holder.set(pickRefKey(ref), owner);
      picks.push({ ref, currentOwner: owner, slot: null, label: futurePickLabel(ref) });
    }
  }
  const known = new Set(owners);
  for (const trade of dataset.pickTrades) {
    if (pickSeason(trade, dataset.season) !== season) continue;
    if (!known.has(trade.from) || !known.has(trade.to)) continue;
    const key = pickRefKey({
      season,
      round: trade.round,
      originalOwner: trade.originalOwner ?? trade.from,
    });
    if (holder.has(key)) holder.set(key, trade.to);
  }
  for (const pick of picks) pick.currentOwner = holder.get(pickRefKey(pick.ref)) ?? pick.currentOwner;
  return picks;
}

/** Every pick one team holds in one season's draft. */
export function seasonPicksFor(
  dataset: LeagueDataset,
  season: number,
  owner: string,
): SeasonPick[] {
  return seasonPicks(dataset, season).filter((pick) => pick.currentOwner === owner);
}

/** Why a pick cannot move. */
export type PickBlock = 'drafted' | 'keeper' | 'round-protected';

/** True when the rule book lets this round be traded at all. */
export function isTradeableRound(dataset: LeagueDataset, round: number): boolean {
  return round >= FIRST_TRADEABLE_ROUND && round <= lastTradeableRound(dataset);
}

export interface TradablePick {
  ref: PickRef;
  pick: PickSlot;
  label: string;
  /** False when the pick is already used, so it cannot move. */
  tradable: boolean;
  /** Why not, when it cannot move. */
  blockedBy?: PickBlock;
  onClock: boolean;
}

/**
 * Every pick a team holds in the current draft, flagged for whether it can
 * still move.
 *
 * Before the draft everything the team owns in a tradeable round can move,
 * keeper slots included. A keeper only pencils a pick in, and the engine
 * reprices it after a trade, which is the whole point of the cost preview. Once
 * the draft is running the board is real: a pick with anyone in it stays put,
 * while the pick on the clock is still empty and can move.
 */
export function tradablePicksFor(
  dataset: LeagueDataset,
  state: LeagueDynamicState,
  owner: string,
): TradablePick[] {
  const board = buildDraftBoard(dataset, state);
  const live = state.draft.startedAt !== null;
  return board
    .filter((cell) => cell.pick.currentOwner === owner)
    .map((cell) => toTradablePick(dataset, cell, live));
}

function toTradablePick(
  dataset: LeagueDataset,
  cell: BoardCell,
  draftLive: boolean,
): TradablePick {
  const blockedBy = blockFor(dataset, cell.pick.round, cell.selection !== null, cell.keeper !== null, draftLive);
  return {
    ref: refOf(cell.pick),
    pick: cell.pick,
    label: pickLabel(cell.pick),
    tradable: blockedBy === undefined,
    blockedBy,
    onClock: cell.onClock,
  };
}

function blockFor(
  dataset: LeagueDataset,
  round: number,
  drafted: boolean,
  holdsKeeper: boolean,
  draftLive: boolean,
): PickBlock | undefined {
  if (drafted) return 'drafted';
  if (draftLive && holdsKeeper) return 'keeper';
  if (!isTradeableRound(dataset, round)) return 'round-protected';
  return undefined;
}

/** One pick a team holds in some season, flagged for whether it can move. */
export interface TradableSeasonPick extends SeasonPick {
  tradable: boolean;
  blockedBy?: PickBlock;
  onClock: boolean;
}

/**
 * Every pick a team holds in one season's draft, flagged for whether it can
 * move. Use this when the season may not be the current one.
 *
 * A pick in a future draft is never drafted, never holding a keeper, and never
 * on the clock, so only the round rule can stop it.
 */
export function tradableSeasonPicksFor(
  dataset: LeagueDataset,
  state: LeagueDynamicState,
  owner: string,
  season: number,
): TradableSeasonPick[] {
  if (season === dataset.season) {
    return tradablePicksFor(dataset, state, owner).map((entry) => ({
      ref: entry.ref,
      currentOwner: owner,
      slot: entry.pick,
      label: entry.label,
      tradable: entry.tradable,
      blockedBy: entry.blockedBy,
      onClock: entry.onClock,
    }));
  }
  return seasonPicksFor(dataset, season, owner).map((pick) => {
    const blockedBy: PickBlock | undefined = isTradeableRound(dataset, pick.ref.round)
      ? undefined
      : 'round-protected';
    return { ...pick, tradable: blockedBy === undefined, blockedBy, onClock: false };
  });
}

/** Picks grouped by the team they came from, then by round. For the selector. */
export function groupPicksByOrigin(picks: TradablePick[]): Array<{
  originalOwner: string;
  picks: TradablePick[];
}> {
  const groups = new Map<string, TradablePick[]>();
  for (const entry of [...picks].sort((a, b) => a.pick.round - b.pick.round)) {
    const list = groups.get(entry.ref.originalOwner) ?? [];
    list.push(entry);
    groups.set(entry.ref.originalOwner, list);
  }
  return [...groups.entries()]
    .map(([originalOwner, list]) => ({ originalOwner, picks: list }))
    .sort((a, b) => a.originalOwner.localeCompare(b.originalOwner));
}

/* ------------------------------------------------------------------ */
/* Building a proposal                                                 */
/* ------------------------------------------------------------------ */

export interface ProposalInput {
  proposer: string;
  recipient: string;
  offer: PickRef[];
  request: PickRef[];
  note: string;
}

export type TradeRefusal =
  | 'bad-shape'
  | 'same-owner'
  | 'unknown-owner'
  | 'empty-side'
  | 'unequal-sides'
  | 'too-many-picks'
  | 'duplicate-pick'
  | 'unknown-pick'
  | 'round-protected'
  | 'mixed-seasons'
  | 'wrong-season'
  | 'too-many-away'
  | 'too-many-in-round'
  | 'not-yours'
  | 'not-theirs'
  | 'pick-used'
  | 'not-pending'
  | 'not-yours-to-answer'
  | 'stale-version'
  | 'draft-over'
  | 'keeper-broken';

export interface TradeCheck {
  ok: boolean;
  reason?: TradeRefusal;
  message?: string;
  /**
   * True when the proposal can never work again, so it should be filed as
   * `invalidated` rather than left sitting in the inbox.
   */
  fatal?: boolean;
}

const OK: TradeCheck = { ok: true };

function refuse(reason: TradeRefusal, message: string, fatal = false): TradeCheck {
  return { ok: false, reason, message, fatal };
}

/** The season every pick in a proposal belongs to, or null when they disagree. */
export function proposalSeason(input: ProposalInput): number | null {
  const refs = [...input.offer, ...input.request];
  const first = refs[0]?.season;
  if (first === undefined) return null;
  return refs.every((ref) => ref.season === first) ? first : null;
}

/**
 * Shape checks that need no league state: sizes, duplicates, sane rounds, and
 * the rule-book limits that need only the picks themselves.
 *
 * Rule 4.4.2 wants the same number of picks each way. Rule 4.4.1 puts the 1st
 * and 2nd rounds off limits, and rounds past the keeper tiers were never
 * tradeable. One proposal names one draft, because only one is ever open.
 */
export function checkProposalShape(dataset: LeagueDataset, input: ProposalInput): TradeCheck {
  const owners = new Set(dataset.teams.map((t) => t.owner));
  if (!owners.has(input.proposer) || !owners.has(input.recipient)) {
    return refuse('unknown-owner', 'That team is not in this league.');
  }
  if (input.proposer === input.recipient) {
    return refuse('same-owner', 'Pick a different team to trade with.');
  }
  if (input.offer.length === 0 || input.request.length === 0) {
    return refuse('empty-side', 'Both sides need at least one pick.');
  }
  if (input.offer.length !== input.request.length) {
    return refuse('unequal-sides', 'Both sides must send the same number of picks.');
  }
  if (input.offer.length > MAX_PICKS_PER_SIDE || input.request.length > MAX_PICKS_PER_SIDE) {
    return refuse('too-many-picks', `Keep it to ${MAX_PICKS_PER_SIDE} picks a side.`);
  }

  const seen = new Set<string>();
  for (const ref of [...input.offer, ...input.request]) {
    if (
      !Number.isInteger(ref.round)
      || ref.round < 1
      || ref.round > dataset.draftRounds
      || !Number.isInteger(ref.season)
      || !owners.has(ref.originalOwner)
    ) {
      return refuse('unknown-pick', 'One of those picks does not exist.');
    }
    if (!isTradeableRound(dataset, ref.round)) {
      return refuse(
        'round-protected',
        `Only rounds ${FIRST_TRADEABLE_ROUND} to ${lastTradeableRound(dataset)} can be traded.`,
      );
    }
    if (seen.has(pickRefKey(ref))) {
      return refuse('duplicate-pick', 'The same pick is listed twice.');
    }
    seen.add(pickRefKey(ref));
  }
  if (proposalSeason(input) === null) {
    return refuse('mixed-seasons', 'Every pick in one trade must be from the same draft.');
  }
  return OK;
}

/**
 * How many of its own picks in one draft a team has traded away through the
 * app, counting this trade.
 *
 * Only the app's own ledger counts. The committed preseason seed records trades
 * the league agreed before the app was the system of record (rule 4.4.6), and
 * those are settled. A pick sent, reacquired and sent again counts once.
 */
export function picksTradedAway(
  transfers: PickTransfer[],
  currentSeason: number,
  season: number,
  owner: string,
  alsoMoving: Array<{ ref: PickRef; from: string }> = [],
): number {
  const gone = new Set<string>();
  for (const raw of transfers) {
    const t = withSeason(raw, currentSeason);
    if (t.season !== season || t.from !== owner || t.originalOwner !== owner) continue;
    gone.add(pickRefKey(t));
  }
  for (const move of alsoMoving) {
    if (move.from !== owner || move.ref.originalOwner !== owner) continue;
    if (move.ref.season !== season) continue;
    gone.add(pickRefKey(move.ref));
  }
  return gone.size;
}

/**
 * The rule-book limits on how many picks a team may hold or give up in one
 * draft, read as the board would stand after this trade.
 *
 * Rule 4.4.1.2 caps a team at two of its own picks traded away for one draft.
 * Rule 4.4.3 caps a team at two picks in any one round of one draft. Both count
 * within a season, so what a team does with next year's picks never limits what
 * it can do with this year's.
 */
export function checkSeasonLimits(
  dataset: LeagueDataset,
  state: Pick<LeagueDynamicState, 'pickTransfers' | 'season'>,
  season: number,
  input: ProposalInput,
): TradeCheck {
  const moving = [
    ...input.offer.map((ref) => ({ ref, from: input.proposer })),
    ...input.request.map((ref) => ({ ref, from: input.recipient })),
  ];
  const after = seasonPicks(applyProposalToDataset(dataset, input), season);

  for (const owner of [input.proposer, input.recipient]) {
    const away = picksTradedAway(
      transfersOf(state, dataset.season),
      dataset.season,
      season,
      owner,
      moving,
    );
    if (away > MAX_PICKS_AWAY_PER_SEASON) {
      return refuse(
        'too-many-away',
        `${owner} would have traded away ${away} of their own picks in the ${draftYearLabel(season)}. The limit is ${MAX_PICKS_AWAY_PER_SEASON}.`,
      );
    }

    const perRound = new Map<number, number>();
    for (const pick of after) {
      if (pick.currentOwner !== owner) continue;
      perRound.set(pick.ref.round, (perRound.get(pick.ref.round) ?? 0) + 1);
    }
    for (const [round, held] of perRound) {
      if (held > MAX_PICKS_PER_ROUND) {
        return refuse(
          'too-many-in-round',
          `${owner} would hold ${held} round-${round} picks in the ${draftYearLabel(season)}. The limit is ${MAX_PICKS_PER_ROUND}.`,
        );
      }
    }
  }
  return OK;
}

/**
 * Everything the shape check cannot see: who owns each pick right now, whether
 * the picks are still empty, and whether the trade would break a locked keeper.
 *
 * Both propose and accept run this. On accept it runs inside the same write
 * that applies the transfers, so nothing can change underneath it.
 */
export function checkProposalAgainstState(
  dataset: LeagueDataset,
  state: LeagueDynamicState,
  input: ProposalInput,
): TradeCheck {
  const shape = checkProposalShape(dataset, input);
  if (!shape.ok) return shape;

  const season = proposalSeason(input) as number;
  const open = tradeableSeason(state, dataset);
  if (season !== open) {
    return refuse(
      'wrong-season',
      `Only ${draftYearLabel(open)} picks can be traded right now.`,
    );
  }

  const future = season !== dataset.season;
  const board = future ? [] : buildDraftBoard(dataset, state);
  const byKey = new Map(board.map((cell) => [pickRefKey(refOf(cell.pick)), cell]));
  const owned = new Map(
    seasonPicks(dataset, season).map((pick) => [pickRefKey(pick.ref), pick]),
  );
  const live = !future && state.draft.startedAt !== null;

  if (live && !board.some((cell) => cell.onClock)) {
    return refuse('draft-over', 'The draft is finished. Picks cannot move now.', true);
  }

  const sides: Array<[PickRef[], string, TradeRefusal]> = [
    [input.offer, input.proposer, 'not-yours'],
    [input.request, input.recipient, 'not-theirs'],
  ];
  for (const [refs, owner, reason] of sides) {
    for (const ref of refs) {
      const held = owned.get(pickRefKey(ref));
      if (!held) return refuse('unknown-pick', 'One of those picks does not exist.', true);
      if (held.currentOwner !== owner) {
        return refuse(
          reason,
          `${describeRef(ref)} is not ${owner}'s any more. ${held.currentOwner} owns it.`,
          true,
        );
      }
      const cell = byKey.get(pickRefKey(ref));
      if (!cell) continue; // A future draft has no board, so nothing can be used.
      const entry = toTradablePick(dataset, cell, live);
      if (!entry.tradable) {
        return refuse(
          'pick-used',
          entry.blockedBy === 'drafted'
            ? `Pick ${entry.label} has already been used in the draft.`
            : `Pick ${entry.label} is holding a keeper, so it cannot move.`,
          entry.blockedBy === 'drafted',
        );
      }
    }
  }

  const limits = checkSeasonLimits(dataset, state, season, input);
  if (!limits.ok) return limits;

  // After keepers lock, a trade that leaves either side unable to pay for a
  // keeper is refused outright. The keeper engine decides that, not this file.
  // Only the current draft's picks can do that: a pick in a later draft pays
  // for nothing this year.
  if (!future && state.locks.keepersLocked) {
    const after = applyProposalToDataset(dataset, input);
    for (const owner of [input.proposer, input.recipient]) {
      const selections = state.keepers[owner] ?? [];
      if (selections.length === 0) continue;
      const before = resolveTeamKeepers(dataset, owner, selections);
      const now = resolveTeamKeepers(after, owner, selections);
      if (before.valid && !now.valid) {
        return refuse(
          'keeper-broken',
          `Keepers are locked and this trade would leave ${owner} unable to pay for a keeper.`,
        );
      }
    }
  }

  return OK;
}

/** The dataset as it would look with this trade done. Never mutates the input. */
export function applyProposalToDataset(
  dataset: LeagueDataset,
  input: ProposalInput,
  at = new Date().toISOString(),
  proposalId = 'preview',
): LeagueDataset {
  return datasetWithTransfers(dataset, transfersForProposal(input, at, proposalId));
}

/** The ledger rows an accepted proposal writes. */
export function transfersForProposal(
  input: ProposalInput,
  at: string,
  proposalId: string,
): SeasonedTransfer[] {
  return [
    ...input.offer.map((ref) => ({ ...ref, from: input.proposer, to: input.recipient, at, proposalId })),
    ...input.request.map((ref) => ({ ...ref, from: input.recipient, to: input.proposer, at, proposalId })),
  ];
}

/* ------------------------------------------------------------------ */
/* Proposal lifecycle                                                  */
/* ------------------------------------------------------------------ */

export function isPending(proposal: PickTradeProposal): boolean {
  return proposal.status === 'pending';
}

export function participants(proposal: PickTradeProposal): string[] {
  return [proposal.proposer, proposal.recipient];
}

export function involves(proposal: PickTradeProposal, owner: string): boolean {
  return proposal.proposer === owner || proposal.recipient === owner;
}

export function touchesRef(proposal: PickTradeProposal, ref: PickRef): boolean {
  return [...proposal.offer, ...proposal.request].some((candidate) => sameRef(candidate, ref));
}

export function expiresAtFrom(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + PROPOSAL_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * File any pending offer whose time ran out. Returns a new array; callers that
 * want it saved write the result back.
 */
export function expireStale(
  proposals: PickTradeProposal[],
  now: string,
): { proposals: PickTradeProposal[]; changed: boolean } {
  let changed = false;
  const next = proposals.map((proposal) => {
    if (!isPending(proposal) || proposal.expiresAt > now) return proposal;
    changed = true;
    return {
      ...proposal,
      status: 'expired' as const,
      version: proposal.version + 1,
      resolvedAt: now,
      reason: 'Nobody answered in time.',
    };
  });
  return { proposals: next, changed };
}

export type AnswerAction = 'accept' | 'reject' | 'cancel';

/** Who is allowed to do what with a pending offer. */
export function canAnswer(
  proposal: PickTradeProposal,
  owner: string,
  action: AnswerAction,
  isCommissioner: boolean,
): TradeCheck {
  if (!isPending(proposal)) {
    return refuse('not-pending', 'That offer has already been settled.');
  }
  if (action === 'accept') {
    // The commissioner never accepts for a member. Rule 4.4.6 support work is
    // limited to cancelling something stuck.
    return proposal.recipient === owner
      ? OK
      : refuse('not-yours-to-answer', 'Only the member the offer was sent to can accept it.');
  }
  if (action === 'reject') {
    return proposal.recipient === owner
      ? OK
      : refuse('not-yours-to-answer', 'Only the member the offer was sent to can turn it down.');
  }
  return proposal.proposer === owner || isCommissioner
    ? OK
    : refuse('not-yours-to-answer', 'Only the member who sent the offer, or a commissioner, can pull it.');
}

export function proposalInput(proposal: PickTradeProposal): ProposalInput {
  return {
    proposer: proposal.proposer,
    recipient: proposal.recipient,
    offer: proposal.offer,
    request: proposal.request,
    note: proposal.note,
  };
}

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

/**
 * What one viewer may see.
 *
 * A pending offer is between two members and nobody else, so its picks stay
 * private. Accepted trades are league news. The commissioner gets pending
 * offers stripped down to who and when, which is all they need to pull a stuck
 * one; the picks stay between the two members.
 */
export function visibleProposals(
  proposals: PickTradeProposal[],
  viewer: string | null,
  isCommissioner: boolean,
): PickTradeProposal[] {
  const out: PickTradeProposal[] = [];
  for (const proposal of proposals) {
    if (proposal.status === 'accepted') {
      out.push(proposal);
      continue;
    }
    if (viewer && involves(proposal, viewer)) {
      out.push(proposal);
      continue;
    }
    if (isCommissioner && isPending(proposal)) {
      out.push({ ...proposal, offer: [], request: [], note: '' });
    }
  }
  return out;
}

/** Pending offers waiting on this member to answer. Drives the nav badge. */
export function inboxCount(proposals: PickTradeProposal[], owner: string | null): number {
  if (!owner) return 0;
  return proposals.filter((p) => isPending(p) && p.recipient === owner).length;
}

/* ------------------------------------------------------------------ */
/* Keeper cost preview                                                 */
/* ------------------------------------------------------------------ */

export interface KeeperCostChange {
  playerKey: string;
  playerName: string;
  tierRound: number | null;
  beforePick: string | null;
  afterPick: string | null;
  beforeBump: 'traded' | 'duplicate' | null;
  afterBump: 'traded' | 'duplicate' | null;
}

export interface SideKeeperPreview {
  owner: string;
  /** True when the viewer is allowed to see this team's keeper names. */
  detailed: boolean;
  keeperCount: number;
  worksBefore: boolean;
  worksAfter: boolean;
  changes: KeeperCostChange[];
  /** One line a member can act on. Always safe to show. */
  summary: string;
}

export interface TradePreview {
  check: TradeCheck;
  keepersLocked: boolean;
  sides: SideKeeperPreview[];
  /** Provenance for every pick the trade would move. */
  provenance: PickProvenance[];
}

/**
 * How the trade changes both teams' keeper pick costs.
 *
 * Keeper names are secret until the commissioner reveals them, so the full
 * before/after list is built only for teams the viewer may already see. The
 * other side still gets a plain answer about whether its keepers survive,
 * which is what the member needs to decide.
 */
export function previewProposal(
  dataset: LeagueDataset,
  state: LeagueDynamicState,
  input: ProposalInput,
  viewer: { owner: string | null; isCommissioner: boolean; revealed: boolean },
): TradePreview {
  const check = checkProposalAgainstState(dataset, state, input);
  const after = applyProposalToDataset(dataset, input);
  const sides = [input.proposer, input.recipient].map((owner) =>
    previewSide(dataset, after, state, owner, viewer),
  );
  const provenance = [...input.offer, ...input.request].map((ref) => provenanceFor(dataset, ref));
  return { check, keepersLocked: state.locks.keepersLocked, sides, provenance };
}

function previewSide(
  before: LeagueDataset,
  after: LeagueDataset,
  state: LeagueDynamicState,
  owner: string,
  viewer: { owner: string | null; isCommissioner: boolean; revealed: boolean },
): SideKeeperPreview {
  const selections = state.keepers[owner] ?? [];
  const detailed = viewer.revealed || viewer.isCommissioner || viewer.owner === owner;
  const was = resolveTeamKeepers(before, owner, selections);
  const now = resolveTeamKeepers(after, owner, selections);

  const changes: KeeperCostChange[] = [];
  now.keepers.forEach((keeper, i) => {
    const old = was.keepers[i];
    const beforePick = old?.pick ? pickLabel(old.pick) : null;
    const afterPick = keeper.pick ? pickLabel(keeper.pick) : null;
    if (beforePick === afterPick && (old?.bumpReason ?? null) === keeper.bumpReason) return;
    changes.push({
      playerKey: keeper.selection.playerKey,
      playerName: keeper.selection.playerName,
      tierRound: keeper.round,
      beforePick,
      afterPick,
      beforeBump: old?.bumpReason ?? null,
      afterBump: keeper.bumpReason,
    });
  });

  return {
    owner,
    detailed,
    keeperCount: selections.length,
    worksBefore: was.valid,
    worksAfter: now.valid,
    changes: detailed ? changes : [],
    summary: summarise(owner, selections.length, was.valid, now.valid, changes.length, detailed),
  };
}

function summarise(
  owner: string,
  keeperCount: number,
  worksBefore: boolean,
  worksAfter: boolean,
  changeCount: number,
  detailed: boolean,
): string {
  if (keeperCount === 0) return `${owner} has no keepers in yet.`;
  if (worksBefore && !worksAfter) return `${owner} could no longer pay for a keeper after this.`;
  if (!worksBefore) return `${owner}'s keeper set already has a problem to fix.`;
  if (changeCount === 0) return `${owner}'s keeper pick costs do not change.`;
  const noun = changeCount === 1 ? 'keeper' : 'keepers';
  return detailed
    ? `${owner}: ${changeCount} ${noun} would cost a different pick.`
    : `${owner}'s keepers still work. ${changeCount} would cost a different pick.`;
}

/* ------------------------------------------------------------------ */
/* Summaries for lists                                                 */
/* ------------------------------------------------------------------ */

/** "R3, R9 for R4" — what each side gives, in a line. */
export function describeTrade(proposal: PickTradeProposal): string {
  if (proposal.offer.length === 0 && proposal.request.length === 0) return 'Picks hidden';
  const side = (refs: PickRef[]) =>
    refs.map((ref) => describeRef(ref)).join(', ');
  return `${side(proposal.offer)} for ${side(proposal.request)}`;
}

export const STATUS_LABEL: Record<PickTradeStatus, string> = {
  pending: 'WAITING',
  accepted: 'DONE',
  rejected: 'TURNED DOWN',
  cancelled: 'PULLED',
  expired: 'RAN OUT',
  invalidated: 'NO LONGER VALID',
};

/** Keeper-costable picks a team holds. Used to warn before an over-trade. */
export function keeperPickCount(dataset: LeagueDataset, owner: string): number {
  return buildAllPicks(dataset).filter(
    (pick) => pick.currentOwner === owner && pick.round <= KEEPER_ROUNDS,
  ).length;
}
