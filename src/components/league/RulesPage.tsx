import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import RecordTables from './RecordTables.js';
import RuleEditMenu from './RuleEditMenu.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchRulebookDraft,
  isStaleDraftError,
  resetRulebookDraft,
  saveRulebookDraft,
} from '../../lib/league/api.js';
import { rulebook2027, rulebookIndex2027 } from '../../lib/league/rulebookData.js';
import {
  anchorFor,
  buildRulebookIndex,
  groupByArticle,
  highlight,
  resolveRefs,
  searchRulebook,
  sectionIdFor,
  type Rulebook,
  type RulebookEntry,
  type RulebookIndex,
} from '../../lib/league/rulebook.js';
import { addArticle, validateDraft } from '../../lib/league/rulebookEdit.js';

const COLLAPSE_KEY = 'nerds.rules.collapsed';
const UNDO_DEPTH = 25;

/** Which sections the reader last had shut. Never fails on a blocked store. */
function loadCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveCollapsed(ids: string[]) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids));
  } catch {
    // A private window or blocked site data just means it does not persist.
  }
}

/** The clause id a `#rule-...` anchor points at. */
function clauseIdFromHash(hash: string): string | undefined {
  if (!hash) return undefined;
  const anchor = hash.replace(/^#/, '');
  return anchor.startsWith('rule-') ? anchor.slice(5) : anchor;
}

/**
 * Sections shut on load, minus the one holding a deep-linked rule. Resolving
 * this up front means a shared link opens its section on the very first render,
 * with no state write from an effect.
 */
function initialCollapsed(): Set<string> {
  const shut = new Set(loadCollapsed());
  const clauseId = clauseIdFromHash(window.location.hash);
  const section = clauseId ? sectionIdFor(clauseId, rulebookIndex2027) : undefined;
  if (section) shut.delete(section);
  return shut;
}

/** Marks the matched run without dangerouslySetInnerHTML. */
function Marked({ text, term }: { text: string; term: string }) {
  return (
    <>
      {highlight(text, term).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="rules-mark">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function ClauseTable({ entry, term }: { entry: RulebookEntry; term: string }) {
  if (!entry.table) return null;
  return (
    <div className="rules-table-wrap">
      <table className="rules-table">
        <thead>
          <tr>
            {entry.table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entry.table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>
                  <Marked text={cell} term={term} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Clause({
  entry,
  index,
  term,
  copied,
  onCopy,
  breadcrumb,
  editor,
}: {
  entry: RulebookEntry;
  index: RulebookIndex;
  term: string;
  copied: boolean;
  onCopy: (id: string) => void;
  /** Set while searching, where article headings are not on screen. */
  breadcrumb?: string;
  editor?: React.ReactNode;
}) {
  const body = entry.text ? resolveRefs(entry.text, index) : '';
  const indent = breadcrumb === undefined ? Math.min(entry.depth - 1, 4) * 14 : 0;

  return (
    <div
      id={anchorFor(entry.id)}
      className={breadcrumb === undefined ? 'rules-clause' : 'rules-clause rules-clause-hit'}
      style={{ marginLeft: indent }}
    >
      {breadcrumb ? <div className="rules-breadcrumb">{breadcrumb}</div> : null}
      <p className={body ? 'rules-clause-text' : 'rules-clause-text rules-clause-heading'}>
        <button
          type="button"
          className="rules-number tap-btn"
          onClick={() => onCopy(entry.id)}
          title="Copy a link to this rule"
        >
          {copied ? 'LINK COPIED' : entry.number}
        </button>
        {entry.title && (
          <span className="rules-clause-title">
            <Marked text={entry.title} term={term} />
            {body ? '. ' : ''}
          </span>
        )}
        {entry.kind === 'example' && <span className="rules-example-tag">EXAMPLE</span>}
        {body && <Marked text={body} term={term} />}
      </p>
      <ClauseTable entry={entry} term={term} />
      {editor}
    </div>
  );
}

/** /rules — the league constitution, searchable, linkable, and editable. */
export default function RulesPage() {
  const { identity } = useIdentity();
  const isCommish = identity?.isCommissioner === true;

  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
  const location = useLocation();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Draft mode ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Rulebook | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const undoStack = useRef<Rulebook[]>([]);

  const book = editing && draft ? draft : rulebook2027;
  const index = useMemo(
    () => (book === rulebook2027 ? rulebookIndex2027 : buildRulebookIndex(book)),
    [book],
  );
  const sections = useMemo(() => groupByArticle(index), [index]);
  const results = useMemo(() => (term.trim() ? searchRulebook(index, term) : null), [term, index]);
  const problems = useMemo(() => (editing && draft ? validateDraft(draft) : []), [editing, draft]);

  const setCollapsedAnd = (next: Set<string>) => {
    setCollapsed(next);
    saveCollapsed([...next]);
  };

  const toggleSection = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsedAnd(next);
  };

  const allShut = collapsed.size >= sections.length;

  // Jump to a deep-linked rule. Its section is already open, because
  // initialCollapsed resolved the anchor before the first render.
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('rules-clause-flash');
    const timer = setTimeout(() => target.classList.remove('rules-clause-flash'), 2200);
    return () => clearTimeout(timer);
  }, [location.hash]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // Warn before losing unsaved edits to a tab close or refresh.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const copyLink = (id: string) => {
    const url = `${window.location.origin}/rules#${anchorFor(id)}`;
    window.history.replaceState(null, '', `/rules#${anchorFor(id)}`);
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  };

  const enterDraft = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await fetchRulebookDraft(identity);
      setDraft(loaded.book);
      setVersion(loaded.version);
      setDirty(false);
      undoStack.current = [];
      setEditing(true);
      setCollapsedAnd(new Set());
      setNotice(
        loaded.seeded
          ? 'Started a new draft from the published book.'
          : `Loaded draft v${loaded.version}, last saved by ${loaded.updatedBy ?? 'someone'}.`,
      );
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [identity]);

  const applyEdit = (next: Rulebook, note: string) => {
    if (draft) {
      undoStack.current = [...undoStack.current.slice(-(UNDO_DEPTH - 1)), draft];
    }
    setDraft(next);
    setDirty(true);
    setError(null);
    setNotice(note);
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setDraft(previous);
    setDirty(true);
    setNotice('Undid the last change.');
  };

  const save = async () => {
    if (!identity || !draft) return;
    if (problems.length) {
      setError(`Fix ${problems.length} problem${problems.length > 1 ? 's' : ''} before saving.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveRulebookDraft(identity, draft, version);
      setVersion(saved.version);
      setDirty(false);
      undoStack.current = [];
      setNotice(`Saved draft v${saved.version}.`);
    } catch (e) {
      setError(
        isStaleDraftError(e)
          ? 'Someone saved a newer draft. Leave draft mode and come back to load it.'
          : apiErrorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!identity) return;
    if (!window.confirm('Throw away the whole draft and go back to the published rule book?')) return;
    setBusy(true);
    try {
      const fresh = await resetRulebookDraft(identity);
      setDraft(fresh.book);
      setVersion(0);
      setDirty(false);
      undoStack.current = [];
      setNotice('Draft reset to the published book.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const leaveDraft = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave draft mode anyway?')) return;
    setEditing(false);
    setDraft(null);
    setDirty(false);
    setError(null);
    setNotice(null);
    undoStack.current = [];
  };

  const editorFor = (entry: RulebookEntry) =>
    editing && draft ? (
      <RuleEditMenu book={draft} entry={entry} onChange={applyEdit} onError={setError} />
    ) : undefined;

  return (
    <main className={editing ? 'rules-page rules-page-editing' : 'rules-page'}>
      <div className="rules-print-head" aria-hidden="true">
        <h1>{book.title}</h1>
        <p>
          {book.season} season · Revision {book.revision} ·{' '}
          {book.status === 'published' ? 'Published' : 'Working draft, not ratified'}
        </p>
      </div>
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-teal">📖 RULE BOOK</h1>
          <p>
            The Nerds constitution for {book.season}. Tap any rule number to copy a link to it.
          </p>
        </div>
        <IdentityChip />
      </header>

      {book.status !== 'published' && !editing && (
        <div className="panel rules-status">
          <span className="hub-heading">NOT YET RATIFIED</span>
          <p>
            Revision {book.revision} is a working draft. It carries the commissioner's 2026 rulings
            and the {book.season} amendment removing the consolation matchup. Nobody has signed it.
          </p>
        </div>
      )}

      {isCommish && (
        <div className={editing ? 'panel rules-draft-bar rules-draft-on' : 'rules-draft-off'}>
          {!editing ? (
            <button type="button" className="rules-tool tap-btn" disabled={busy} onClick={enterDraft}>
              {busy ? 'OPENING...' : '✎ EDIT THE RULE BOOK'}
            </button>
          ) : (
            <>
              <div className="rules-draft-status">
                <span className="hub-heading rules-draft-tag">DRAFT MODE</span>
                <span className="rules-draft-meta">
                  v{version}
                  {dirty ? ' · unsaved changes' : ' · saved'}
                  {' · members still see the published book'}
                </span>
              </div>
              <div className="rules-draft-actions">
                <button
                  type="button"
                  className="rules-tool rules-tool-primary tap-btn"
                  disabled={busy || !dirty || problems.length > 0}
                  onClick={save}
                >
                  {busy ? 'SAVING...' : 'SAVE DRAFT'}
                </button>
                <button
                  type="button"
                  className="rules-tool tap-btn"
                  disabled={busy || undoStack.current.length === 0}
                  onClick={undo}
                >
                  UNDO
                </button>
                <button
                  type="button"
                  className="rules-tool tap-btn"
                  disabled={busy}
                  onClick={() =>
                    draft && applyEdit(addArticle(draft, 'New Article').book, 'Added an article')
                  }
                >
                  + ARTICLE
                </button>
                <button type="button" className="rules-tool tap-btn" disabled={busy} onClick={discard}>
                  RESET
                </button>
                <button type="button" className="rules-tool tap-btn" onClick={leaveDraft}>
                  DONE
                </button>
              </div>
              {problems.length > 0 && (
                <ul className="rules-draft-problems">
                  {problems.slice(0, 6).map((p, i) => (
                    <li key={i}>
                      <code>{p.id}</code> {p.detail}
                    </li>
                  ))}
                  {problems.length > 6 && <li>and {problems.length - 6} more</li>}
                </ul>
              )}
              {error && <p className="rules-draft-error">{error}</p>}
              {!error && notice && <p className="rules-draft-note">{notice}</p>}
            </>
          )}
        </div>
      )}

      <div className="rules-search-bar">
        <input
          className="hub-input rules-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search rules, or type a number like 4.3"
          aria-label="Search the rule book"
        />
        {term && (
          <button type="button" className="rules-clear tap-btn" onClick={() => setTerm('')}>
            CLEAR
          </button>
        )}
      </div>

      <div className="rules-tools">
        <button
          type="button"
          className="rules-tool tap-btn"
          onClick={() =>
            setCollapsedAnd(allShut ? new Set() : new Set(sections.map((s) => s.heading.id)))
          }
        >
          {allShut ? 'OPEN ALL' : 'CLOSE ALL'}
        </button>
        <button type="button" className="rules-tool tap-btn" onClick={() => window.print()}>
          PRINT / PDF
        </button>
      </div>

      {results && (
        <p className="rules-result-count">
          {results.length === 0
            ? 'No rule matches that.'
            : `${results.length} ${results.length === 1 ? 'rule' : 'rules'} match`}
        </p>
      )}

      <div className="rules-body">
        {results
          ? results.map((hit) => (
              <Clause
                key={hit.entry.id}
                entry={hit.entry}
                index={index}
                term={term}
                copied={copied === hit.entry.id}
                onCopy={copyLink}
                breadcrumb={hit.breadcrumb}
                editor={editorFor(hit.entry)}
              />
            ))
          : sections.map((section) => {
              const shut = collapsed.has(section.heading.id);
              return (
                <section key={section.heading.id} className="rules-section">
                  <h2 id={anchorFor(section.heading.id)} className="rules-article">
                    <button
                      type="button"
                      className="hub-heading rules-article-toggle tap-btn"
                      onClick={() => toggleSection(section.heading.id)}
                      aria-expanded={!shut}
                      aria-controls={`section-${section.heading.id}`}
                    >
                      <span className="rules-caret" aria-hidden="true">
                        {shut ? '▸' : '▾'}
                      </span>
                      <span className="rules-article-number">{section.heading.number}</span>
                      <span className="rules-article-title">{section.heading.title}</span>
                      <span className="rules-article-count">{section.clauses.length}</span>
                    </button>
                  </h2>
                  <div
                    id={`section-${section.heading.id}`}
                    className={shut ? 'rules-section-body rules-shut' : 'rules-section-body'}
                  >
                    {editing && !section.heading.number.startsWith('Appendix') && (
                      <div className="rules-article-editor">{editorFor(section.heading)}</div>
                    )}
                    {/* Appendices carry their content on the heading itself. */}
                    {section.heading.note && (
                      <p className="rules-clause-text rules-section-note">
                        <Marked text={section.heading.note} term={term} />
                      </p>
                    )}
                    {section.heading.table && <ClauseTable entry={section.heading} term={term} />}
                    {section.heading.id === 'appendix-b' && <RecordTables />}
                    {section.clauses.map((entry) => (
                      <Clause
                        key={entry.id}
                        entry={entry}
                        index={index}
                        term={term}
                        copied={copied === entry.id}
                        onCopy={copyLink}
                        editor={editorFor(entry)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
        {results && results.length === 0 && (
          <div className="panel rules-empty">
            Nothing found. Try a keyword like <em>keeper</em>, <em>waivers</em>, or a rule
            number like <em>6.5</em>.
          </div>
        )}
      </div>
    </main>
  );
}
