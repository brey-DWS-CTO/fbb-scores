/**
 * The league's activity log for LEAGUE HQ: what happened, newest first, that
 * every member may see. Today that is every pick trade that went through.
 *
 * Pure. No server, no browser.
 */
import type { PickRef, PickTradeProposal } from '../keeper/types.js';
import { exactPickLabel, type DraftOrder } from './pickTrades.js';
import type { Move } from './transactions.js';

export interface ActivityEntry {
  id: string;
  /** When it happened, ISO. */
  at: string;
  /** A pick trade in the app, or a move on ESPN. */
  kind: 'trade' | 'move';
  title: string;
  lines: string[];
}

const byNewest = (a: ActivityEntry, b: ActivityEntry) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id);

/**
 * Pick trades and ESPN moves in one list, newest first, cut to `limit`.
 * LEAGUE HQ shows the top of it; the ACTIVITY page shows every move.
 */
export function mergedActivity(
  trades: readonly ActivityEntry[],
  moves: readonly Move[],
  limit = 8,
): ActivityEntry[] {
  const fromMoves = moves.map((move): ActivityEntry => ({
    id: `move:${move.id}`,
    at: move.at,
    kind: 'move',
    title: move.title,
    lines: move.lines,
  }));
  return [...trades, ...fromMoves].sort(byNewest).slice(0, limit);
}

const picks = (order: DraftOrder, refs: readonly PickRef[]) =>
  refs.length === 0 ? 'nothing' : refs.map((ref) => exactPickLabel(order, ref)).join(', ');

/** Every accepted trade, newest first. Offers still open or turned down stay private. */
export function leagueActivity(proposals: readonly PickTradeProposal[], order: DraftOrder): ActivityEntry[] {
  return proposals
    .filter((proposal) => proposal.status === 'accepted')
    .map((proposal): ActivityEntry => ({
      id: proposal.id,
      at: proposal.resolvedAt ?? proposal.createdAt,
      kind: 'trade',
      title: `${proposal.proposer} and ${proposal.recipient} traded`,
      lines: [
        `${proposal.proposer} gets ${picks(order, proposal.request)}.`,
        `${proposal.recipient} gets ${picks(order, proposal.offer)}.`,
      ],
    }))
    .sort(byNewest);
}
