import assert from 'node:assert/strict';
import test from 'node:test';
import { neonConfig } from '@neondatabase/serverless';

// Exercise the real Neon adapter and driver without connecting to a database.
// Unlike the file backend, PostgreSQL timestamps contain microseconds.
test('party writes preserve PostgreSQL timestamp precision and retry genuine conflicts', async (t) => {
  const originalUrl = process.env.DATABASE_URL;
  const originalFetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = 'postgresql://test:test@unit-test.invalid/league';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    neonConfig.fetchFunction = originalFetch;
  });
  let row: Record<string, unknown> = { guests: [] };
  let stamp = '2026-10-21 23:00:00.000+00';
  let writes = 0;
  let conflict = false;
  let missing = false;
  const preciseInstant = (value: string) => value.replace(' ', 'T').replace(/\.(\d+)(?:Z|\+00)$/, (_, fraction: string) => `.${fraction.padEnd(6, '0')}Z`);
  neonConfig.fetchFunction = async (_url, init) => {
    const { query, params } = JSON.parse(String(init?.body)) as { query: string; params: string[] };
    let fields: Array<{ name: string; dataTypeID: number }> = [];
    let rows: unknown[][] = [];
    if (query.includes('SELECT data, updated_at') && query.includes('FROM house_parties')) {
      fields = [{ name: 'data', dataTypeID: 3802 }, { name: 'updated_at', dataTypeID: query.includes('updated_at::text') ? 25 : 1184 }];
      if (!missing) rows = [[JSON.stringify(row), stamp]];
    } else if (query.includes('UPDATE house_parties')) {
      writes += 1;
      if (conflict) {
        conflict = false;
        row = { ...row, note: 'Someone else edited the party' };
        stamp = '2026-10-21 23:00:02.987654+00';
      } else if (preciseInstant(params[2]) === preciseInstant(stamp)) {
        row = JSON.parse(params[0]) as Record<string, unknown>;
        stamp = '2026-10-21 23:00:01.123456+00';
        fields = [{ name: 'id', dataTypeID: 25 }];
        rows = [['party']];
      }
    }
    return new Response(JSON.stringify({ fields, rows }), { status: 200 });
  };
  const { updateParty } = await import('../server/lib/leagueStore.ts');
  await updateParty('party', (current) => ({ ...current as object, guests: ['Bryan'] }));
  // This second RSVP used to fail all five attempts, even with no competing writer.
  const second = await updateParty('party', (current) => ({ ...current as object, guests: ['Bryan', 'Amy'] }));
  assert.deepEqual(second, { guests: ['Bryan', 'Amy'] });
  assert.equal(writes, 2);
  conflict = true;
  const rebased = await updateParty('party', (current) => ({ ...current as object, guests: ['Bryan', 'Amy', 'Kyle'] }));
  assert.deepEqual(rebased, { guests: ['Bryan', 'Amy', 'Kyle'], note: 'Someone else edited the party' });
  assert.equal(writes, 4, 'a genuine conflict retries once and preserves the other edit');
  missing = true;
  await assert.rejects(updateParty('missing', (current) => current), /No such party/);
});
