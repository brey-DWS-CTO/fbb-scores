import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import SignInPanel from './SignInPanel.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchAchievements,
  type AchievementsResponse,
} from '../../lib/league/api.js';
import {
  ACHIEVEMENTS,
  MOCKS_FOR_ADDICT,
  MOCKS_FOR_MARATHON,
  PROPS_FOR_BOOKMAKER,
  SIDES_FOR_ACTION,
  type AchievementId,
  type OwnerFacts,
} from '../../lib/league/achievements.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The list in groups, each with where to go to earn them. */
const GROUPS: ReadonlyArray<{ label: string; to: string; ids: AchievementId[] }> = [
  { label: 'RULE BOOK', to: '/rules', ids: ['signed', 'hancock'] },
  {
    label: 'MOCK DRAFTS',
    to: '/mock',
    ids: ['first-mock', 'ten-mocks', 'marathon', 'honor-roll', 'valedictorian', 'thief', 'what-if'],
  },
  { label: 'TRADES', to: '/trades', ids: ['trade-offer', 'haggler', 'closer', 'taker'] },
  { label: 'PROP BETS', to: '/props', ids: ['prop-bet', 'bookmaker', 'action', 'all-in'] },
  { label: 'VOTES', to: '/votes', ids: ['voted', 'lawmaker'] },
  { label: 'KEEPER GUESSES', to: '/keepers', ids: ['scout', 'close-call'] },
  { label: 'DUES', to: '/dues', ids: ['dues'] },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** A progress line for the ones that take more than one go. */
function progress(id: AchievementId, facts: OwnerFacts): string | null {
  const of = (n: number, goal: number) => `${Math.min(n, goal)} of ${goal} done`;
  if (id === 'ten-mocks') return of(facts.mocksFinished, MOCKS_FOR_ADDICT);
  if (id === 'marathon') return of(facts.mocksFinished, MOCKS_FOR_MARATHON);
  if ((id === 'honor-roll' || id === 'valedictorian') && facts.bestMockGrade) return `Best so far: ${facts.bestMockGrade}`;
  if (id === 'thief' && facts.bestSteal > 0) return `Best steal so far: ${facts.bestSteal} picks`;
  if (id === 'bookmaker') return of(facts.propBetsSet, PROPS_FOR_BOOKMAKER);
  if (id === 'action') return of(facts.propSidesTaken, SIDES_FOR_ACTION);
  return null;
}

/**
 * Achievements. Each one shows one keeper, from a random team.
 */
export default function AchievementsPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    fetchAchievements(identity)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to see your achievements." />
      </main>
    );
  }

  // The reveal plays out on its own screen, slot machine and all.
  const reveal = () => navigate('/achievements/reveal', { state: { spin: true } });

  const you = data?.you;
  const earnedTotal = you ? ACHIEVEMENTS.filter((a) => you.earned[a.id]).length : 0;
  // Newest first, so a fresh reveal lands on top.
  const teams = you ? [...you.teams].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) : [];

  return (
    <main className="rules-page achieve-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="trophy" size={18} className="icon-in-heading" />
            ACHIEVEMENTS
          </h1>
          <p>Each one shows you one keeper from a random team.</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!data && !error && <div className="panel rules-empty">Loading achievements.</div>}

      {data && you && (
        <>
          <section className="panel achieve-reveal">
            <span className="hub-heading achieve-title">YOUR REVEALS</span>
            {/* A count nobody can spend is noise: the commish sees every keeper, and public keepers need no reveal. */}
            {you.check.reason !== 'commish' && you.check.reason !== 'public' && (
              <div className="achieve-ready">
                <span className="achieve-ready-count">{you.left}</span>
                <span className="achieve-ready-label">{you.left === 1 ? 'REVEAL READY' : 'REVEALS READY'}</span>
              </div>
            )}
            {you.check.ok ? (
              <button type="button" className="rule-edit-save tap-btn achieve-reveal-btn" onClick={reveal}>
                <NavIcon name="unlocked" size={16} className="icon-in-heading" />
                REVEAL A KEEPER
              </button>
            ) : (
              <p className="rule-edit-hint">{you.check.message}</p>
            )}

            {teams.length > 0 && (
              <ul className="achieve-seen">
                {teams.map((team) => {
                  return (
                    <li key={team.target} className="achieve-seen-card">
                      <span className="achieve-seen-team">
                        {team.target.toUpperCase()} KEEPS · {team.shown.length} OF {Math.max(team.keeping, team.shown.length)} SHOWN
                      </span>
                      {team.shown.map((s) =>
                        s.playerName ? (
                          <span key={s.playerKey} className="achieve-seen-names">{s.playerName}</span>
                        ) : (
                          <span key={s.playerKey} className="achieve-seen-names achieve-muted">A player they have since dropped</span>
                        ),
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <span className="hub-heading achieve-title">
              YOUR ACHIEVEMENTS · {earnedTotal} OF {ACHIEVEMENTS.length}
            </span>
            {GROUPS.map((group) => (
              <div key={group.label} className="achieve-group">
                <span className="achieve-group-label">{group.label}</span>
                <ul className="achieve-list">
                  {group.ids.map((id) => {
                    const a = BY_ID.get(id);
                    if (!a) return null;
                    const at = you.earned[id];
                    const line = at ? null : progress(id, you.facts);
                    return (
                      <li key={id} className={at ? 'achieve-item achieve-done' : 'achieve-item'}>
                        <NavIcon name={at ? 'star' : 'lock'} size={20} className="achieve-icon" />
                        <span className="achieve-body">
                          <span className="achieve-name">{a.title}</span>
                          <span className="achieve-how">{a.how}</span>
                          {line && <span className="achieve-muted">{line}</span>}
                        </span>
                        {at ? (
                          <span className="achieve-when">{formatDay(at)}</span>
                        ) : (
                          <Link className="achieve-go tap-btn" to={group.to}>GO</Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
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
                    {row.revealed} {row.revealed === 1 ? 'keeper' : 'keepers'} seen
                  </span>
                </li>
              ))}
            </ol>
            <p className="rule-edit-hint">Only you see which keepers you have seen.</p>
          </section>
        </>
      )}
    </main>
  );
}
