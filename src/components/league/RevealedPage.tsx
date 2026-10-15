import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import SignInPanel from './SignInPanel.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchAchievements, type AchievementsResponse } from '../../lib/league/api.js';

/**
 * Every other team as a card, its keeper slots either revealed or still a
 * "?". The reveal button sits on top; the achievements that earn reveals live
 * on their own tab.
 */
export default function RevealedPage() {
  const { identity } = useIdentity();
  const { meta } = useLeagueData();
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
        <SignInPanel reason="Sign in to see the keepers you have revealed." />
      </main>
    );
  }

  const you = data?.you;
  const others = (data?.standings ?? []).map((row) => row.owner).filter((owner) => owner !== identity.owner);
  const seen = you ? you.teams.reduce((n, t) => n + t.shown.length, 0) : 0;

  return (
    <main className="rules-page achieve-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="unlocked" size={18} className="icon-in-heading" />
            REVEALED
          </h1>
          <p>Keepers you have unlocked. Boards and mocks use them over your guesses.</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!data && !error && <div className="panel rules-empty">Loading.</div>}

      {data && you && (
        <>
          <section className="panel achieve-reveal achieve-reveal-bar">
            <div className="achieve-ready">
              {you.check.reason !== 'commish' && you.check.reason !== 'public' && (
                <>
                  <span className="achieve-ready-count">{you.left}</span>
                  <span className="achieve-ready-label">{you.left === 1 ? 'REVEAL READY' : 'REVEALS READY'}</span>
                </>
              )}
            </div>
            {you.check.ok ? (
              <button
                type="button"
                className="rule-edit-save tap-btn achieve-reveal-btn"
                onClick={() => navigate('/achievements/reveal', { state: { spin: true } })}
              >
                <NavIcon name="unlocked" size={16} className="icon-in-heading" />
                REVEAL A KEEPER
              </button>
            ) : (
              <p className="rule-edit-hint">{you.check.message}</p>
            )}
            <span className="achieve-muted">{seen} {seen === 1 ? 'keeper' : 'keepers'} seen so far.</span>
          </section>

          <ul className="vault-grid">
            {others.map((owner) => {
              const team = you.teams.find((t) => t.target === owner);
              const saved = meta?.keeperStatus?.[owner] ?? team?.keeping ?? 0;
              const shown = team?.shown ?? [];
              const hidden = Math.max(0, saved - shown.filter((s) => s.playerName).length);
              return (
                <li key={owner} className={shown.length > 0 ? 'vault-card has-shown' : 'vault-card'}>
                  <span className="vault-team">{owner.toUpperCase()}</span>
                  {saved === 0 && shown.length === 0 ? (
                    <span className="achieve-muted">No keepers in yet</span>
                  ) : (
                    <>
                      {shown.map((s) => (
                        <span key={s.playerKey} className={s.playerName ? 'vault-slot is-open' : 'vault-slot is-gone'}>
                          {s.playerName ?? 'Since dropped'}
                        </span>
                      ))}
                      {Array.from({ length: hidden }, (_, i) => (
                        <span key={`h${i}`} className="vault-slot">
                          <NavIcon name="lock" size={13} /> ?
                        </span>
                      ))}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
