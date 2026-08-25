import { useMemo, useRef, useState } from 'react';
import type { DatasetPlayer } from '../../lib/keeper/types.js';

interface Props {
  players: DatasetPlayer[];
  placeholder?: string;
  onSelect: (player: DatasetPlayer) => void;
  /** Right-side meta rendered per row (avg, round chip, etc.) */
  renderMeta?: (player: DatasetPlayer) => React.ReactNode;
  /** Rows that render but can't be chosen (returns a reason). */
  disabledReason?: (player: DatasetPlayer) => string | null;
  maxResults?: number;
  autoFocus?: boolean;
}

/** Type-to-search player picker (the spreadsheet dropdown, but good). */
export default function PlayerCombobox({
  players,
  placeholder = 'Type a player name…',
  onSelect,
  renderMeta,
  disabledReason,
  maxResults = 30,
  autoFocus,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? players.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.fullName ?? '').toLowerCase().includes(q),
        )
      : players;
    return pool.slice(0, maxResults);
  }, [players, query, maxResults]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="hub-input"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        style={{ width: '100%', padding: '12px 14px', fontSize: '1rem' }}
      />
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            className="panel"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 50,
              maxHeight: 320,
              overflowY: 'auto',
              borderRadius: 8,
            }}
          >
            {results.length === 0 && (
              <div style={{ padding: 14, color: 'var(--text-mid)' }}>No players match “{query}”</div>
            )}
            {results.map((p) => {
              const reason = disabledReason?.(p) ?? null;
              return (
                <button
                  key={p.key}
                  className="tap-btn"
                  disabled={!!reason}
                  onClick={() => {
                    onSelect(p);
                    setQuery('');
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    width: '100%',
                    padding: '11px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--panel-border)',
                    color: reason ? 'var(--text-faint)' : 'var(--text-hi)',
                    cursor: reason ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>{' '}
                    <span style={{ color: 'var(--text-mid)', fontSize: '0.75rem' }}>
                      {p.proTeam} · {p.positions.join('/')}
                    </span>
                    {reason && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--neon-red)' }}>{reason}</div>
                    )}
                  </span>
                  {renderMeta && <span style={{ flexShrink: 0 }}>{renderMeta(p)}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
