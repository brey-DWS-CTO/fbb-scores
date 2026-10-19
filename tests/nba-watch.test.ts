import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AWARDS,
  awardBadges,
  depthSpots,
  nameKey,
  parseAwardMarkets,
  parseDepthChart,
} from '../src/lib/league/nbaWatch.ts';

const athlete = (id: string, name: string, injuries: unknown[] = []) => ({ id, displayName: name, injuries });

const portland = {
  team: { id: '22', abbreviation: 'POR', displayName: 'Portland Trail Blazers' },
  depthchart: [{
    positions: {
      pg: { athletes: [athlete('6606', 'Damian Lillard'), athlete('4279888', 'Ja Morant')] },
      sg: { athletes: [athlete('4279888', 'Ja Morant'), athlete('4683021', 'Shaedon Sharpe', [{ status: 'Out', shortComment: 'Torn meniscus.' }])] },
      sf: { athletes: [athlete('1', 'Toumani Camara')] },
      pf: { athletes: [] },
      c: { athletes: [athlete('2', 'Donovan Clingan'), { displayName: 'No id' }] },
    },
  }],
};

test('a depth chart keeps ESPN order, ids and injuries, and drops rows with no id', () => {
  const team = parseDepthChart(portland);
  assert.equal(team.abbrev, 'POR');
  assert.deepEqual(team.slots.PG.map((player) => player.name), ['Damian Lillard', 'Ja Morant']);
  assert.equal(team.slots.SG[1].injury?.status, 'Out');
  assert.equal(team.slots.SG[1].injury?.note, 'Torn meniscus.');
  assert.equal(team.slots.SG[0].injury, null);
  assert.deepEqual(team.slots.PF, []);
  assert.equal(team.slots.C.length, 1);
  assert.throws(() => parseDepthChart({ team: {} }), /depth chart/);
});

test('depth spots list every spot a player holds, starts first', () => {
  const spots = depthSpots([parseDepthChart(portland)]);
  assert.deepEqual(spots.get(nameKey('Ja Morant')), { abbrev: 'POR', spots: ['SG1', 'PG2'] });
  assert.deepEqual(spots.get(nameKey('Damian Lillard'))?.spots, ['PG1']);
});

const market = (name: string, bid: string, ask: string, event = 'KXNBAMIMP-27', status = 'active') => ({
  event_ticker: event, status, yes_sub_title: name, yes_bid_dollars: bid, yes_ask_dollars: ask,
});

test('award odds take the middle of bid and ask, or the bid when few have bet, and skip other seasons', () => {
  const rows = parseAwardMarkets({
    markets: [
      market('Matas Buzelis', '0.1000', '0.2000'),
      market('Brandon Miller', '0.1200', '0.3700'),
      market('Last Year Guy', '0.5000', '0.5200', 'KXNBAMIMP-26'),
      market('Nobody', '0.0000', '0.0100'),
      market('No Ask', '0.0500', '0.0000'),
      market('Settled', '0.4000', '0.4200', 'KXNBAMIMP-27', 'settled'),
      market('Tight', '0.0800', '0.0900'),
      market('Wide Open', '0.0100', '0.9500'),
      market('No Bid', '0.0000', '0.5000'),
    ],
  });
  // Wide spreads count the bid: a 1 to 95 spread is a 1% shot, not 48%.
  assert.deepEqual(rows.map((row) => row.name), ['Matas Buzelis', 'Brandon Miller', 'Tight', 'Wide Open']);
  assert.ok(Math.abs(rows[0].chance - 0.15) < 1e-9);
  assert.equal(rows[0].thin, false);
  assert.equal(rows[1].chance, 0.12);
  assert.equal(rows[1].thin, true);
  assert.ok(Math.abs(rows[2].chance - 0.085) < 1e-9);
  assert.equal(rows[2].thin, false);
  assert.throws(() => parseAwardMarkets({}), /Kalshi/);
});

test('names match across sources without accents, dots or suffixes', () => {
  assert.equal(nameKey('Nikola Jokić'), nameKey('Nikola Jokic'));
  assert.equal(nameKey('Jaren Jackson Jr.'), nameKey('Jaren Jackson'));
  assert.equal(nameKey("De'Aaron Fox"), nameKey('DeAaron Fox'));
  assert.equal(nameKey('P.J. Washington'), nameKey('PJ Washington'));
});

test('badges go to players at or over the bar, best chance first', () => {
  const mvp = AWARDS.find((award) => award.id === 'mvp')!;
  const dpoy = AWARDS.find((award) => award.id === 'dpoy')!;
  const badges = awardBadges([
    { award: mvp, rows: [{ name: 'Victor Wembanyama', chance: 0.32, bid: 0.32, ask: 0.33, thin: false }, { name: 'Long Shot', chance: 0.05, bid: 0.04, ask: 0.06, thin: false }] },
    { award: dpoy, rows: [{ name: 'Victor Wembanyama', chance: 0.72, bid: 0.69, ask: 0.75, thin: false }] },
  ]);
  assert.deepEqual(badges.get(nameKey('Victor Wembanyama'))?.map((badge) => badge.label), ['DPOY', 'MVP']);
  assert.equal(badges.has(nameKey('Long Shot')), false);
});
