import assert from 'node:assert/strict';
import test from 'node:test';
import { isMockTradeId, mockTradeId, mockTradeProposal, parseMockTrade, type MockTrade } from '../src/lib/league/mockTrades.ts';

const trade: MockTrade = {
  id: mockTradeId('Brey', '2026-10-14T18:00:00.000Z'),
  season: 2027,
  owner: 'Brey',
  recipient: 'Dustin',
  offer: [{ season: 2027, round: 2, originalOwner: 'Brey' }],
  request: [{ season: 2027, round: 2, originalOwner: 'Dustin' }],
  note: 'just looking',
  createdAt: '2026-10-14T18:00:00.000Z',
};

test('a mock trade has its own id and reads back; junk does not', () => {
  assert.ok(isMockTradeId(trade.id));
  assert.ok(!isMockTradeId('trade-2027-brey-1'));
  assert.deepEqual(parseMockTrade(JSON.parse(JSON.stringify(trade))), trade);
  assert.equal(parseMockTrade({ ...trade, id: 'trade-2027-brey-1' }), null);
  assert.equal(parseMockTrade({ ...trade, offer: [{ round: 'x' }] }), null);
  assert.equal(parseMockTrade(null), null);
});

test('as an offer it is pending, never runs out, and the builder proposes it', () => {
  const proposal = mockTradeProposal(trade);
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.proposer, 'Brey');
  assert.equal(proposal.recipient, 'Dustin');
  assert.ok(proposal.expiresAt > '2900');
  assert.deepEqual(proposal.offer, trade.offer);
});
