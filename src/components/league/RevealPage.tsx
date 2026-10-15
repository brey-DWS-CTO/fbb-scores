import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import NavIcon from './NavIcon.js';
import Confetti from './Confetti.js';
import SignInPanel from './SignInPanel.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchAchievements, revealKeeper, type AchievementsResponse } from '../../lib/league/api.js';
import { reelSchedule } from '../../lib/league/reel.js';

type Phase = 'ready' | 'spinning' | 'flipping' | 'done';

interface Landed {
  target: string;
  playerName: string;
  shownOf: number;
  keeping: number;
}

const prefersLessMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The keeper reveal, played like a slot machine: team names spin, slow down
 * and land, then a card flips over to show the player.
 *
 * Spinning spends a reveal, so it never starts on a bare page load. It starts
 * on its own only when the toast or the achievements page sent you here.
 */
export default function RevealPage() {
  const { identity } = useIdentity();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [reelName, setReelName] = useState('?');
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const asked = useRef((location.state as { spin?: boolean } | null)?.spin === true);

  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const load = useCallback(async () => {
    if (!identity) return null;
    try {
      const next = await fetchAchievements(identity);
      setData(next);
      return next;
    } catch (e) {
      setError(apiErrorMessage(e));
      return null;
    }
  }, [identity]);

  const spin = useCallback(async (current: AchievementsResponse) => {
    if (!identity) return;
    setError(null);
    setLanded(null);
    setPhase('spinning');
    const teams = current.standings.map((row) => row.owner).filter((owner) => owner !== identity.owner);
    // Start the wheel while the server picks, so the wait is part of the show.
    let i = 0;
    const idle = window.setInterval(() => {
      setReelName(teams[i % teams.length] ?? '?');
      i += 1;
    }, 70);
    try {
      const result = await revealKeeper(identity);
      window.clearInterval(idle);
      setData(result);
      // The board and mocks read revealed keepers from league state; fetch it now.
      void queryClient.invalidateQueries({ queryKey: ['league-state'] });
      const pick = result.revealed;
      const team = pick ? result.you.teams.find((t) => t.target === pick.target) : undefined;
      const shown = team?.shown.find((s) => s.playerKey === pick?.playerKey);
      if (!pick || !team || !shown) throw new Error('The reveal came back empty. Try again.');
      const land: Landed = {
        target: pick.target,
        playerName: shown.playerName ?? 'A player they have since dropped',
        shownOf: team.shown.length,
        keeping: Math.max(team.keeping, team.shown.length),
      };
      if (prefersLessMotion()) {
        setReelName(land.target);
        setLanded(land);
        setPhase('done');
        return;
      }
      // Slow the wheel down and land it on the team the server picked.
      for (const step of reelSchedule(teams, land.target)) {
        timers.current.push(window.setTimeout(() => setReelName(step.name), step.at));
      }
      const stop = reelSchedule(teams, land.target).at(-1)?.at ?? 0;
      timers.current.push(window.setTimeout(() => {
        setLanded(land);
        setPhase('flipping');
      }, stop + 500));
      timers.current.push(window.setTimeout(() => setPhase('done'), stop + 1300));
    } catch (e) {
      window.clearInterval(idle);
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiErrorMessage(e));
      setPhase('ready');
      setReelName('?');
      void load();
    }
  }, [identity, load, queryClient]);

  // Load, and spin straight away only when sent here to spin.
  useEffect(() => {
    void (async () => {
      const current = await load();
      if (current && asked.current && current.you.check.ok) {
        asked.current = false;
        // Clear the request so a refresh does not spend another reveal.
        navigate(location.pathname, { replace: true, state: null });
        void spin(current);
      }
    })();
    // Runs once on arrival; spin and load are stable for this identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to reveal a keeper." />
      </main>
    );
  }

  const you = data?.you;
  const canSpin = phase !== 'spinning' && phase !== 'flipping' && you?.check.ok === true;

  return (
    <main className="rules-page reveal-page">
      {phase === 'done' && <Confetti key={landed?.target ?? 'x'} />}
      <div className={`reveal-stage reveal-${phase}`}>
        <span className="hub-heading reveal-kicker">
          <NavIcon name="unlocked" size={16} className="icon-in-heading" />
          KEEPER REVEAL
        </span>

        <div className="reveal-reel" aria-live="polite">
          <span className="reveal-reel-name">{reelName.toUpperCase()}</span>
          <span className="reveal-reel-keeps">{phase === 'ready' ? 'WHO WILL IT BE?' : 'KEEPS'}</span>
        </div>

        <div className={landed && phase !== 'spinning' ? 'reveal-card is-flipped' : 'reveal-card'}>
          <div className="reveal-card-face reveal-card-back" aria-hidden={landed !== null && phase !== 'spinning'}>
            ?
          </div>
          <div className="reveal-card-face reveal-card-front">
            {landed && (
              <>
                <span className="reveal-player">{landed.playerName}</span>
                <span className="reveal-of">
                  {landed.shownOf} OF {landed.keeping} {landed.target.toUpperCase()} KEEPERS SHOWN
                </span>
              </>
            )}
          </div>
        </div>

        {error && <p className="rules-draft-error">{error}</p>}

        <div className="reveal-actions">
          {canSpin && (
            <button type="button" className="unlock-go tap-btn" onClick={() => data && void spin(data)}>
              {phase === 'done' ? `SPIN AGAIN · ${you?.left ?? 0} LEFT` : 'SPIN'}
            </button>
          )}
          {!canSpin && phase !== 'spinning' && phase !== 'flipping' && you && (
            <p className="rule-edit-hint reveal-hint">{you.check.message}</p>
          )}
          <Link className="unlock-later tap-btn" to="/revealed">
            SEE ALL YOUR REVEALS
          </Link>
        </div>
      </div>
    </main>
  );
}
