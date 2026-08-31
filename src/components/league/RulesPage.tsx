import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import { rulebook2027, rulebookIndex2027 } from '../../lib/league/rulebookData.js';
import {
  anchorFor,
  highlight,
  resolveRefs,
  searchRulebook,
  type RulebookEntry,
} from '../../lib/league/rulebook.js';

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
  const location = useLocation();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(
    () => (term.trim() ? searchRulebook(rulebookIndex2027, term) : null),
    [term],
  );

  // Jump to a deep-linked rule once, after the page has painted.
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
          : rulebookIndex2027.entries.map((entry) =>
              entry.isArticle ? (
                <h2 key={entry.id} id={anchorFor(entry.id)} className="hub-heading rules-article">
                  <span className="rules-article-number">{entry.number}</span>
                  {entry.title}
                </h2>
              ) : (
                <Clause
                  key={entry.id}
                  entry={entry}
                  term={term}
                  copied={copied === entry.id}
                  onCopy={copyLink}
                />
              ),
            )}
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
