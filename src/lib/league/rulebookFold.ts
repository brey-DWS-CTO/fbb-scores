/**
 * Folding the newest rule book revision into the one before it.
 *
 * Publishing freezes a book and starts the signatures over. For a wording fix
 * the league already understands, that costs everyone a second signature. A
 * fold puts the newest revision's book into the one before it, which keeps its
 * id, number, date and signatures, and deletes the newest. Once anyone has
 * signed the newest, it stands and a fold is refused.
 *
 * Pure. No server, no browser.
 */

export interface FoldableVersion {
  id: string;
  revision: number;
}

/** Why a fold cannot happen, in plain words, or null when it can. */
export function foldProblem(
  latest: FoldableVersion | null,
  previous: FoldableVersion | null,
  askedId: string,
  signedLatest: number,
): string | null {
  if (!latest) return 'Nothing is published yet.';
  if (latest.id !== askedId) return 'A newer revision is out. Reload the page and look again.';
  if (!previous) return `Revision ${latest.revision} is the first one. There is nothing to fold it into.`;
  if (signedLatest > 0) {
    return `Someone has signed revision ${latest.revision}, so it stands. Publish again to change it.`;
  }
  return null;
}

/** The newest book, numbered as the revision it folds into. */
export function foldedBook(book: unknown, revision: number): unknown {
  return typeof book === 'object' && book !== null && !Array.isArray(book)
    ? { ...(book as Record<string, unknown>), revision }
    : book;
}
