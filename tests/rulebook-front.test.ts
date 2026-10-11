import assert from 'node:assert/strict';
import test from 'node:test';
import rawHistory from '../src/data/source/league-history-2027.json' with { type: 'json' };
import rawConfig from '../src/data/source/league-2027-config.json' with { type: 'json' };
import rawRulebook from '../src/data/source/rulebook-2027.json' with { type: 'json' };
import type { LeagueHistory } from '../src/lib/league/history.ts';
import type { Rulebook } from '../src/lib/league/rulebook.ts';
import { rulebookFingerprint } from '../src/lib/league/rulebookDiff.ts';
import {
  championBlock,
  inlineRuns,
  memberRows,
  parseLetter,
  pdfFileName,
  shortDate,
  signatureRows,
  type TeamName,
} from '../src/lib/league/rulebookFront.ts';
import type { RulebookSignature } from '../src/lib/league/rulebookSignatures.ts';

const history = rawHistory as unknown as LeagueHistory;
const teams = rawConfig.teams as TeamName[];
const seed = rawRulebook as unknown as Rulebook;

// ─── The letter ──────────────────────────────────────────────────────────────

test('a blank line ends a paragraph and single newlines join one', () => {
  const blocks = parseLetter('First line\nstill first.\n\nSecond.');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.equal(blocks[0].runs.map((r) => r.text).join(''), 'First line still first.');
  assert.equal(blocks[1].runs[0].text, 'Second.');
});

test('headings and nested bullets come out with their depth', () => {
  const blocks = parseLetter('## Changes\n- one\n  - one point one\n    - deeper\n- two');
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.kind === 'bullet' ? b.depth : null]),
    [
      ['heading', null],
      ['bullet', 0],
      ['bullet', 1],
      ['bullet', 2],
      ['bullet', 0],
    ],
  );
});

test('bold and italic marks become runs and plain text stays plain', () => {
  assert.deepEqual(inlineRuns('Say **this** and _that_, then stop.'), [
    { text: 'Say ', bold: false, italic: false },
    { text: 'this', bold: true, italic: false },
    { text: ' and ', bold: false, italic: false },
    { text: 'that', bold: false, italic: true },
    { text: ', then stop.', bold: false, italic: false },
  ]);
  assert.deepEqual(inlineRuns('plain'), [{ text: 'plain', bold: false, italic: false }]);
});

test('Windows line endings and trailing spaces do not matter', () => {
  const a = parseLetter('A  \r\n\r\nB');
  const b = parseLetter('A\n\nB');
  assert.deepEqual(a, b);
});

test('the seed letter is the 2027 one, not the 2026 copy that came with the import', () => {
  assert.ok(seed.frontMatter, 'the seed carries a front page');
  assert.match(seed.frontMatter.letter, /YEAR 17/);
  assert.match(seed.frontMatter.letter, /October 18, 2026/);
  assert.doesNotMatch(seed.frontMatter.letter, /YEAR 16|Aaron to the 3-time/);
  assert.doesNotMatch(seed.frontMatter.letter, /—/, 'no em dashes in league copy');
  assert.ok(parseLetter(seed.frontMatter.letter).length > 5);
});

// ─── Counted, never typed ────────────────────────────────────────────────────

test("last season's champion comes from history, with the runner-up", () => {
  const champ = championBlock(history, teams);
  assert.ok(champ);
  assert.equal(champ.seasonLabel, '2025-2026');
  assert.equal(champ.champion, 'Amy Shaug');
  assert.equal(champ.runnerUp, 'Brey Funkhouser');
  assert.equal(champ.team, 'Tu Mamacita');
});

test('the member table is in draft order and marks original members', () => {
  const rows = memberRows(history, teams);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].owner, 'Joel');
  assert.equal(rows[9].owner, 'Amy');
  assert.equal(rows[9].name, 'Amy Shaug*');
  assert.equal(rows[9].titles, 4);
  assert.equal(rows[0].name, 'Joel Weigle');
  assert.equal(rows[0].titles, 0);
  const bryan = rows.find((r) => r.owner === 'Bryan');
  assert.ok(bryan);
  assert.equal(bryan.runnerUps, 4, "Bryan's finishes follow him to the team he took over");
});

test('a signature page has one line per member, dated only when signed', () => {
  const signatures: RulebookSignature[] = [
    {
      season: 2027,
      versionId: 'rb-1',
      revision: 14,
      fingerprint: 'x',
      owner: 'Joel',
      acknowledgement: 'ok',
      signedAt: '2026-10-12T01:00:00Z',
    },
    {
      season: 2027,
      versionId: 'rb-0',
      revision: 13,
      fingerprint: 'y',
      owner: 'Amy',
      acknowledgement: 'ok',
      signedAt: '2026-10-01T01:00:00Z',
    },
  ];
  const rows = signatureRows(teams, signatures, 'rb-1');
  assert.equal(rows.length, 10);
  assert.equal(rows[0].name, 'Joel Weigle');
  assert.equal(rows[0].signedAt, '2026-10-12T01:00:00Z');
  assert.equal(rows.find((r) => r.owner === 'Amy')?.signedAt, null, 'an old revision does not count');
  assert.ok(signatureRows(teams, signatures, null).every((r) => r.signedAt === null));
});

// ─── Small things the page corner and the download depend on ────────────────

test('dates and file names read the way the paper copy always did', () => {
  assert.equal(shortDate('2025-10-05T12:00:00'), '10/5/25');
  assert.equal(pdfFileName(2027, 14), 'The Nerds Constitution 2027 rev 14.pdf');
  assert.equal(pdfFileName(2027, 14, 'Joel Weigle'), 'The Nerds Constitution 2027 rev 14 - Joel Weigle.pdf');
});

test('editing the letter changes the fingerprint, because it prints and gets signed', () => {
  const before = rulebookFingerprint(seed);
  const edited = structuredClone(seed);
  edited.frontMatter = { writtenBy: edited.frontMatter?.writtenBy ?? '', letter: 'Something new.' };
  assert.notEqual(rulebookFingerprint(edited), before);
});
