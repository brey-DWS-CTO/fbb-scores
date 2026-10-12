/**
 * The front and back pages of the printed constitution.
 *
 * The printed book opens the way the Word file always did: the champion, a
 * letter from the commissioner, and the member table. It closes with a
 * signature page. The letter is typed by the commissioner; everything else is
 * counted from league data, because the typed member table drifted every year.
 *
 * Pure, so the PDF on the server and any preview in the browser agree.
 */

import { memberTotals, seasonsNewestFirst, type LeagueHistory } from './history.js';
import type { RulebookSignature } from './rulebookSignatures.js';

/** The line under LEAGUE RULES in every printed copy since revision 1. */
export const RULES_INTRO =
  'The following must be followed by all members of The Nerds Fantasy Basketball League.';

// ─── The letter ──────────────────────────────────────────────────────────────
//
// Plain text with four marks, enough for the letter and no more:
//   ## Heading            a bold heading line
//   - item / "  - item"   a bullet, two spaces deeper per level
//   **bold** and _italic_ inside any line
//   a blank line          ends a paragraph

export interface LetterRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type LetterBlock =
  | { kind: 'heading'; runs: LetterRun[] }
  | { kind: 'paragraph'; runs: LetterRun[] }
  | { kind: 'bullet'; depth: number; runs: LetterRun[] };

/** Split one line into bold, italic, and plain runs. */
export function inlineRuns(line: string): LetterRun[] {
  const runs: LetterRun[] = [];
  const pattern = /(\*\*([^*]+)\*\*|_([^_]+)_)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ text: line.slice(last, at), bold: false, italic: false });
    if (match[2] !== undefined) runs.push({ text: match[2], bold: true, italic: false });
    else runs.push({ text: match[3], bold: false, italic: true });
    last = at + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), bold: false, italic: false });
  return runs.length ? runs : [{ text: '', bold: false, italic: false }];
}

/** The letter as blocks a renderer can lay out. */
export function parseLetter(letter: string): LetterBlock[] {
  const blocks: LetterBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', runs: inlineRuns(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  for (const raw of letter.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const bullet = /^( *)[-*] +(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({
        kind: 'bullet',
        depth: Math.min(3, Math.floor(bullet[1].length / 2)),
        runs: inlineRuns(bullet[2]),
      });
      continue;
    }
    const heading = /^#{1,3} +(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', runs: inlineRuns(heading[1]) });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

// ─── The champion ────────────────────────────────────────────────────────────

export interface ChampionBlock {
  seasonLabel: string;
  champion: string;
  runnerUp: string | null;
  /** The champion's team name, when the league config knows it. */
  team: string | null;
}

export interface TeamName {
  owner: string;
  fullName: string;
  espnTeamName?: string;
  draftPosition: number;
  originalMember?: boolean;
}

/** Last season's winner and runner-up, read from league history. */
export function championBlock(history: LeagueHistory, teams: TeamName[]): ChampionBlock | null {
  const season = seasonsNewestFirst(history).find((s) =>
    s.placements.some((p) => p.placement === 1),
  );
  if (!season) return null;
  const first = season.placements.find((p) => p.placement === 1);
  const second = season.placements.find((p) => p.placement === 2);
  if (!first) return null;
  const franchise = history.franchises.find((f) => f.id === first.franchiseId);
  const team = franchise?.currentOwnerKey
    ? (teams.find((t) => t.owner === franchise.currentOwnerKey)?.espnTeamName ?? null)
    : null;
  return {
    seasonLabel: season.label,
    champion: first.ownerName,
    runnerUp: second?.ownerName ?? null,
    team,
  };
}

// ─── The member table ────────────────────────────────────────────────────────

export interface MemberRow {
  owner: string;
  /** Full name, with the original-member asterisk already on it. */
  name: string;
  titles: number;
  runnerUps: number;
}

/** Every member in draft order, titles counted from history, never typed. */
export function memberRows(history: LeagueHistory, teams: TeamName[]): MemberRow[] {
  const totals = new Map(memberTotals(history).map((row) => [row.currentOwnerKey, row]));
  return [...teams]
    .sort((a, b) => a.draftPosition - b.draftPosition)
    .map((team) => {
      const row = totals.get(team.owner);
      return {
        owner: team.owner,
        name: team.originalMember ? `${team.fullName}*` : team.fullName,
        titles: row?.titles ?? 0,
        runnerUps: row?.runnerUps ?? 0,
      };
    });
}

// ─── The signature page ──────────────────────────────────────────────────────

export interface SignatureRow {
  owner: string;
  name: string;
  signedAt: string | null;
  /** A hand-drawn signature as a PNG data URL, when they drew one. */
  drawing: string | null;
}

/** One line per member in draft order: signed, with the date, or still blank. */
export function signatureRows(
  teams: TeamName[],
  signatures: RulebookSignature[],
  versionId: string | null,
): SignatureRow[] {
  const byOwner = new Map(
    signatures.filter((s) => versionId !== null && s.versionId === versionId).map((s) => [s.owner, s]),
  );
  return [...teams]
    .sort((a, b) => a.draftPosition - b.draftPosition)
    .map((team) => ({
      owner: team.owner,
      name: team.fullName,
      signedAt: byOwner.get(team.owner)?.signedAt ?? null,
      drawing: byOwner.get(team.owner)?.drawing ?? null,
    }));
}

// ─── Dates and names ─────────────────────────────────────────────────────────

/** 10/5/25, the way the top corner of every page always read. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

/** October 5, 2025, for the signature page. */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The file name a download gets. */
export function pdfFileName(season: number, revision: number, copyFor?: string | null): string {
  const base = `The Nerds Constitution ${season} rev ${revision}`;
  return copyFor ? `${base} - ${copyFor}.pdf` : `${base}.pdf`;
}
