import { useEffect, useMemo, useState } from 'react';
import IdentityChip from './IdentityChip.js';
import LmAddPanel from './LmAddPanel.js';
import NavIcon from './NavIcon.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchTransactions, type TransactionsResponse } from '../../lib/league/api.js';
import { movesFor, movesOf, type Move } from '../../lib/league/transactions.js';

/** "Oct 27, 2:20 PM" in the viewer's own clock. */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Oct 27" for the day headings. */
const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const dayKey = (iso: string) => new Date(iso).toDateString();

const KIND_LABEL: Record<Move['kind'], string> = {
  add: 'ADD',
  waiver: 'CLAIM',
  drop: 'DROP',
  trade: 'TRADE',
};

/** The feed refreshes itself this often while the page is open. */
const REFRESH_MS = 60_000;

/** /activity — every add, drop, claim and trade on ESPN this season, newest first. */
export default function ActivityPage() {
  const { dataset } = useLeagueData();
  const { identity } = useIdentity();
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchTransactions()
        .then((next) => {
          if (!alive) return;
          setData(next);
          setError(null);
        })
        .catch((e) => {
          if (alive) setError(apiErrorMessage(e));
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const moves = useMemo(() => movesOf(data?.rows ?? []), [data]);
  const shown = useMemo(() => movesFor(moves, owner), [moves, owner]);
  const owners = useMemo(
    () => [...dataset.teams].sort((a, b) => a.owner.localeCompare(b.owner)).map((team) => team.owner),
    [dataset.teams],
  );

  const days: Array<{ key: string; label: string; moves: Move[] }> = [];
  for (const move of shown) {
    const key = dayKey(move.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.moves.push(move);
    else days.push({ key, label: formatDay(move.at), moves: [move] });
  }

  const mine = identity?.owner ?? null;
  const pulled = data?.pulledAt ? `ESPN checked ${formatWhen(data.pulledAt)}.` : '';

  return (
    <main className="rules-page activity-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="home" size={18} className="icon-in-heading" />
            ACTIVITY
          </h1>
          <p>Every add, drop, claim and trade on ESPN this season. {pulled}</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && data?.pullError && (
        <p className="rules-draft-error">ESPN did not answer the last check: {data.pullError}. This is the last good list.</p>
      )}

      <LmAddPanel />

      <div className="activity-filters" role="group" aria-label="Show moves by team">
        <button type="button" className={owner === null ? 'activity-chip is-on' : 'activity-chip'} onClick={() => setOwner(null)}>
          ALL
        </button>
        {mine && (
          <button type="button" className={owner === mine ? 'activity-chip is-on' : 'activity-chip'} onClick={() => setOwner(mine)}>
            MINE
          </button>
        )}
        {owners.filter((name) => name !== mine).map((name) => (
          <button
            key={name}
            type="button"
            className={owner === name ? 'activity-chip is-on' : 'activity-chip'}
            onClick={() => setOwner(name)}
          >
            {name.toUpperCase()}
          </button>
        ))}
      </div>

      {data && shown.length === 0 && (
        <p className="rules-draft-note">
          {moves.length === 0 ? 'No moves yet this season. The first add or drop shows here within five minutes.' : 'No moves for that team yet.'}
        </p>
      )}

      {days.map((day) => (
        <section key={day.key} className="activity-day">
          <h2 className="hub-heading activity-day-head">{day.label}</h2>
          <ol className="league-activity">
            {day.moves.map((move) => (
              <li key={move.id} className={`activity-move is-${move.kind}`}>
                <div className="league-activity-head">
                  <span className={`activity-kind is-${move.kind}`}>{KIND_LABEL[move.kind]}</span>
                  <strong>{move.title}</strong>
                  <span>{formatWhen(move.at)}</span>
                </div>
                {move.lines.map((line) => <div key={line} className="league-activity-line">{line}</div>)}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
