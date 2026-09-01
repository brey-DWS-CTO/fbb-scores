/**
 * Rulebook numbering, cross-reference resolution, and search.
 *
 * Clause numbers are never stored. Every clause carries a stable slug id and its
 * displayed number is derived from where it sits in the tree, so adding, moving,
 * or deleting a clause renumbers the whole book correctly. Cross-references are
 * stored as `{{ref:some.clause.id}}` and resolve to the current number on every
 * render, which is why a reference cannot go stale.
 *
 * `scripts/render-rulebook.mjs` is the plain-text twin of this module. Keep them
 * in step.
 */

export interface RulebookTable {
  columns: string[];
  rows: string[][];
}

export interface RulebookClause {
  id: string;
  title?: string;
  text?: string;
  kind?: 'example' | 'table' | 'placeholder';
  legacyNumber?: string;
  note?: string;
  status?: string;
  table?: RulebookTable;
  settings?: string[];
  voteThreshold?: number;
  children?: RulebookClause[];
}

export interface RulebookArticle {
  id: string;
  title: string;
  legacyTitle?: string;
  clauses: RulebookClause[];
}

export interface RulebookAppendix {
  id: string;
  label: string;
  title: string;
  kind?: string;
  note?: string;
  table?: RulebookTable;
}

export interface HighScoreEntry {
  owner: string;
  season: number;
  week: number | null;
  total: number;
  source: string;
  verified?: boolean;
  /** No longer in the league; shown with an asterisk, as the book does. */
  former?: boolean;
  note?: string;
}

export interface ChampionEntry {
  season: number;
  year: string;
  champion: string | null;
  runnerUp: string | null;
  source: string;
  note?: string;
}

export interface RulebookRecords {
  highScores: {
    criteria: string;
    scoreBasis?: string;
    scoreBasisNote?: string;
    complete: boolean;
    note?: string;
    entries: HighScoreEntry[];
  };
  champions: { complete: boolean; entries: ChampionEntry[] };
  formerMembers: string[];
}

export interface Rulebook {
  schemaVersion: number;
  season: number;
  revision: number;
  status: string;
  title: string;
  articles: RulebookArticle[];
  appendices: RulebookAppendix[];
  records: RulebookRecords;
}

/** One addressable line of the book, with its number worked out from position. */
export interface RulebookEntry {
  id: string;
  number: string;
  /** Nesting depth: 0 for an article, 1 for `1.1`, 2 for `1.1.1`. */
  depth: number;
  articleId: string;
  articleTitle: string;
  title?: string;
  text?: string;
  kind?: RulebookClause['kind'];
  table?: RulebookTable;
  legacyNumber?: string;
  note?: string;
  settings?: string[];
  isArticle: boolean;
}

export interface RulebookIndex {
  /** Every article and clause in reading order. */
  entries: RulebookEntry[];
  byId: Map<string, RulebookEntry>;
}

const REF_PATTERN = /\{\{ref:([^}]+)\}\}/g;

/** Walk the book once, assigning each article and clause its derived number. */
export function buildRulebookIndex(book: Rulebook): RulebookIndex {
  const entries: RulebookEntry[] = [];
  const byId = new Map<string, RulebookEntry>();

  const push = (entry: RulebookEntry) => {
    entries.push(entry);
    byId.set(entry.id, entry);
  };

  book.articles.forEach((article, articleIdx) => {
    const articleNumber = String(articleIdx + 1);
    push({
      id: article.id,
      number: articleNumber,
      depth: 0,
      articleId: article.id,
      articleTitle: article.title,
      title: article.title,
      isArticle: true,
    });

    const walk = (clauses: RulebookClause[], prefix: string) => {
      clauses.forEach((clause, idx) => {
        const number = `${prefix}.${idx + 1}`;
        push({
          id: clause.id,
          number,
          depth: number.split('.').length - 1,
          articleId: article.id,
          articleTitle: article.title,
          title: clause.title,
          text: clause.text,
          kind: clause.kind,
          table: clause.table,
          legacyNumber: clause.legacyNumber,
          note: clause.note,
          settings: clause.settings,
          isArticle: false,
        });
        if (clause.children) walk(clause.children, number);
      });
    };

    walk(article.clauses, articleNumber);
  });

  book.appendices.forEach((appendix) => {
    push({
      id: appendix.id,
      number: appendix.label,
      depth: 0,
      articleId: appendix.id,
      articleTitle: appendix.title,
      title: appendix.title,
      note: appendix.note,
      table: appendix.table,
      kind: appendix.table ? 'table' : undefined,
      isArticle: true,
    });
  });

  return { entries, byId };
}

/**
 * Replace every `{{ref:id}}` token with the target's current number and title.
 * An unknown id renders visibly rather than silently vanishing.
 */
export function resolveRefs(text: string, index: RulebookIndex): string {
  return text.replace(REF_PATTERN, (_match, id: string) => {
    const target = index.byId.get(id);
    if (!target) return `[missing rule: ${id}]`;
    return target.title ? `${target.number} ${target.title}` : target.number;
  });
}

/** Every clause id a piece of text points at, for warning before a delete. */
export function refsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(REF_PATTERN)) found.push(match[1]);
  return found;
}

/** Ids that reference `id`. Phase 2 uses this to warn before deleting a clause. */
export function referrersOf(book: Rulebook, id: string): string[] {
  const hits: string[] = [];
  const check = (clause: RulebookClause) => {
    if (clause.text && refsIn(clause.text).includes(id)) hits.push(clause.id);
    clause.children?.forEach(check);
  };
  book.articles.forEach((article) => article.clauses.forEach(check));
  return hits;
}

/** The parts of an entry a search reads, kept apart so a title can outrank a body. */
interface EntryText {
  /** The title alone. A word here says the rule is about that word. */
  title: string;
  /** Body text with references resolved, plus any note and table cells. */
  body: string;
}

function entryText(entry: RulebookEntry, index: RulebookIndex): EntryText {
  const body: string[] = [];
  if (entry.text) body.push(resolveRefs(entry.text, index));
  if (entry.note) body.push(entry.note);
  if (entry.table) {
    body.push(entry.table.columns.join(' '));
    entry.table.rows.forEach((row) => body.push(row.join(' ')));
  }
  return { title: entry.title ?? '', body: body.join(' ') };
}

/** The searchable text of an entry, with references already resolved. */
export function entryHaystack(entry: RulebookEntry, index: RulebookIndex): string {
  const { title, body } = entryText(entry, index);
  return [entry.number, title, body].join(' ');
}

/**
 * Filler words that sit in nearly every clause. A query made only of these
 * finds nothing rather than the whole book. The list stays short on purpose:
 * words that carry rule meaning, like "not" or "must", are never dropped.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'has', 'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'their', 'this', 'to', 'was', 'were', 'with',
]);

/** A word, or a rule number like `4.3.2` held together as one word. */
const WORD_PATTERN = /[a-z0-9]+(?:\.[0-9]+)*/g;
const NUMBERISH = /^[0-9]+(\.[0-9]+)*$/;

/**
 * The words a query asks for, lowercased, deduped, filler removed.
 * Exported because both search and highlighting must agree on them.
 */
export function queryWords(query: string): string[] {
  const found = query.toLowerCase().match(WORD_PATTERN) ?? [];
  return [...new Set(found.filter((word) => !STOP_WORDS.has(word)))];
}

/**
 * A word matches where a word in the text starts with it, so "cap" finds "cap"
 * and "capped" but not "handicap". Matching from the start is what makes a
 * half-typed word useful without dragging in every word that merely contains it.
 */
function wordStart(word: string, flags: string): RegExp {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, flags);
}

// Weights, best first. They are plain numbers so a hit's score can be read back
// and explained. Nothing here learns or guesses.
const SCORE_NUMBER_EXACT = 1000;
const SCORE_NUMBER_PREFIX = 500;
const SCORE_TITLE_WORD = 100;
const SCORE_BODY_WORD = 10;

/** One query word, with its matcher built once for the whole search. */
interface QueryWord {
  word: string;
  isNumber: boolean;
  match: RegExp;
}

/** How well one entry answers the query. 0 means at least one word is missing. */
function scoreEntry(entry: RulebookEntry, text: EntryText, words: QueryWord[]): number {
  let score = 0;
  for (const { word, isNumber, match } of words) {
    let best = 0;
    if (isNumber) {
      if (entry.number === word) best = SCORE_NUMBER_EXACT;
      else if (entry.number.startsWith(`${word}.`)) best = SCORE_NUMBER_PREFIX;
      else if (match.test(text.title)) best = SCORE_TITLE_WORD;
      else if (match.test(text.body)) best = SCORE_BODY_WORD;
      // The number carries the label of an appendix, which reads as its title.
    } else if (match.test(entry.number) || match.test(text.title)) {
      best = SCORE_TITLE_WORD;
    } else if (match.test(text.body)) {
      best = SCORE_BODY_WORD;
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}

export interface RulebookSearchHit {
  entry: RulebookEntry;
  /** Ancestor numbers plus titles, so a bare clause still reads in context. */
  breadcrumb: string;
  /** Why it sits where it sits. Higher is a better answer to the query. */
  score: number;
}

/**
 * Search the book by words, in any order.
 *
 * Every word of the query must appear somewhere in the entry, so "keeper cap"
 * and "cap keeper" both find 4.3 Keeper Salary Cap while neither drags in every
 * rule that says "cap". A word that looks like a rule number also matches that
 * rule and everything nested under it, so typing 4.3 still opens the branch.
 *
 * Results come back best first: an exact rule number, then rules whose title
 * holds more of the words, then rules that only mention them in the body.
 * Entries that tie keep book order.
 */
export function searchRulebook(
  index: RulebookIndex,
  query: string,
): RulebookSearchHit[] {
  const words: QueryWord[] = queryWords(query).map((word) => ({
    word,
    isNumber: NUMBERISH.test(word),
    match: wordStart(word, 'i'),
  }));
  if (!words.length) return [];

  const scored: Array<{ hit: RulebookSearchHit; at: number }> = [];
  index.entries.forEach((entry, at) => {
    const score = scoreEntry(entry, entryText(entry, index), words);
    if (!score) return;
    scored.push({ hit: { entry, breadcrumb: breadcrumbFor(entry, index), score }, at });
  });

  return scored.sort((a, b) => b.hit.score - a.hit.score || a.at - b.at).map((row) => row.hit);
}

/** "4 Keeper Rules › 4.3 Keeper Salary Cap" for a nested clause. */
export function breadcrumbFor(entry: RulebookEntry, index: RulebookIndex): string {
  const parts = entry.number.split('.');
  const trail: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const ancestor = index.entries.find((e) => e.number === parts.slice(0, i).join('.'));
    if (ancestor?.title) trail.push(`${ancestor.number} ${ancestor.title}`);
  }
  return trail.join(' › ');
}

export interface TextSegment {
  text: string;
  hit: boolean;
}

/**
 * Split text so a component can mark the matched words without dangerous HTML.
 *
 * Every word of the query gets marked, not just the first, because search only
 * returns an entry when all of them match. Runs that touch or overlap merge, so
 * "keeper cap" on "Keeper Salary Cap" marks two runs and never nests them.
 */
export function highlight(text: string, query: string): TextSegment[] {
  const words = queryWords(query);
  if (!words.length) return [{ text, hit: false }];

  const spans: Array<[number, number]> = [];
  for (const word of words) {
    for (const match of text.matchAll(wordStart(word, 'gi'))) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  if (!spans.length) return [{ text, hit: false }];
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const segments: TextSegment[] = [];
  let cursor = 0;
  let start = spans[0][0];
  let end = spans[0][1];
  const flush = () => {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  };

  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i][0] <= end) {
      end = Math.max(end, spans[i][1]);
      continue;
    }
    flush();
    start = spans[i][0];
    end = spans[i][1];
  }
  flush();

  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

/** Anchor id for a clause, used by `/rules#rule-<id>` deep links. */
export function anchorFor(id: string): string {
  return `rule-${id}`;
}

export interface RulebookSection {
  /** The article or appendix heading. */
  heading: RulebookEntry;
  /** Everything filed under it, in reading order. */
  clauses: RulebookEntry[];
}

/** Split the flat index into collapsible sections, one per article or appendix. */
export function groupByArticle(index: RulebookIndex): RulebookSection[] {
  const sections: RulebookSection[] = [];
  for (const entry of index.entries) {
    if (entry.isArticle) sections.push({ heading: entry, clauses: [] });
    else sections[sections.length - 1]?.clauses.push(entry);
  }
  return sections;
}

/** The article or appendix a clause belongs to, so a deep link can open it. */
export function sectionIdFor(id: string, index: RulebookIndex): string | undefined {
  return index.byId.get(id)?.articleId;
}

export interface RankedHighScore extends HighScoreEntry {
  rank: number;
}

/**
 * High scores ranked by total, highest first. Rank is never stored, which is
 * how the docx ended up listing Eric's 1241.6 above Aaron's 1243.0. Equal
 * totals share a rank, and the next rank skips accordingly.
 */
export function rankedHighScores(entries: HighScoreEntry[]): RankedHighScore[] {
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  let lastTotal = Number.NaN;
  let lastRank = 0;
  return sorted.map((entry, i) => {
    const rank = entry.total === lastTotal ? lastRank : i + 1;
    lastTotal = entry.total;
    lastRank = rank;
    return { ...entry, rank };
  });
}

/** "S14W8", or "S14W?" where the source never recorded the week. */
export function formatHighScoreWhen(entry: HighScoreEntry): string {
  return `S${entry.season}W${entry.week ?? '?'}`;
}
