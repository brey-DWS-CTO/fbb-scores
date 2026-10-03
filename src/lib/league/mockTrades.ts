/**
 * Trades a person builds inside the mock draft without sending them. Each one
 * becomes a pending offer the what-if world can switch on, beside the real
 * pending offers. Nothing here reaches the server or anybody else.
 *
 * Pure. No server, no browser.
 */

import type { PickRef, PickTradeProposal } from '../keeper/types.js';
import type { MockSlot } from './mockDraft.js';

export interface MockTrade {
  id: string;
  /** The two teams, and the picks each one gives up. */
  teamA: string;
  teamB: string;
  aGives: PickRef[];
  bGives: PickRef[];
}

/** Ids of mock trades start with this, so they never collide with real offers. */
export const MOCK_TRADE_PREFIX = 'mock:';

export function isMockTradeId(id: string): boolean {
  return id.startsWith(MOCK_TRADE_PREFIX);
}

/** The picks a team holds on the board that it could still trade: not a keeper's, not made. */
export function tradablePicks(slots: readonly MockSlot[], owner: string): Array<{ ref: PickRef; label: string }> {
  return slots
    .filter((slot) => slot.pick.currentOwner === owner && !slot.keeper && !slot.made)
    .map((slot) => ({
      ref: { season: slot.pick.season, round: slot.pick.round, originalOwner: slot.pick.originalOwner },
      label: `${slot.pick.round}.${slot.pick.slot}`,
    }));
}

/** Why a trade cannot be added yet, or null when it can. */
export function mockTradeProblem(trade: Omit<MockTrade, 'id'>): string | null {
  if (!trade.teamA || !trade.teamB) return 'Pick two teams.';
  if (trade.teamA === trade.teamB) return 'Pick two different teams.';
  if (trade.aGives.length === 0 && trade.bGives.length === 0) return 'Tick at least one pick.';
  return null;
}

/** A mock trade as a pending offer, so the what-if world treats it like a real one. */
export function mockTradeProposal(trade: MockTrade, season: number): PickTradeProposal {
  return {
    id: trade.id,
    season,
    proposer: trade.teamA,
    recipient: trade.teamB,
    offer: trade.aGives.map((ref) => ({ ...ref })),
    request: trade.bGives.map((ref) => ({ ...ref })),
    note: '',
    status: 'pending',
    version: 1,
    createdAt: '2000-01-01T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

function parseRef(value: unknown): PickRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const ref = value as Record<string, unknown>;
  if (typeof ref.season !== 'number' || typeof ref.round !== 'number' || typeof ref.originalOwner !== 'string') return null;
  return { season: ref.season, round: ref.round, originalOwner: ref.originalOwner };
}

/** Mock trades read back from a save. Anything malformed is dropped. */
export function parseMockTrades(value: unknown): MockTrade[] {
  if (!Array.isArray(value)) return [];
  const trades: MockTrade[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const trade = entry as Record<string, unknown>;
    if (typeof trade.id !== 'string' || !isMockTradeId(trade.id)) continue;
    if (typeof trade.teamA !== 'string' || typeof trade.teamB !== 'string') continue;
    if (!Array.isArray(trade.aGives) || !Array.isArray(trade.bGives)) continue;
    const aGives = trade.aGives.map(parseRef);
    const bGives = trade.bGives.map(parseRef);
    if (aGives.includes(null) || bGives.includes(null)) continue;
    trades.push({ id: trade.id, teamA: trade.teamA, teamB: trade.teamB, aGives: aGives as PickRef[], bGives: bGives as PickRef[] });
  }
  return trades;
}
