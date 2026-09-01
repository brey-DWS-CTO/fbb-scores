import { useMemo, useState } from 'react';
import { searchRulebook, type RulebookIndex } from '../../lib/league/rulebook.js';

const MAX_RESULTS = 12;

/** The first words of a rule, so a picked line reads like the book. */
function shortLine(title: string | undefined, text: string | undefined): string {
  const source = title ?? text ?? '';
  return source.length > 90 ? `${source.slice(0, 89)}…` : source;
}

/**
 * Pick rules out of the book by searching it, the same way a member reads it.
 *
 * Search comes from `searchRulebook`, so a number like 4.3 pulls up that rule
 * and everything under it, exactly as it does on the rules page. The member
 * never types an id.
 */
export default function RulePicker({
  index,
  selected,
  onChange,
  label,
  hint,
  max,
}: {
  index: RulebookIndex;
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  hint: string;
  /** Cap on picks. A new rule names one place; a change may name several. */
  max?: number;
}) {
  const [term, setTerm] = useState('');

  const hits = useMemo(
    () => (term.trim() ? searchRulebook(index, term).slice(0, MAX_RESULTS) : []),
    [index, term],
  );
  const full = max !== undefined && selected.length >= max;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((picked) => picked !== id));
      return;
    }
    if (full) {
      onChange([...selected.slice(1), id]);
      return;
    }
    onChange([...selected, id]);
    setTerm('');
  };

  return (
    <div className="rule-picker">
      <span className="rule-edit-label rule-picker-label">{label}</span>

      {selected.length > 0 && (
        <ul className="rule-picked">
          {selected.map((id) => {
            const entry = index.byId.get(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="rule-picked-chip tap-btn"
                  onClick={() => toggle(id)}
                  title="Take this rule off"
                >
                  <span className="rule-picked-number">{entry ? entry.number : id}</span>
                  <span className="rule-picked-title">
                    {entry ? shortLine(entry.title, entry.text) : 'not in the book'}
                  </span>
                  <span className="rule-picked-x" aria-hidden="true">
                    ✕
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <input
        className="hub-input rule-edit-input"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search the book, or type a number like 4.3"
        aria-label={label}
      />

      {term.trim() && hits.length === 0 && (
        <p className="rule-edit-hint">No rule matches that.</p>
      )}

      {hits.length > 0 && (
        <ul className="rule-hits">
          {hits.map((hit) => (
            <li key={hit.entry.id}>
              <button
                type="button"
                className={
                  selected.includes(hit.entry.id)
                    ? 'rule-hit rule-hit-on tap-btn'
                    : 'rule-hit tap-btn'
                }
                onClick={() => toggle(hit.entry.id)}
              >
                <span className="rule-hit-number">{hit.entry.number}</span>
                <span className="rule-hit-title">
                  {shortLine(hit.entry.title, hit.entry.text)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="rule-edit-hint">{hint}</p>
    </div>
  );
}
