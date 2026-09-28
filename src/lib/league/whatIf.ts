/**
 * What-if worlds: the board and the mock draft under assumptions that are not
 * yet true.
 *
 * Two kinds of assumption, both switchable and neither ever written:
 *
 * - Assumed keepers. The viewer's private keeper scenario already holds
 *   their guesses at what other teams keep. Their own what-if ("if I keep
 *   Cade") comes in through `ownKeepers` and is applied after the trades,
 *   because that is when a real owner picks again: a trade that moves the
 *   pick paying for a keeper resets the real keepers first.
 * - Pending trades. Any offer the viewer can see the picks of can be switched
 *   on. The board redraws with the picks moved, and the mock runs from there.
 *
 * Rules, from the handoff:
 *
 * - Only pending offers switch. Accepted ones are already true; the rest are
 *   gone.
 * - Two offers that move the same pick cannot both be on. The second is
 *   skipped and says why.
 * - A trade that moves a pick a keeper is charged to resets that owner's
 *   keepers. That rule is live in `pickTrades.ts`; a world that ignored it
 *   would show a board that cannot happen. The reset is applied and reported.
 * - Nothing here writes. It is a view.
 */
import type {
  KeeperSelection,
  LeagueDataset,
  LeagueDynamicState,
  PickTradeProposal,
} from '../keeper/types.js';
import type { KeeperScenario } from './keeperScenario.js';
import {
  applyProposalToDataset,
  isPending,
  ownersResetByTrade,
  pickRefKey,
  proposalInput,
} from './pickTrades.js';
import { buildMockBoard, keepersForMock, type KeeperStatus, type MockBoard } from './mockDraft.js';

export interface WorldInput {
  /** Whose eyes. Their own keepers are always theirs to see. */
  viewer: string | null;
  state: LeagueDynamicState;
  /** The viewer's guesses at what other teams keep. */
  scenario: KeeperScenario;
  /** Every offer the viewer can see. Private ones arrive with empty pick lists. */
  proposals: readonly PickTradeProposal[];
  /** Offers switched on, in the order they were switched. */
  tradesOn: readonly string[];
  /** Read other teams' entered keepers as known before the reveal. See `MockBoardInput`. */
  useEntered?: boolean;
  /** Teams whose entered keepers to set aside for the guess. See `MockBoardInput`. */
  guessInstead?: readonly string[];
  /**
   * The viewer's own what-if keepers, picked as if after the trades. Absent
   * or null means their real submission, which a trade may reset. An empty
   * list means "if I keep nobody".
   */
  ownKeepers?: KeeperSelection[] | null;
}

export type TradeSkipReason = 'unknown' | 'not-pending' | 'private' | 'conflict';

export interface SkippedTrade {
  id: string;
  reason: TradeSkipReason;
  /** The offer already on that this one collides with. */
  conflictsWith?: string;
  message: string;
}

export interface KeeperReset {
  owner: string;
  /** Whether the keepers wiped were the owner's real ones or the viewer's guess. */
  status: KeeperStatus;
  players: string[];
  proposalId: string;
}

export interface World {
  dataset: LeagueDataset;
  state: LeagueDynamicState;
  scenario: KeeperScenario;
  applied: PickTradeProposal[];
  skipped: SkippedTrade[];
  resets: KeeperReset[];
  board: MockBoard;
}

/** The picks a proposal moves, by identity. */
function pickKeys(proposal: PickTradeProposal): string[] {
  return [...proposal.offer, ...proposal.request].map(pickRefKey);
}

/** Pending offers whose picks the viewer can see. Only these can be switched. */
export function switchableTrades(proposals: readonly PickTradeProposal[]): PickTradeProposal[] {
  return proposals.filter((proposal) => isPending(proposal) && pickKeys(proposal).length > 0);
}

/** Pending offers the viewer knows exist but cannot see into. */
export function privateTrades(proposals: readonly PickTradeProposal[]): PickTradeProposal[] {
  return proposals.filter((proposal) => isPending(proposal) && pickKeys(proposal).length === 0);
}

/**
 * For every switchable offer, the other switchable offers that move one of the
 * same picks. Two of these cannot both be on.
 */
export function tradeConflicts(proposals: readonly PickTradeProposal[]): Map<string, string[]> {
  const live = switchableTrades(proposals);
  const conflicts = new Map<string, string[]>();
  for (const proposal of live) {
    const mine = new Set(pickKeys(proposal));
    conflicts.set(
      proposal.id,
      live
        .filter((other) => other.id !== proposal.id && pickKeys(other).some((key) => mine.has(key)))
        .map((other) => other.id),
    );
  }
  return conflicts;
}

/** Build one world: trades applied, keepers reset where a charged pick moved, board built. */
export function buildWorld(dataset: LeagueDataset, input: WorldInput): World {
  const scenario: KeeperScenario = Object.fromEntries(
    Object.entries(input.scenario).map(([owner, selections]) => [owner, selections.map((s) => ({ ...s }))]),
  );

  // The keeper sets the mock will use: real for the viewer and, after the
  // reveal, for everyone; the viewer's guess for the rest. Resets act on these.
  const sets = keepersForMock(dataset, { viewer: input.viewer, state: input.state, scenario, useEntered: input.useEntered, guessInstead: input.guessInstead });

  const byId = new Map(input.proposals.map((proposal) => [proposal.id, proposal]));
  const applied: PickTradeProposal[] = [];
  const skipped: SkippedTrade[] = [];
  const resets: KeeperReset[] = [];
  const moved = new Map<string, string>();
  let current = dataset;

  for (const id of input.tradesOn) {
    const proposal = byId.get(id);
    if (!proposal) {
      skipped.push({ id, reason: 'unknown', message: 'That offer is not in your list any more.' });
      continue;
    }
    if (!isPending(proposal)) {
      skipped.push({ id, reason: 'not-pending', message: 'That offer is no longer pending.' });
      continue;
    }
    const keys = pickKeys(proposal);
    if (keys.length === 0) {
      skipped.push({ id, reason: 'private', message: 'The picks in that offer are private to the two members.' });
      continue;
    }
    const clash = keys.map((key) => moved.get(key)).find((other) => other !== undefined);
    if (clash) {
      skipped.push({
        id,
        reason: 'conflict',
        conflictsWith: clash,
        message: 'Moves a pick another switched-on offer already moves. Only one can be on.',
      });
      continue;
    }

    const trade = proposalInput(proposal);
    for (const owner of ownersResetByTrade(current, { keepers: sets.keepers, locks: input.state.locks }, trade)) {
      resets.push({
        owner,
        status: sets.status[owner] ?? 'assumed',
        players: (sets.keepers[owner] ?? []).map((selection) => selection.playerName),
        proposalId: proposal.id,
      });
      sets.keepers[owner] = [];
    }
    current = applyProposalToDataset(current, trade, proposal.createdAt, proposal.id);
    for (const key of keys) moved.set(key, proposal.id);
    applied.push(proposal);
  }

  // The viewer's own what-if lands after the trades, the way a real re-pick
  // would. It is a guess about themselves, so it travels as one.
  const ownWhatIf = input.viewer && input.ownKeepers !== undefined && input.ownKeepers !== null
    ? input.ownKeepers.map((s) => ({ ...s }))
    : null;
  if (ownWhatIf && input.viewer) {
    sets.keepers[input.viewer] = ownWhatIf;
    sets.status[input.viewer] = 'assumed';
  }

  // Hand the resolved sets back through the same door the mock reads from:
  // real keepers in state, guesses in the scenario. The viewer keeps their
  // real submission unless a what-if was given or a reset took it.
  const state: LeagueDynamicState = { ...input.state, keepers: { ...input.state.keepers } };
  const worldScenario: KeeperScenario = {};
  for (const team of dataset.teams) {
    const owner = team.owner;
    if (sets.status[owner] === 'known') {
      state.keepers[owner] = sets.keepers[owner] ?? [];
    } else if (owner !== input.viewer || ownWhatIf) {
      worldScenario[owner] = sets.keepers[owner] ?? [];
    }
  }

  const board = buildMockBoard(current, { viewer: input.viewer, state, scenario: worldScenario, useEntered: input.useEntered, guessInstead: input.guessInstead });
  return { dataset: current, state, scenario: worldScenario, applied, skipped, resets, board };
}
