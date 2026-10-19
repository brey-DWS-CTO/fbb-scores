/**
 * The league's activity log for LEAGUE HQ: what happened, newest first, that
 * every member may see. Today that is every pick trade that went through.
 *
 * Pure. No server, no browser.
 */
import type { PickRef, PickTradeProposal } from '../keeper/types.js';
import { exactPickLabel, type DraftOrder } from './pickTrades.js';

export interface ActivityEntry {
  id: string;
  /** When it happened, ISO. */
  at: string;
  kind: 'trade';
  title: string;
  lines: string[];
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
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
