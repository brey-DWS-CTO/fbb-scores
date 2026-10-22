import assert from 'node:assert/strict';
import test from 'node:test';
import { castCacheSeconds, castPollDelay, castSchedule } from '../src/lib/league/castPolling.js';
import type { NbaGame } from '../src/lib/league/houseParty.js';
import { getFantasyCast, forgetFantasyCast } from '../server/lib/fantasyCastService.js';
import { forgetBoxScores } from '../server/lib/boxScoreService.js';
import { forgetNbaSummaries, getNbaSummary } from '../server/lib/nbaSummaryService.js';

const base = Date.parse('2026-10-22T20:00:00Z');
const game = (state: NbaGame['state'], tipoff = base + 600_000): NbaGame => ({ id: '1', state, tipoff: new Date(tipoff).toISOString(), home: 'BOS', away: 'LAL', tv: null, detail: '', homeScore: null, awayScore: null });
const competitors = [{ homeAway: 'home', team: { abbreviation: 'BOS' } }, { homeAway: 'away', team: { abbreviation: 'LAL' } }];
const summary = (state: string) => ({ header: { competitions: [{ competitors, status: { type: { state } } }] }, plays: [{ id: '1', text: 'End of period' }] });

test('no recurring updates before tipoff, between games, on off days or after finals', () => {
  const before = castSchedule([game('pre')], base);
  assert.equal(before.phase, 'waiting');
  assert.equal(castPollDelay(before, base), 600_000);
  assert.equal(castPollDelay(before, base + 600_000), 1_000);
  assert.equal(castPollDelay(castSchedule([game('in')], base), base), 20_000);
  assert.equal(castPollDelay(castSchedule([game('post')], base), base), false);
  assert.equal(castPollDelay(castSchedule([], base), base), false);
  assert.equal(castSchedule([game('post'), game('pre')], base).phase, 'waiting');
  assert.equal(castPollDelay(castSchedule([{ ...game('pre'), detail: 'Postponed' }], base), base), false);
  assert.equal(castCacheSeconds(before, base), 600);
});

test('concurrent summary readers share a fetch and failed fetches can retry', async () => {
  const original = globalThis.fetch;
  forgetNbaSummaries();
  let reads = 0;
  globalThis.fetch = async () => { reads++; return new Response(JSON.stringify(summary('in'))); };
  try {
    await Promise.all(Array.from({ length: 30 }, () => getNbaSummary('shared', base)));
    assert.equal(reads, 1);
    await getNbaSummary('shared', base + 20_001);
    assert.equal(reads, 2);
    forgetNbaSummaries();
    globalThis.fetch = async () => { reads++; return new Response('', { status: 503 }); };
    await assert.rejects(getNbaSummary('failed', base));
    await assert.rejects(getNbaSummary('failed', base));
    assert.equal(reads, 4);
  } finally { globalThis.fetch = original; forgetNbaSummaries(); }
});

test('Cast and box scores share summaries; only live games are reread at the next tick', async context => {
  const original = globalThis.fetch;
  let now = base;
  context.mock.method(Date, 'now', () => now);
  forgetBoxScores(); forgetFantasyCast();
  let scoreboards = 0, liveReads = 0, finalReads = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('scoreboard')) {
      scoreboards++;
      return new Response(JSON.stringify({ events: ['in', 'post', 'pre'].map((state, index) => ({ id: `compute-${index}`, date: new Date(base + (state === 'pre' ? 600_000 : -60_000)).toISOString(), competitions: [{ competitors, status: { type: { state } } }] })) }));
    }
    if (url.includes('compute-0')) { liveReads++; return new Response(JSON.stringify(summary('in'))); }
    if (url.includes('compute-1')) { finalReads++; return new Response(JSON.stringify(summary('post'))); }
    throw new Error('Pregame play feed must never be fetched');
  };
  try {
    const initial = await Promise.all(Array.from({ length: 20 }, () => getFantasyCast('2026-11-01')));
    assert.equal(initial[0].error, null);
    assert.equal(liveReads, 1); assert.equal(finalReads, 1); assert.equal(scoreboards, 1);
    now += 21_000;
    await getFantasyCast('2026-11-01');
    assert.equal(liveReads, 2); assert.equal(finalReads, 1); assert.equal(scoreboards, 1);
  } finally { globalThis.fetch = original; forgetBoxScores(); forgetFantasyCast(); }
});

test('many readers before the first game cause one schedule lookup and zero summary fetches', async context => {
  const original = globalThis.fetch;
  context.mock.method(Date, 'now', () => base);
  forgetFantasyCast(); forgetBoxScores();
  let reads = 0;
  globalThis.fetch = async input => {
    assert.match(String(input), /scoreboard/); reads++;
    return new Response(JSON.stringify({ events: [{ id: 'waiting', date: new Date(base + 600_000).toISOString(), competitions: [{ competitors, status: { type: { state: 'pre' } } }] }] }));
  };
  try {
    const feed = await getFantasyCast('2026-11-02');
    assert.equal(feed.schedule?.phase, 'waiting');
    await Promise.all(Array.from({ length: 50 }, () => getFantasyCast('2026-11-02', base + 180_000)));
    assert.equal(reads, 1);
  } finally { globalThis.fetch = original; forgetBoxScores(); forgetFantasyCast(); }
});

test('scheduled tipoff expires the pregame scoreboard and starts the live feed', async context => {
  const original = globalThis.fetch;
  let now = base;
  context.mock.method(Date, 'now', () => now);
  forgetFantasyCast(); forgetBoxScores();
  let boards = 0, summaries = 0;
  globalThis.fetch = async input => {
    if (String(input).includes('scoreboard')) {
      boards++;
      return new Response(JSON.stringify({ events: [{ id: 'tipoff', date: new Date(base + 10_000).toISOString(), competitions: [{ competitors, status: { type: { state: now < base + 10_000 ? 'pre' : 'in' } } }] }] }));
    }
    summaries++; return new Response(JSON.stringify(summary('in')));
  };
  try {
    assert.equal((await getFantasyCast('2026-11-03')).schedule?.phase, 'waiting');
    assert.equal(summaries, 0);
    now += 10_000;
    assert.equal((await getFantasyCast('2026-11-03')).schedule?.phase, 'live');
    assert.equal(boards, 2); assert.equal(summaries, 1);
  } finally { globalThis.fetch = original; forgetBoxScores(); forgetFantasyCast(); }
});

test('final polling waits for the final summary, then shuts down', async context => {
  const original = globalThis.fetch;
  let now = base;
  context.mock.method(Date, 'now', () => now);
  forgetFantasyCast(); forgetBoxScores();
  let summaries = 0;
  globalThis.fetch = async input => {
    if (String(input).includes('scoreboard')) return new Response(JSON.stringify({ events: [{ id: 'finalizing', date: new Date(base - 60_000).toISOString(), competitions: [{ competitors, status: { type: { state: 'post' } } }] }] }));
    summaries++; return new Response(JSON.stringify(summary(summaries === 1 ? 'in' : 'post')));
  };
  try {
    const pending = await getFantasyCast('2026-11-04');
    assert.equal(castPollDelay(pending.schedule!, now), 20_000);
    now += 20_000;
    const final = await getFantasyCast('2026-11-04');
    assert.equal(final.schedule?.nextPollAt, null);
    assert.equal(summaries, 2);
    now += 60_000;
    await getFantasyCast('2026-11-04');
    assert.equal(summaries, 2);
  } finally { globalThis.fetch = original; forgetBoxScores(); forgetFantasyCast(); }
});
