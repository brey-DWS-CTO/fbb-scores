/**
 * Mock trades: an offer you build on the trade page and keep for yourself.
 * It never reaches the other owner and sends no email. The mock draft treats
 * it like one of your pending offers, so you can draft off it, alone or
 * beside the offers you really sent. SEND FOR REAL turns it into one.
 *
 * Pure. No server, no browser.
 */
import type { PickRef, PickTradeProposal } from '../keeper/types.js';
import { MAX_PICKS_PER_SIDE, MAX_TRADE_NOTE } from './pickTrades.js';

export interface MockTrade {
  /** Starts with `mock:`, so it never matches a real offer. */
  id: string;
  season: number;
  /** Who built it. Only they ever see it. */
  owner: string;
  recipient: string;
  offer: PickRef[];
  request: PickRef[];
  note: string;
  createdAt: string;
}

/** Most mock trades one owner keeps, so the list stays readable. */
export const MAX_MOCK_TRADES = 20;

export const MOCK_TRADE_PREFIX = 'mock:';

export function isMockTradeId(id: string): boolean {
  return id.startsWith(MOCK_TRADE_PREFIX);
}

export function mockTradeId(owner: string, at: string): string {
  return `${MOCK_TRADE_PREFIX}${owner.toLowerCase()}-${at.replace(/[-:.TZ]/g, '')}`;
}

/** A mock trade as a pending offer, so the mock draft's what-if board can switch it on. */
export function mockTradeProposal(trade: MockTrade): PickTradeProposal {
  return {
    id: trade.id,
    season: trade.season,
    proposer: trade.owner,
    recipient: trade.recipient,
    offer: trade.offer.map((ref) => ({ ...ref })),
    request: trade.request.map((ref) => ({ ...ref })),
    note: trade.note,
    status: 'pending',
    version: 1,
    createdAt: trade.createdAt,
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

function parseRef(value: unknown): PickRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const ref = value as Record<string, unknown>;
  if (typeof ref.season !== 'number' || typeof ref.round !== 'number' || typeof ref.originalOwner !== 'string') return null;
  return { season: ref.season, round: ref.round, originalOwner: ref.originalOwner };
}

function parseRefs(value: unknown): PickRef[] | null {
  if (!Array.isArray(value) || value.length > MAX_PICKS_PER_SIDE) return null;
  const refs = value.map(parseRef);
  return refs.includes(null) ? null : refs as PickRef[];
}

/** A stored mock trade read back, or null when it is not one. */
export function parseMockTrade(value: unknown): MockTrade | null {
  if (typeof value !== 'object' || value === null) return null;
  const trade = value as Record<string, unknown>;
  if (typeof trade.id !== 'string' || !isMockTradeId(trade.id)) return null;
  if (typeof trade.season !== 'number' || typeof trade.owner !== 'string' || typeof trade.recipient !== 'string') return null;
  const offer = parseRefs(trade.offer);
  const request = parseRefs(trade.request);
  if (!offer || !request) return null;
  return {
    id: trade.id,
    season: trade.season,
    owner: trade.owner,
    recipient: trade.recipient,
    offer,
    request,
    note: typeof trade.note === 'string' ? trade.note.slice(0, MAX_TRADE_NOTE) : '',
    createdAt: typeof trade.createdAt === 'string' ? trade.createdAt : new Date(0).toISOString(),
  };
}
