import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import SignInPanel from './SignInPanel.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchAchievements,
  revealKeeper,
  type AchievementsResponse,
} from '../../lib/league/api.js';
import {
  ACHIEVEMENTS,
  MOCKS_FOR_ADDICT,
  type AchievementId,
  type OwnerFacts,
} from '../../lib/league/achievements.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Where to go to earn each one. */
const WHERE: Record<AchievementId, { to: string; label: string }> = {
  signed: { to: '/rules', label: 'RULE BOOK' },
  'first-mock': { to: '/mock', label: 'MOCK DRAFT' },
  'ten-mocks': { to: '/mock', label: 'MOCK DRAFT' },
  'honor-roll': { to: '/mock', label: 'MOCK DRAFT' },
  'trade-offer': { to: '/trades', label: 'TRADES' },
  'trade-done': { to: '/trades', label: 'TRADES' },
  'prop-bet': { to: '/props', label: 'PROP BETS' },
  voted: { to: '/votes', label: 'VOTES' },
  scout: { to: '/keepers', label: 'KEEPERS' },
  dues: { to: '/dues', label: 'DUES' },
};

/** A progress line for the ones that take more than one go. */
function progress(id: AchievementId, facts: OwnerFacts): string | null {
  if (id === 'ten-mocks') return `${Math.min(facts.mocksFinished, MOCKS_FOR_ADDICT)} of ${MOCKS_FOR_ADDICT} done`;
  if (id === 'honor-roll' && facts.bestMockGrade) return `Best so far: ${facts.bestMockGrade}`;
  return null;
}

/**
 * Achievements. Each one earns a look at one other team's keepers, picked at
 * random from the teams that have keepers in.
 */
export default function AchievementsPage() {
  const { identity } = useIdentity();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      setData(await fetchAchievements(identity));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to see your achievements." />
      </main>
    );
  }

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await revealKeeper(identity);
      setData(next);
      setFresh(next.revealed ?? null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const you = data?.you;
  const earnedTotal = you ? ACHIEVEMENTS.filter((a) => you.earned[a.id]).length : 0;
  // Newest first, so a fresh reveal lands on top.
  const reveals = you ? [...you.reveals].reverse() : [];

  return (
    <main className="rules-page achieve-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="trophy" size={18} className="icon-in-heading" />
            ACHIEVEMENTS
          </h1>
          <p>
            Each achievement lets you see one other team's keepers, picked at random. There are{' '}
            {ACHIEVEMENTS.length} to earn and 9 teams to see.
          </p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!data && !error && <div className="panel rules-empty">Loading achievements.</div>}

      {data && you && (
        <>
          <section className="panel achieve-reveal">
            <span className="hub-heading achieve-title">YOUR REVEALS</span>
            <div className="achieve-ready">
              <span className="achieve-ready-count">{you.left}</span>
              <span className="achieve-ready-label">{you.left === 1 ? 'REVEAL READY' : 'REVEALS READY'}</span>
            </div>
            {you.check.ok ? (
              <button type="button" className="rule-edit-save tap-btn achieve-reveal-btn" disabled={busy} onClick={reveal}>
                <NavIcon name="unlocked" size={16} className="icon-in-heading" />
                REVEAL A KEEPER
              </button>
            ) : (
              <p className="rule-edit-hint">{you.check.message}</p>
            )}

            {reveals.length > 0 && (
              <ul className="achieve-seen">
                {reveals.map((r) => (
                  <li key={r.target} className={r.target === fresh ? 'achieve-seen-card achieve-seen-new' : 'achieve-seen-card'}>
                    <span className="achieve-seen-team">{r.target.toUpperCase()} KEPT</span>
                    {r.keepers.length > 0 ? (
                      <span className="achieve-seen-names">{r.keepers.map((k) => k.playerName).join(' and ')}</span>
                    ) : (
                      <span className="achieve-seen-names achieve-muted">No keepers in right now.</span>
                    )}
                    <span className="achieve-muted">Seen {formatDay(r.at)}. This updates if they change.</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <span className="hub-heading achieve-title">
              YOUR ACHIEVEMENTS · {earnedTotal} OF {ACHIEVEMENTS.length}
            </span>
            <ul className="achieve-list">
              {ACHIEVEMENTS.map((a) => {
                const at = you.earned[a.id];
                const where = WHERE[a.id];
                const line = at ? null : progress(a.id, you.facts);
                return (
                  <li key={a.id} className={at ? 'achieve-item achieve-done' : 'achieve-item'}>
                    <NavIcon name={at ? 'star' : 'lock'} size={20} className="achieve-icon" />
                    <span className="achieve-body">
                      <span className="achieve-name">{a.title}</span>
                      <span className="achieve-how">{a.how}</span>
                      {line && <span className="achieve-muted">{line}</span>}
                    </span>
                    {at ? (
                      <span className="achieve-when">{formatDay(at)}</span>
                    ) : (
                      <Link className="achieve-go tap-btn" to={where.to}>
                        {where.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <span className="hub-heading achieve-title">LEAGUE BOARD</span>
            <ol className="achieve-board">
              {data.standings.map((row) => (
                <li key={row.owner} className={row.owner === you.owner ? 'achieve-row achieve-row-me' : 'achieve-row'}>
                  <span className="achieve-row-owner">{row.owner}</span>
                  <span className="achieve-bar" aria-hidden="true">
                    <span className="achieve-bar-fill" style={{ width: `${(row.earned / ACHIEVEMENTS.length) * 100}%` }} />
                  </span>
                  <span className="achieve-row-count">
                    {row.earned}/{ACHIEVEMENTS.length}
                  </span>
                  <span className="achieve-muted achieve-row-seen">
                    {row.revealed} {row.revealed === 1 ? 'team' : 'teams'} seen
                  </span>
                </li>
              ))}
            </ol>
            <p className="rule-edit-hint">Only you see whose keepers you have seen.</p>
          </section>
        </>
      )}
    </main>
  );
}
