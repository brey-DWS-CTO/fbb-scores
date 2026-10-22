import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { leagueActivity, mergedActivity } from '../../lib/league/activity.js';
import { fetchTransactions } from '../../lib/league/api.js';
import { movesOf, type Move } from '../../lib/league/transactions.js';

import IdentityChip from './IdentityChip.js';
import RecordTables from './RecordTables.js';
import ScoringTable from './ScoringTable.js';
import LmAddPanel from './LmAddPanel.js';
import LeagueOffseasonPage from './LeagueOffseasonPage.js';

function Section({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color, marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

/** A moment in the activity log: "Oct 14, 3:05 PM". */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** In-season league hub, led by recent activity. */
export default function LeaguePage() {
  const { dataset, state, seasonMode } = useLeagueData();
  const { identity, signOut } = useIdentity();
  const trades = useMemo(() => leagueActivity(state.pickTradeProposals ?? [], dataset), [state.pickTradeProposals, dataset]);
  const [moves, setMoves] = useState<Move[]>([]);
  useEffect(() => {
    if (seasonMode !== 'in-season') return;
    let alive = true;
    // ESPN moves join the log when they load; the page is whole without them.
    fetchTransactions()
      .then((feed) => { if (alive) setMoves(movesOf(feed.rows)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [seasonMode]);
  const activity = useMemo(() => mergedActivity(trades, moves), [trades, moves]);

  if (seasonMode === 'off-season') return <LeagueOffseasonPage />;


  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <h1
          className="hub-heading glow-purple"
          style={{ fontSize: '0.85rem', color: 'var(--neon-purple)', margin: 0, lineHeight: 1.6 }}
        >
          LEAGUE HQ
        </h1>
        <IdentityChip />
      </div>

      {/* ── Activity: pick trades and ESPN moves, newest first ── */}
      <Section title="ACTIVITY" color="var(--neon-yellow)">
        {activity.length === 0 ? (
          <div style={{ color: 'var(--text-faint)' }}>No trades or moves yet. When one goes through, it shows here.</div>
        ) : (
          <ol className="league-activity">
            {activity.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                <div className="league-activity-head">
                  <strong>{entry.title}</strong>
                  <span>{formatWhen(entry.at)}</span>
                </div>
                {entry.lines.map((line) => <div key={line} className="league-activity-line">{line}</div>)}
              </li>
            ))}
          </ol>
        )}
        <div style={{ marginTop: 10, fontSize: '0.7rem' }}>
          <Link to="/activity" style={{ color: 'var(--neon-yellow)' }}>EVERY MOVE THIS SEASON →</Link>
        </div>
      </Section>

      <div className="league-season-actions">
        <Link className="league-lm-highlight" to="/lm-adds"><strong>LM Adds</strong><span>Advance claims and eligible-day adds →</span></Link>
        <Link className="tap-btn mock-mini-btn" to="/waivers">Waiver Calendar →</Link>
      </div>
      <LmAddPanel compact />

      {/* ── d. Account ─────────────────────────────────────────── */}
      <Section title="SCORING SYSTEM" color="var(--neon-purple)">
        <ScoringTable />
      </Section>

      <Section title="RECORD BOOK" color="var(--neon-teal)">
        <RecordTables />
      </Section>

      <Section title="ACCOUNT" color="var(--neon-yellow)">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <IdentityChip />
          {identity && (
            <button
              className="tap-btn"
              onClick={signOut}
              style={{
                minHeight: 44,
                padding: '0 14px',
                background: 'transparent',
                border: '2px solid var(--panel-border)',
                borderRadius: 8,
                color: 'var(--text-mid)',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              sign out
            </button>
          )}
        </div>
      </Section>

    </div>
  );
}
