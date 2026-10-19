/**
 * Commissioner utility: set favorite NBA teams for many owners at once.
 *   DATABASE_URL=... npx tsx scripts/seed-favorites.ts Amy=GSW Ryan=GSW Patrick=PHI,LAL
 *   DATABASE_URL=... npx tsx scripts/seed-favorites.ts            # list what is set
 * Without DATABASE_URL it writes the local .data/league-state.json file store.
 * Teams take any spelling the app knows: GSW, Warriors, "Golden State".
 */
import fs from 'node:fs';
import { cleanFavorites, FAVORITES_PROBLEM_WORDS } from '../src/lib/league/houseParty.js';

interface Row { owner: string; first: string; second: string | null; updatedAt: string }

function parse(args: string[]): Row[] {
  const at = new Date().toISOString();
  return args.map((arg) => {
    const [owner, teams = ''] = arg.split('=');
    const [first, second] = teams.split(',');
    const check = cleanFavorites({ first, second });
    if (!owner || !check.ok) {
      throw new Error(`${arg}: ${check.ok ? 'no owner' : FAVORITES_PROBLEM_WORDS[check.problem]}`);
    }
    return { owner, first: check.favorites.first, second: check.favorites.second, updatedAt: at };
  });
}

async function main() {
  const rows = parse(process.argv.slice(2));
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS favorite_teams (
      owner text primary key, first_team text not null, second_team text, updated_at timestamptz not null)`;
    for (const row of rows) {
      await sql`INSERT INTO favorite_teams (owner, first_team, second_team, updated_at)
        VALUES (${row.owner}, ${row.first}, ${row.second}, ${row.updatedAt})
        ON CONFLICT (owner) DO UPDATE SET first_team = EXCLUDED.first_team,
          second_team = EXCLUDED.second_team, updated_at = EXCLUDED.updated_at`;
    }
    const all = (await sql`SELECT owner, first_team, second_team FROM favorite_teams ORDER BY owner`) as Array<{
      owner: string; first_team: string; second_team: string | null;
    }>;
    console.log(all.length ? all.map((r) => `${r.owner}: ${r.first_team}${r.second_team ? `, ${r.second_team}` : ''}`).join('\n') : '(none set yet)');
  } else {
    const path = '.data/league-state.json';
    const doc = JSON.parse(fs.readFileSync(path, 'utf8')) as { favoriteTeams?: Row[] };
    const kept = (doc.favoriteTeams ?? []).filter((row) => !rows.some((next) => next.owner === row.owner));
    doc.favoriteTeams = [...kept, ...rows];
    fs.writeFileSync(path, JSON.stringify(doc, null, 2));
    console.log(doc.favoriteTeams.map((r) => `${r.owner}: ${r.first}${r.second ? `, ${r.second}` : ''}`).join('\n'));
  }
}

main().catch((e) => {
  console.error('ERR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
