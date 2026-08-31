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

export interface Rulebook {
  schemaVersion: number;
  season: number;
  revision: number;
  status: string;
  title: string;
  articles: RulebookArticle[];
  appendices: RulebookAppendix[];
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

/** The searchable text of an entry, with references already resolved. */
export function entryHaystack(entry: RulebookEntry, index: RulebookIndex): string {
  const parts = [entry.number, entry.title ?? '', entry.text ? resolveRefs(entry.text, index) : ''];
  if (entry.table) {
    parts.push(entry.table.columns.join(' '));
    entry.table.rows.forEach((row) => parts.push(row.join(' ')));
  }
  return parts.join(' ');
}

export interface RulebookSearchHit {
  entry: RulebookEntry;
  /** Ancestor numbers plus titles, so a bare clause still reads in context. */
  breadcrumb: string;
}

/**
 * Case-insensitive search over number, title, body, and table cells.
 * A query that looks like a rule number ("4.3.2") also matches by prefix, so
 * searching a number pulls up that rule and everything under it.
 */
export function searchRulebook(
  index: RulebookIndex,
  query: string,
): RulebookSearchHit[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];

  const numberish = /^[0-9]+(\.[0-9]+)*$/.test(term);

  return index.entries
    .filter((entry) => {
      if (entry.isArticle && !entry.text && !entry.table) {
        return entry.number.toLowerCase() === term || (entry.title ?? '').toLowerCase().includes(term);
      }
      if (numberish && (entry.number === term || entry.number.startsWith(`${term}.`))) return true;
      return entryHaystack(entry, index).toLowerCase().includes(term);
    })
    .map((entry) => ({ entry, breadcrumb: breadcrumbFor(entry, index) }));
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

/** Split text so a component can mark the matched run without dangerous HTML. */
export function highlight(text: string, query: string): TextSegment[] {
  const term = query.trim();
  if (!term) return [{ text, hit: false }];

  const segments: TextSegment[] = [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let cursor = 0;

  for (;;) {
    const at = lowerText.indexOf(lowerTerm, cursor);
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false });
    segments.push({ text: text.slice(at, at + term.length), hit: true });
    cursor = at + term.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments.length ? segments : [{ text, hit: false }];
}

/** Anchor id for a clause, used by `/rules#rule-<id>` deep links. */
export function anchorFor(id: string): string {
  return `rule-${id}`;
}
