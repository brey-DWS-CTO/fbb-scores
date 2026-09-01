/**
 * Pure tree edits for the rulebook draft.
 *
 * Every function takes a book and returns a NEW book, leaving the input alone.
 * Nothing here touches numbering: numbers come from position, so moving a
 * clause renumbers the book for free. Nothing here talks to the network
 * either, which is what makes the whole editor testable without a server.
 *
 * Articles and clauses are edited through the same operations. An article's
 * children live in `clauses`, a clause's in `children`; `childrenOf` hides
 * that difference.
 */

import type { Rulebook, RulebookArticle, RulebookClause } from './rulebook.js';

export type EditableNode = RulebookArticle | RulebookClause;

export type MoveDirection = 'up' | 'down' | 'promote' | 'demote';
export type InsertPosition = 'before' | 'after' | 'child';

export class RulebookEditError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RulebookEditError';
  }
}

const fail = (code: string, message: string): never => {
  throw new RulebookEditError(code, message);
};

function isArticle(node: EditableNode): node is RulebookArticle {
  return Array.isArray((node as RulebookArticle).clauses);
}

/** The child list of an article or clause, or undefined when it has none. */
export function childrenOf(node: EditableNode): EditableNode[] | undefined {
  return isArticle(node) ? node.clauses : (node as RulebookClause).children;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Locating ────────────────────────────────────────────────────────────────

export interface NodeLocation {
  node: EditableNode;
  /** The array the node sits in. */
  siblings: EditableNode[];
  index: number;
  /** Undefined for an article, which sits at the top level. */
  parent?: EditableNode;
  /** Article, then each ancestor clause, outermost first. */
  ancestors: EditableNode[];
  isArticle: boolean;
}

/** Find a node by id, along with everything needed to move or remove it. */
export function locate(book: Rulebook, id: string): NodeLocation | undefined {
  for (let i = 0; i < book.articles.length; i += 1) {
    const article = book.articles[i];
    if (article.id === id) {
      return {
        node: article,
        siblings: book.articles,
        index: i,
        ancestors: [],
        isArticle: true,
      };
    }
    const found = locateIn(article.clauses, article, [article], id);
    if (found) return found;
  }
  return undefined;
}

function locateIn(
  siblings: EditableNode[],
  parent: EditableNode,
  ancestors: EditableNode[],
  id: string,
): NodeLocation | undefined {
  for (let i = 0; i < siblings.length; i += 1) {
    const node = siblings[i];
    if (node.id === id) {
      return { node, siblings, index: i, parent, ancestors, isArticle: false };
    }
    const kids = childrenOf(node);
    if (kids) {
      const found = locateIn(kids, node, [...ancestors, node], id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Every id in the book, articles and clauses alike. */
export function allIds(book: Rulebook): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: EditableNode[]) => {
    for (const node of nodes) {
      ids.add(node.id);
      const kids = childrenOf(node);
      if (kids) walk(kids);
    }
  };
  walk(book.articles);
  book.appendices.forEach((a) => ids.add(a.id));
  return ids;
}

// ─── Ids ─────────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!words.length) return 'clause';
  return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

/**
 * A readable, unique id for a new clause, prefixed by its parent so ids keep
 * reading like a path. Deterministic, so tests do not need a seeded random.
 */
export function newClauseId(book: Rulebook, parentId: string | undefined, seedText: string): string {
  const taken = allIds(book);
  const base = `${parentId ? `${parentId}.` : ''}${slugify(seedText)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ─── Edits ───────────────────────────────────────────────────────────────────

/** Change a node's own fields. Ids are immutable, because links depend on them. */
export function updateNode(
  book: Rulebook,
  id: string,
  patch: { title?: string; text?: string },
): Rulebook {
  const next = clone(book);
  const found = locate(next, id) ?? fail('not-found', `No rule with id ${id}`);

  if (found.isArticle) {
    const article = found.node as RulebookArticle;
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) fail('empty-article-title', 'An article needs a title');
      article.title = title;
    }
    return next;
  }

  const clause = found.node as RulebookClause;
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title) clause.title = title;
    else delete clause.title;
  }
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (text) clause.text = text;
    else delete clause.text;
  }
  if (!clause.title && !clause.text && !clause.table) {
    fail('empty-clause', 'A rule needs a title or some text');
  }
  return next;
}

/** Add a new clause before, after, or inside an existing node. */
export function insertClause(
  book: Rulebook,
  relativeTo: string,
  position: InsertPosition,
  draft: { title?: string; text?: string },
): { book: Rulebook; id: string } {
  const seed = draft.text?.trim() || draft.title?.trim() || '';
  if (!seed) fail('empty-clause', 'A rule needs a title or some text');

  const next = clone(book);
  const found = locate(next, relativeTo) ?? fail('not-found', `No rule with id ${relativeTo}`);

  if (found.isArticle && position !== 'child') {
    fail('article-sibling', 'Use addArticle to put a new article beside this one');
  }

  const parentId = position === 'child' ? found.node.id : found.parent?.id;
  const id = newClauseId(next, parentId, seed);
  const clause: RulebookClause = { id };
  if (draft.title?.trim()) clause.title = draft.title.trim();
  if (draft.text?.trim()) clause.text = draft.text.trim();

  if (position === 'child') {
    if (isArticle(found.node)) {
      found.node.clauses.push(clause);
    } else {
      const parent = found.node as RulebookClause;
      parent.children = parent.children ?? [];
      parent.children.push(clause);
    }
  } else {
    found.siblings.splice(position === 'before' ? found.index : found.index + 1, 0, clause);
  }

  return { book: next, id };
}

/** A new article appended to the end of the book. */
export function addArticle(book: Rulebook, title: string): { book: Rulebook; id: string } {
  const clean = title.trim();
  if (!clean) fail('empty-article-title', 'An article needs a title');
  const next = clone(book);
  const id = newClauseId(next, undefined, clean);
  next.articles.push({ id, title: clean, clauses: [] });
  return { book: next, id };
}

/**
 * Every id that would disappear if `id` were removed: the node and all its
 * descendants. Callers warn with this before deleting.
 */
export function idsRemovedBy(book: Rulebook, id: string): string[] {
  const found = locate(book, id);
  if (!found) return [];
  const ids: string[] = [];
  const walk = (node: EditableNode) => {
    ids.push(node.id);
    childrenOf(node)?.forEach(walk);
  };
  walk(found.node);
  return ids;
}

export function deleteNode(book: Rulebook, id: string): Rulebook {
  const next = clone(book);
  const found = locate(next, id) ?? fail('not-found', `No rule with id ${id}`);
  if (found.isArticle && next.articles.length === 1) {
    fail('last-article', 'The book needs at least one article');
  }
  found.siblings.splice(found.index, 1);
  if (found.parent && !found.isArticle) {
    const parent = found.parent as RulebookClause;
    if (parent.children && parent.children.length === 0) delete parent.children;
  }
  return next;
}

// ─── Moving ──────────────────────────────────────────────────────────────────

/** Whether a move is legal, so the UI can grey out what cannot happen. */
export function canMove(book: Rulebook, id: string, direction: MoveDirection): boolean {
  const found = locate(book, id);
  if (!found) return false;
  switch (direction) {
    case 'up':
      return found.index > 0;
    case 'down':
      return found.index < found.siblings.length - 1;
    case 'promote':
      return !found.isArticle && found.ancestors.length > 1;
    case 'demote': {
      if (found.isArticle) return false;
      return found.index > 0;
    }
  }
}

export function moveNode(book: Rulebook, id: string, direction: MoveDirection): Rulebook {
  if (!canMove(book, id, direction)) {
    fail('illegal-move', `That rule cannot move ${direction}`);
  }
  const next = clone(book);
  const found = locate(next, id) as NodeLocation;

  if (direction === 'up' || direction === 'down') {
    const target = direction === 'up' ? found.index - 1 : found.index + 1;
    const [node] = found.siblings.splice(found.index, 1);
    found.siblings.splice(target, 0, node);
    return next;
  }

  if (direction === 'demote') {
    // Become the last child of the sibling above.
    const above = found.siblings[found.index - 1] as RulebookClause;
    const [node] = found.siblings.splice(found.index, 1);
    above.children = above.children ?? [];
    above.children.push(node);
    return next;
  }

  // Promote: become the next sibling of the parent clause.
  const parent = found.parent as RulebookClause;
  const grand = locate(next, parent.id) as NodeLocation;
  const [node] = found.siblings.splice(found.index, 1);
  grand.siblings.splice(grand.index + 1, 0, node);
  if (parent.children && parent.children.length === 0) delete parent.children;
  return next;
}

// ─── Integrity ───────────────────────────────────────────────────────────────

export interface DraftProblem {
  kind: 'broken-ref' | 'duplicate-id' | 'empty-clause';
  id: string;
  detail: string;
}

const REF_PATTERN = /\{\{ref:([^}]+)\}\}/g;

/**
 * Everything wrong with a draft: references pointing nowhere, repeated ids,
 * clauses with no content. Publishing in phase 3 must refuse on any of these.
 */
export function validateDraft(book: Rulebook): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const seen = new Set<string>();
  const ids = allIds(book);

  const check = (node: EditableNode) => {
    if (seen.has(node.id)) {
      problems.push({ kind: 'duplicate-id', id: node.id, detail: `Id ${node.id} is used twice` });
    }
    seen.add(node.id);

    const clause = node as RulebookClause;
    if (!isArticle(node) && !clause.title && !clause.text && !clause.table) {
      problems.push({ kind: 'empty-clause', id: node.id, detail: 'Rule has no title, text, or table' });
    }
    if (clause.text) {
      for (const match of clause.text.matchAll(REF_PATTERN)) {
        if (!ids.has(match[1])) {
          problems.push({
            kind: 'broken-ref',
            id: node.id,
            detail: `Points at ${match[1]}, which is not in the book`,
          });
        }
      }
    }
    childrenOf(node)?.forEach(check);
  };

  book.articles.forEach(check);
  return problems;
}
