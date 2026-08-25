/**
 * Commissioner utility: read or set team PINs directly in the database.
 *   DATABASE_URL=... npx tsx scripts/admin-pins.ts            # list pins
 *   DATABASE_URL=... npx tsx scripts/admin-pins.ts Brey 4321  # set a pin
 * Without DATABASE_URL it reads the local .data/league-state.json file store.
 */
import fs from 'node:fs';

async function main() {
  const [owner, pin] = process.argv.slice(2);
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    if (owner && pin) {
      await sql`insert into pins (owner, pin) values (${owner}, ${pin})
                on conflict (owner) do update set pin = ${pin}`;
      console.log(`Set ${owner} -> ${pin}`);
    }
    const rows = (await sql`select owner, pin from pins order by owner`) as Array<{ owner: string; pin: string }>;
    console.log(rows.length ? rows.map((r) => `${r.owner}: ${r.pin}`).join('\n') : '(no pins seeded yet)');
  } else {
    const raw = JSON.parse(fs.readFileSync('.data/league-state.json', 'utf8'));
    console.log(JSON.stringify(raw.pins ?? {}, null, 2));
  }
}
main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
