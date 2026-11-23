import assert from 'node:assert/strict';
import test from 'node:test';
import { NeonBackend } from '../server/lib/leagueStore.js';

test('Postgres poll writes preserve microseconds and retry a real conflict without losing ballots', async () => {
  const backend = new NeonBackend('postgresql://test:test@localhost/test');
  const initial = '2026-11-23 12:34:56.123456+00';
  const concurrent = '2026-11-23 12:34:56.654321+00';
  let timestamp = initial;
  let data = { votes: ['Amy'] };
  let writes = 0;
  // Exercise the production backend with SQL I/O replaced, not the local JSON store.
  const internals = backend as unknown as {
    initPromise: Promise<void>;
    sql: (parts: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  };
  internals.initPromise = Promise.resolve();
  internals.sql = async (parts, ...values) => {
    const query = parts.join('?');
    if (query.startsWith('SELECT')) {
      assert.match(query, /updated_at::text/);
      return [{ data: structuredClone(data), updated_at: timestamp }];
    }
    assert.match(query, /^UPDATE polls/);
    writes++;
    assert.equal(values[2], timestamp, 'compare using the full database timestamp');
    if (writes === 1) {
      data = { votes: ['Amy', 'Joel'] };
      timestamp = concurrent;
      return []; // Another voter wrote after the read.
    }
    data = JSON.parse(values[0] as string);
    return [{ id: 'p1' }];
  };
  const result = await backend.updatePoll('p1', (current) => ({
    votes: [...(current as typeof data).votes, 'Ryan'],
  }));
  assert.deepEqual(result, { votes: ['Amy', 'Joel', 'Ryan'] });
  assert.equal(writes, 2);
});
