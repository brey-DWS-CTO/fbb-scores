import { useState } from 'react';
import type { Rulebook, RulebookEntry } from '../../lib/league/rulebook.js';
import {
  canMove,
  idsRemovedBy,
  insertClause,
  locate,
  moveNode,
  updateNode,
  validateDraft,
  deleteNode,
  type MoveDirection,
} from '../../lib/league/rulebookEdit.js';

type Pending = 'edit' | 'addChild' | 'addAfter' | 'confirmDelete' | null;

const MOVES: Array<{ dir: MoveDirection; label: string; hint: string }> = [
  { dir: 'up', label: '↑', hint: 'Move up' },
  { dir: 'down', label: '↓', hint: 'Move down' },
  { dir: 'promote', label: '←', hint: 'Move out one level' },
  { dir: 'demote', label: '→', hint: 'Nest under the rule above' },
];

/**
 * The commissioner's per-rule controls in draft mode.
 *
 * Every action is a pure tree edit that produces a whole new book; the parent
 * decides when to save it. Nothing here knows about the network.
 */
export default function RuleEditMenu({
  book,
  entry,
  onChange,
  onError,
}: {
  book: Rulebook;
  entry: RulebookEntry;
  onChange: (next: Rulebook, note: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [title, setTitle] = useState(entry.title ?? '');
  const [text, setText] = useState(entry.text ?? '');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  const run = (action: () => { next: Rulebook; note: string }) => {
    try {
      const { next, note } = action();
      onChange(next, note);
      setPending(null);
      setDraftTitle('');
      setDraftText('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That edit could not be applied');
    }
  };

  const open = (which: Pending) => {
    setTitle(entry.title ?? '');
    setText(entry.text ?? '');
    setPending(which);
  };

  if (pending === 'edit') {
    return (
      <div className="rule-edit-form">
        <label className="rule-edit-label">
          Title (optional)
          <input
            className="hub-input rule-edit-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="No title"
          />
        </label>
        {!entry.isArticle && (
          <label className="rule-edit-label">
            Text
            <textarea
              className="hub-input rule-edit-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
            />
          </label>
        )}
        <p className="rule-edit-hint">
          To point at another rule, write <code>{'{{ref:its.id}}'}</code>. It shows that rule's
          current number and follows it if the rule moves.
        </p>
        <div className="rule-edit-actions">
          <button
            type="button"
            className="rule-edit-save tap-btn"
            onClick={() =>
              run(() => ({
                next: updateNode(book, entry.id, entry.isArticle ? { title } : { title, text }),
                note: `Edited ${entry.number}`,
              }))
            }
          >
            SAVE
          </button>
          <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setPending(null)}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  if (pending === 'addChild' || pending === 'addAfter') {
    const position = pending === 'addChild' ? 'child' : 'after';
    return (
      <div className="rule-edit-form">
        <div className="rule-edit-label">
          {pending === 'addChild' ? `New rule inside ${entry.number}` : `New rule after ${entry.number}`}
        </div>
        <input
          className="hub-input rule-edit-input"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Title (optional)"
        />
        <textarea
          className="hub-input rule-edit-textarea"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={4}
          placeholder="What the rule says"
        />
        <div className="rule-edit-actions">
          <button
            type="button"
            className="rule-edit-save tap-btn"
            onClick={() =>
              run(() => {
                const { book: next, id } = insertClause(book, entry.id, position, {
                  title: draftTitle,
                  text: draftText,
                });
                return { next, note: `Added ${id}` };
              })
            }
          >
            ADD
          </button>
          <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setPending(null)}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  if (pending === 'confirmDelete') {
    const removed = idsRemovedBy(book, entry.id);
    // Work out what would break, without committing the delete.
    let orphaned: string[] = [];
    try {
      const after = deleteNode(book, entry.id);
      orphaned = validateDraft(after)
        .filter((p) => p.kind === 'broken-ref')
        .map((p) => {
          const node = locate(after, p.id);
          return node ? (node.node.id as string) : p.id;
        });
    } catch {
      orphaned = [];
    }

    return (
      <div className="rule-edit-form rule-edit-danger">
        <div className="rule-edit-label">Delete {entry.number}?</div>
        {removed.length > 1 && (
          <p className="rule-edit-hint">
            This also removes {removed.length - 1} rule{removed.length > 2 ? 's' : ''} nested under
            it.
          </p>
        )}
        {orphaned.length > 0 && (
          <p className="rule-edit-warn">
            {orphaned.length} other rule{orphaned.length > 1 ? 's' : ''} point here and would be
            left pointing at nothing: {orphaned.join(', ')}. Fix those first.
          </p>
        )}
        <div className="rule-edit-actions">
          <button
            type="button"
            className="rule-edit-delete tap-btn"
            disabled={orphaned.length > 0}
            onClick={() =>
              run(() => ({ next: deleteNode(book, entry.id), note: `Deleted ${entry.number}` }))
            }
          >
            DELETE
          </button>
          <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setPending(null)}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rule-edit-bar">
      <button type="button" className="rule-edit-btn tap-btn" onClick={() => open('edit')}>
        EDIT
      </button>
      <button type="button" className="rule-edit-btn tap-btn" onClick={() => open('addChild')}>
        + INSIDE
      </button>
      {!entry.isArticle && (
        <button type="button" className="rule-edit-btn tap-btn" onClick={() => open('addAfter')}>
          + AFTER
        </button>
      )}
      {MOVES.map((move) => (
        <button
          key={move.dir}
          type="button"
          className="rule-edit-btn rule-edit-move tap-btn"
          title={move.hint}
          aria-label={move.hint}
          disabled={!canMove(book, entry.id, move.dir)}
          onClick={() =>
            run(() => ({
              next: moveNode(book, entry.id, move.dir),
              note: `Moved ${entry.number} ${move.dir}`,
            }))
          }
        >
          {move.label}
        </button>
      ))}
      <button
        type="button"
        className="rule-edit-btn rule-edit-btn-danger tap-btn"
        onClick={() => setPending('confirmDelete')}
      >
        DELETE
      </button>
    </div>
  );
}
