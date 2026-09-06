/**
 * Member-to-member draft pick trades.
 *
 * Pure and shared by client and server, so the review screen a member reads is
 * the same arithmetic the server enforces on accept.
 *
 * Draft picks only. No players, keeper rights, future seasons, or cash.
 *
 * A pick's identity is its round plus the team it originally belonged to. That
 * never changes. Who owns it right now is derived: start from the committed
 * preseason seed in `dataset.pickTrades`, then replay the append-only ledger of
 * accepted in-app transfers. Replaying is what lets one pick pass through
 * several owners and still show its whole chain of custody.
 *
 * Keeper cost previews call the keeper engine. None of the rule math lives
 * here.
 */
import {
  buildAllPicks,
  buildDraftBoard,
  pickLabel,
  resolveTeamKeepers,
  slotFor,
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
} from '../keeper/types.js';

export type { PickRef, PickTradeProposal, PickTradeStatus, PickTransfer };

/** A pending offer goes stale on its own after this long. */
export const PROPOSAL_TTL_DAYS = 7;

/** Most picks one side may put in a single trade. Keeps the review readable. */
export const MAX_PICKS_PER_SIDE = 6;

export const MAX_TRADE_NOTE = 400;

/* ------------------------------------------------------------------ */
/* Pick identity                                                       */
/* ------------------------------------------------------------------ */

export function pickRefKey(ref: PickRef): string {
  return `${ref.round}:${ref.originalOwner}`;
}

export function sameRef(a: PickRef, b: PickRef): boolean {
  return a.round === b.round && a.originalOwner === b.originalOwner;
}

/** "R3 from Derek", or just "R3" when the team still holds its own. */
export function describeRef(ref: PickRef, holder?: string): string {
  return holder && holder !== ref.originalOwner
    ? `R${ref.round} from ${ref.originalOwner}`
    : `R${ref.round}`;
}

export function refOf(pick: PickSlot): PickRef {
  return { round: pick.round, originalOwner: pick.originalOwner };
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

/** "1st Round Pick". Used when the slot cannot be worked out. */
export function pickTitle(ref: PickRef): string {
  return `${ordinal(ref.round)} Round Pick`;
}

/** Teams and their draft order. All the slot needs. */
export type DraftOrder = Pick<LeagueDataset, 'teams'>;

/**
 * Where a pick sits inside its round.
 *
 * A `PickRef` carries only the round and the team the pick came from, so the
 * slot has to be worked out. The draft snakes: in odd rounds the slot is the
 * original owner's draft position, in even rounds it is that position mirrored,
 * so position 1 picks last. Trades never move a pick's slot, only who holds it.
 *
 * This is the same sum `buildAllPicks` does, and a test pins the two together
 * over every pick in the league. Null when the team is not in this league.
 */
export function pickSlotFor(dataset: DraftOrder, ref: PickRef): number | null {
  const team = dataset.teams.find((t) => t.owner === ref.originalOwner);
  return team ? slotFor(ref.round, team.draftPosition, dataset.teams.length) : null;
}

/** "1.9". The exact pick, the same label the draft board uses. */
export function exactPickLabel(dataset: DraftOrder, ref: PickRef): string {
  const slot = pickSlotFor(dataset, ref);
  return slot === null ? `R${ref.round}` : `${ref.round}.${slot}`;
}

/** "Pick 1.9". The title of one row. */
export function exactPickTitle(dataset: DraftOrder, ref: PickRef): string {
  const slot = pickSlotFor(dataset, ref);
  return slot === null ? pickTitle(ref) : `Pick ${ref.round}.${slot}`;
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

/** Rows saved before this feature shipped have neither field. */
export function transfersOf(state: Pick<LeagueDynamicState, 'pickTransfers'>): PickTransfer[] {
  return Array.isArray(state.pickTransfers) ? state.pickTransfers : [];
}

export function proposalsOf(
  state: Pick<LeagueDynamicState, 'pickTradeProposals'>,
): PickTradeProposal[] {
  return Array.isArray(state.pickTradeProposals) ? state.pickTradeProposals : [];
}

/**
 * The dataset with every accepted in-app transfer layered on top of the
 * committed seed. Feed this to anything that needs current pick ownership:
 * the draft board, keeper costs, on-clock permission, the teams page.
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
      ...transfers.map((t) => ({
        date: t.at.slice(0, 10),
        round: t.round,
        from: t.from,
        to: t.to,
        originalOwner: t.originalOwner,
        proposalId: t.proposalId,
        tradeNote: `${t.to} got ${describeRef(t, t.from)} from ${t.from} in an in-app trade.`,
      })),
    ],
  };
}

/** Shorthand for the common "state carries the ledger" case. */
export function datasetForState(
  dataset: LeagueDataset,
  state: Pick<LeagueDynamicState, 'pickTransfers'>,
): LeagueDataset {
  return datasetWithTransfers(dataset, transfersOf(state));
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

export interface TradablePick {
  ref: PickRef;
  pick: PickSlot;
  label: string;
  /** False when the pick is already used, so it cannot move. */
  tradable: boolean;
  /** Why not, when it cannot move. */
  blockedBy?: 'drafted' | 'keeper';
  onClock: boolean;
}

/**
 * Every pick a team holds, flagged for whether it can still move.
 *
 * Before the draft everything the team owns is tradable, keeper slots included.
 * A keeper only pencils a pick in, and the engine reprices it after a trade,
 * which is the whole point of the cost preview. Once the draft is running the
 * board is real: a pick with anyone in it stays put, while the pick on the
 * clock is still empty and can move.
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
    .map((cell) => toTradablePick(cell, live));
}

function toTradablePick(cell: BoardCell, draftLive: boolean): TradablePick {
  const blockedBy = cell.selection ? 'drafted' : draftLive && cell.keeper ? 'keeper' : undefined;
  return {
    ref: refOf(cell.pick),
    pick: cell.pick,
    label: pickLabel(cell.pick),
    tradable: blockedBy === undefined,
    blockedBy,
    onClock: cell.onClock,
  };
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
  | 'too-many-picks'
  | 'duplicate-pick'
  | 'unknown-pick'
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

/** Shape checks that need no league state: sizes, duplicates, sane rounds. */
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
  if (input.offer.length > MAX_PICKS_PER_SIDE || input.request.length > MAX_PICKS_PER_SIDE) {
    return refuse('too-many-picks', `Keep it to ${MAX_PICKS_PER_SIDE} picks a side.`);
  }

  const seen = new Set<string>();
  for (const ref of [...input.offer, ...input.request]) {
    if (
      !Number.isInteger(ref.round)
      || ref.round < 1
      || ref.round > dataset.draftRounds
      || !owners.has(ref.originalOwner)
    ) {
      return refuse('unknown-pick', 'One of those picks does not exist.');
    }
    if (seen.has(pickRefKey(ref))) {
      return refuse('duplicate-pick', 'The same pick is listed twice.');
    }
    seen.add(pickRefKey(ref));
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

  const board = buildDraftBoard(dataset, state);
  const byKey = new Map(board.map((cell) => [pickRefKey(refOf(cell.pick)), cell]));
  const live = state.draft.startedAt !== null;

  if (live && !board.some((cell) => cell.onClock)) {
    return refuse('draft-over', 'The draft is finished. Picks cannot move now.', true);
  }

  const sides: Array<[PickRef[], string, TradeRefusal]> = [
    [input.offer, input.proposer, 'not-yours'],
    [input.request, input.recipient, 'not-theirs'],
  ];
  for (const [refs, owner, reason] of sides) {
    for (const ref of refs) {
      const cell = byKey.get(pickRefKey(ref));
      if (!cell) return refuse('unknown-pick', 'One of those picks does not exist.', true);
      if (cell.pick.currentOwner !== owner) {
        return refuse(
          reason,
          `${describeRef(ref)} is not ${owner}'s any more. ${cell.pick.currentOwner} owns it.`,
          true,
        );
      }
      const entry = toTradablePick(cell, live);
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

  // After keepers lock, a trade that leaves either side unable to pay for a
  // keeper is refused outright. The keeper engine decides that, not this file.
  if (state.locks.keepersLocked) {
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
): PickTransfer[] {
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

/**
 * "2.1, 9.10 for 2.6". What each side gives, in a line.
 *
 * Plain text, no markup: the server puts this straight into a trade
 * notification and the audit log.
 *
 * A round on its own is ambiguous. Two teams swapping second rounders both read
 * "R2", so the line said nothing. With the dataset each pick gets its exact
 * number. Without one, fall back to naming the team the pick came from, which
 * is the other half of a pick's identity. Callers that can reach the dataset
 * should pass it.
 */
export function describeTrade(proposal: PickTradeProposal, dataset?: DraftOrder): string {
  if (proposal.offer.length === 0 && proposal.request.length === 0) return 'Picks hidden';
  const name = (ref: PickRef) =>
    dataset ? exactPickLabel(dataset, ref) : `R${ref.round} from ${ref.originalOwner}`;
  const side = (refs: PickRef[]) => refs.map(name).join(', ');
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
