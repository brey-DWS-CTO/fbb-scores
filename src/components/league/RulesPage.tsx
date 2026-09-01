import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import RecordTables from './RecordTables.js';
import { rulebook2027, rulebookIndex2027 } from '../../lib/league/rulebookData.js';
import {
  anchorFor,
  groupByArticle,
  highlight,
  resolveRefs,
  searchRulebook,
  sectionIdFor,
  type RulebookEntry,
} from '../../lib/league/rulebook.js';

const COLLAPSE_KEY = 'nerds.rules.collapsed';

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
  term,
  copied,
  onCopy,
  breadcrumb,
}: {
  entry: RulebookEntry;
  term: string;
  copied: boolean;
  onCopy: (id: string) => void;
  /** Set while searching, where article headings are not on screen. */
  breadcrumb?: string;
}) {
  const body = entry.text ? resolveRefs(entry.text, rulebookIndex2027) : '';
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
    </div>
  );
}

/** /rules — the league constitution, searchable and linkable. */
export default function RulesPage() {
  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
  const location = useLocation();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(
    () => (term.trim() ? searchRulebook(rulebookIndex2027, term) : null),
    [term],
  );
  const sections = useMemo(() => groupByArticle(rulebookIndex2027), []);

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

  const copyLink = (id: string) => {
    const url = `${window.location.origin}/rules#${anchorFor(id)}`;
    window.history.replaceState(null, '', `/rules#${anchorFor(id)}`);
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  };

  return (
    <main className="rules-page">
      <div className="rules-print-head" aria-hidden="true">
        <h1>{rulebook2027.title}</h1>
        <p>
          {rulebook2027.season} season · Revision {rulebook2027.revision} ·{' '}
          {rulebook2027.status === 'published' ? 'Published' : 'Working draft, not ratified'}
        </p>
      </div>
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-teal">📖 RULE BOOK</h1>
          <p>
            The Nerds constitution for {rulebook2027.season}. Tap any rule number to copy a link
            to it.
          </p>
        </div>
        <IdentityChip />
      </header>

      {rulebook2027.status !== 'published' && (
        <div className="panel rules-status">
          <span className="hub-heading">NOT YET RATIFIED</span>
          <p>
            Revision {rulebook2027.revision} is a working draft. It carries the commissioner's
            2026 rulings and the {rulebook2027.season} amendment removing the consolation matchup.
            Nobody has signed it.
          </p>
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
                term={term}
                copied={copied === hit.entry.id}
                onCopy={copyLink}
                breadcrumb={hit.breadcrumb}
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
                        term={term}
                        copied={copied === entry.id}
                        onCopy={copyLink}
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
