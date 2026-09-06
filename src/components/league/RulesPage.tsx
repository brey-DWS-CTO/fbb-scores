import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import RecordTables from './RecordTables.js';
import RuleEditMenu from './RuleEditMenu.js';
import PublishPanel from './PublishPanel.js';
import RulebookAudit from './RulebookAudit.js';
import RulebookHistory from './RulebookHistory.js';
import SignaturePanel from './SignaturePanel.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchPolls,
  fetchPublishedRulebook,
  fetchRulebookDraft,
  fetchRulebookSignatures,
  fetchRulebookVersion,
  fetchRulebookVersions,
  isStaleDraftError,
  publishRulebook,
  resetRulebookDraft,
  saveRulebookDraft,
  type RulebookSignaturesResponse,
  type RulebookVersionSummary,
} from '../../lib/league/api.js';
import { printedRevisionLine } from '../../lib/league/rulebookSignatures.js';
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
import {
  auditRulebookSettings,
  settingsNeedingAttention,
} from '../../lib/league/rulebookSettings.js';

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

const formatPublished = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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
  open,
  onToggle,
  onPropose,
  breadcrumb,
  editor,
}: {
  entry: RulebookEntry;
  index: RulebookIndex;
  term: string;
  copied: boolean;
  onCopy: (id: string) => void;
  /** True while this rule's actions are showing. Only one rule at a time. */
  open: boolean;
  onToggle: (id: string) => void;
  /** Only set when the reader still has their one vote for the season. */
  onPropose?: (id: string) => void;
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
          className={open ? 'rules-number rules-number-open tap-btn' : 'rules-number tap-btn'}
          onClick={() => onToggle(entry.id)}
          aria-expanded={open}
          title={`Actions for rule ${entry.number}`}
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
      {open && (
        <div className="rules-actions">
          <button type="button" className="rules-propose tap-btn" onClick={() => onCopy(entry.id)}>
            COPY LINK
          </button>
          {/* An example illustrates a rule; there is nothing separate to vote on. */}
          {onPropose && entry.kind !== 'example' && (
            <button
              type="button"
              className="rules-propose tap-btn"
              onClick={() => onPropose(entry.id)}
            >
              PROPOSE A CHANGE
            </button>
          )}
        </div>
      )}
      {editor}
    </div>
  );
}

/** /rules — the league constitution, searchable, linkable, and editable. */
export default function RulesPage() {
  const { identity } = useIdentity();
  const { dataset } = useLeagueData();
  const isCommish = identity?.isCommissioner === true;

  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  // Which rule is showing its actions. One at a time, so the book stays a book.
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
  const location = useLocation();
  const navigate = useNavigate();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The published book, once it arrives. Rendering starts from the committed
  // seed so the page never flashes empty, then swaps to the published version.
  const [publishedBook, setPublishedBook] = useState<Rulebook>(rulebook2027);
  const [publishedMeta, setPublishedMeta] = useState<{
    published: boolean;
    versionId: string | null;
    revision: number;
    publishedAt: string | null;
    publishedBy: string | null;
  }>({
    published: false,
    versionId: null,
    revision: rulebook2027.revision,
    publishedAt: null,
    publishedBy: null,
  });

  const loadPublished = useCallback(async () => {
    try {
      const latest = await fetchPublishedRulebook();
      setPublishedBook(latest.book);
      setPublishedMeta({
        published: latest.published,
        versionId: latest.versionId,
        revision: latest.revision,
        publishedAt: latest.publishedAt,
        publishedBy: latest.publishedBy,
      });
    } catch {
      // Offline or the API is down: the committed seed is the fallback, which
      // is exactly what the player pool and schedule do.
    }
  }, []);

  useEffect(() => {
    void loadPublished();
  }, [loadPublished]);

  // ─── Past revisions ──────────────────────────────────────────────────────
  // `?rev=` names a frozen version. It is a real URL so a link to an old
  // revision can be shared, the same way a link to a rule can.
  const [searchParams, setSearchParams] = useSearchParams();
  const revParam = searchParams.get('rev');
  const [versions, setVersions] = useState<RulebookVersionSummary[] | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [pastVersion, setPastVersion] = useState<
    (RulebookVersionSummary & { book: Rulebook }) | null
  >(null);
  const [pastError, setPastError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<RulebookSignaturesResponse | null>(null);
  const [canPropose, setCanPropose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRulebookVersions()
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch(() => {
        if (!cancelled) setVersionError('Could not load the revision history.');
      });
    return () => {
      cancelled = true;
    };
  }, [publishedMeta.versionId]);

  useEffect(() => {
    if (!revParam) {
      setPastVersion(null);
      setPastError(null);
      return;
    }
    let cancelled = false;
    setPastError(null);
    fetchRulebookVersion(revParam)
      .then((version) => {
        if (!cancelled) setPastVersion(version);
      })
      .catch(() => {
        if (!cancelled) setPastError('That revision could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [revParam]);

  const loadSignatures = useCallback(async () => {
    try {
      setSignatures(await fetchRulebookSignatures(revParam ?? undefined));
    } catch {
      setSignatures(null);
    }
  }, [revParam]);

  useEffect(() => {
    void loadSignatures();
  }, [loadSignatures, publishedMeta.versionId]);

  // The propose action only shows to a member who still has their one launch.
  useEffect(() => {
    if (!identity) {
      setCanPropose(false);
      return;
    }
    let cancelled = false;
    fetchPolls(identity)
      .then((data) => {
        if (!cancelled) setCanPropose(data.you.canLaunch);
      })
      .catch(() => {
        if (!cancelled) setCanPropose(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // ─── Draft mode ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Rulebook | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const undoStack = useRef<Rulebook[]>([]);

  // Draft beats a chosen revision, which beats what is published now.
  const book = editing && draft ? draft : (pastVersion?.book ?? publishedBook);
  const historical = pastVersion !== null && pastVersion.id !== publishedMeta.versionId;
  const index = useMemo(
    () => (book === rulebook2027 ? rulebookIndex2027 : buildRulebookIndex(book)),
    [book],
  );
  const sections = useMemo(() => groupByArticle(index), [index]);
  const results = useMemo(() => (term.trim() ? searchRulebook(index, term) : null), [term, index]);
  const problems = useMemo(() => (editing && draft ? validateDraft(draft) : []), [editing, draft]);
  const settingsToCheck = useMemo(
    () =>
      editing && draft && dataset
        ? settingsNeedingAttention(auditRulebookSettings(draft, dataset)).length
        : 0,
    [editing, draft, dataset],
  );

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

  const publish = async (fingerprint: string, notes: string) => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishRulebook(identity, fingerprint, notes);
      await loadPublished();
      setNotice(`Published revision ${result.revision}. Everyone reads it now.`);
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

  const openVersion = (versionId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (versionId) next.set('rev', versionId);
    else next.delete('rev');
    setSearchParams(next);
    window.scrollTo({ top: 0 });
  };

  // A change vote starts where the member is reading, with the rule already set.
  const proposeChange = (id: string) => navigate(`/votes?kind=change&rule=${encodeURIComponent(id)}`);
  const proposeFor =
    !editing && !historical && identity && canPropose ? proposeChange : undefined;

  const printedAt = pastVersion?.publishedAt ?? publishedMeta.publishedAt;

  return (
    <main className={editing ? 'rules-page rules-page-editing' : 'rules-page'}>
      <div className="rules-print-head" aria-hidden="true">
        <h1>{book.title}</h1>
        <p>
          {book.season} season · {printedRevisionLine(book, printedAt)}
          {historical ? ' · superseded revision' : ''}
        </p>
      </div>
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-teal">
            <NavIcon name="book" size={18} className="icon-in-heading" />
            RULE BOOK
          </h1>
          <p>
            The Nerds constitution, {book.season}.
          </p>
        </div>
        <IdentityChip />
      </header>

      {pastError && <p className="rules-draft-error">{pastError}</p>}

      {historical && pastVersion && (
        <div className="panel rules-status rules-old-revision">
          <span className="hub-heading">OLD REVISION</span>
          <p>
            You are reading revision {pastVersion.revision}, published{' '}
            {formatPublished(pastVersion.publishedAt)} by {pastVersion.publishedBy}. It is not the
            constitution in force.
          </p>
          {pastVersion.notes && <p className="rules-old-notes">{pastVersion.notes}</p>}
          <button type="button" className="rules-tool tap-btn" onClick={() => openVersion(null)}>
            BACK TO THE CURRENT BOOK
          </button>
        </div>
      )}

      {!editing && !historical && !publishedMeta.published && (
        <div className="panel rules-status">
          <span className="hub-heading">NOT YET PUBLISHED</span>
          <p>Revision {book.revision} is a working draft. Nobody has signed it.</p>
        </div>
      )}

      {!editing && !historical && publishedMeta.published && (
        <p className="rules-published-line">
          Revision {publishedMeta.revision}, published{' '}
          {publishedMeta.publishedAt ? formatPublished(publishedMeta.publishedAt) : ''}
          {publishedMeta.publishedBy ? ` by ${publishedMeta.publishedBy}` : ''}.
        </p>
      )}

      {isCommish && !historical && (
        <div className={editing ? 'panel rules-draft-bar rules-draft-on' : 'rules-draft-off'}>
          {!editing ? (
            <button type="button" className="rules-tool tap-btn" disabled={busy} onClick={enterDraft}>
              {busy ? (
                'OPENING...'
              ) : (
                <>
                  <NavIcon name="pencil" size={14} className="icon-in-heading" />
                  EDIT THE RULE BOOK
                </>
              )}
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
              {draft && (
                <RulebookAudit
                  book={draft}
                  versions={versions}
                  versionError={versionError}
                  currentVersionId={publishedMeta.versionId}
                />
              )}
              {problems.length === 0 && draft && (
                <PublishPanel
                  published={publishedBook}
                  draft={draft}
                  dirty={dirty}
                  busy={busy}
                  settingsToCheck={settingsToCheck}
                  onPublish={publish}
                />
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
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'HIDE REVISIONS' : 'REVISIONS'}
        </button>
        <button
          type="button"
          className="rules-tool rules-tool-icon tap-btn"
          onClick={() => window.print()}
          title="Save the rule book as a PDF"
          aria-label="Save the rule book as a PDF"
        >
          <span aria-hidden="true">⤓</span>
        </button>
      </div>

      {showHistory && (
        <section className="panel rules-history">
          <span className="hub-heading">AMENDMENT HISTORY</span>
          <RulebookHistory
            versions={versions}
            error={versionError}
            currentVersionId={publishedMeta.versionId}
            viewingId={revParam}
            onOpen={openVersion}
            emptyLine="Nothing published yet."
          />
        </section>
      )}

      {!editing && (
        <SignaturePanel
          identity={identity}
          data={signatures}
          historical={historical}
          onSigned={() => void loadSignatures()}
        />
      )}

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
                open={openId === hit.entry.id}
                onToggle={(id) => setOpenId((prev) => (prev === id ? null : id))}
                onPropose={proposeFor}
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
                        open={openId === entry.id}
                        onToggle={(id) => setOpenId((prev) => (prev === id ? null : id))}
                        onPropose={proposeFor}
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

      {/* Paper only. A printed constitution has to carry its own history, since
          the reader cannot tap REVISIONS on a sheet of paper. */}
      <section className="rules-print-history" aria-hidden="true">
        <h2>Amendment history</h2>
        {versions && versions.length > 0 ? (
          <ul>
            {versions.map((revision) => (
              <li key={revision.id}>
                <strong>Revision {revision.revision}</strong> · {formatPublished(revision.publishedAt)}{' '}
                · {revision.publishedBy}
                {revision.notes ? ` — ${revision.notes}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>No revision has been published yet.</p>
        )}
      </section>
    </main>
  );
}
