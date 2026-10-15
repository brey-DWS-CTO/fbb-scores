import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import NavIcon from './NavIcon.js';
import Confetti from './Confetti.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { fetchAchievementNews, markAchievementsSeen, sandboxActive } from '../../lib/league/api.js';
import { ACHIEVEMENTS, type AchievementId } from '../../lib/league/achievements.js';

/** Seconds before the toast carries you to the reveal on its own. */
const AUTO_REVEAL_SECONDS = 4;
/** Seconds before a toast with nothing to reveal tidies itself away. */
const AUTO_CLOSE_SECONDS = 8;
/** How often to look while the page sits open. Every change you make also looks. */
const POLL_MS = 60_000;

const TITLE = new Map(ACHIEVEMENTS.map((a) => [a.id, a.title]));

/*
 * Every change a member makes goes through axios. Rather than teach a dozen
 * pages to ask "did that earn something?", one listener hears each successful
 * write and rings this bell. The toast answers it.
 */
const listeners = new Set<() => void>();
let hooked = false;
function hookWrites(): void {
  if (hooked) return;
  hooked = true;
  axios.interceptors.response.use((response) => {
    const method = (response.config.method ?? 'get').toLowerCase();
    const url = response.config.url ?? '';
    if (method !== 'get' && url.startsWith('/api/league/') && !url.startsWith('/api/league/achievements')) {
      for (const listener of listeners) listener();
    }
    return response;
  });
}

interface Shown {
  ids: AchievementId[];
  left: number;
  canReveal: boolean;
}

/**
 * The big "ACHIEVEMENT UNLOCKED" moment. Pops over whatever page you are on,
 * then counts down and takes you to spin for a keeper.
 */
export default function AchievementToast() {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [shown, setShown] = useState<Shown | null>(null);
  const [count, setCount] = useState(0);
  const busy = useRef(false);
  const timer = useRef<number | null>(null);
  // The reveal screen is its own celebration; hold news until you leave it.
  const onReveal = pathname.startsWith('/achievements/reveal');

  const check = useCallback(async () => {
    if (!identity || busy.current || shown || onReveal || sandboxActive()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    busy.current = true;
    try {
      const news = await fetchAchievementNews(identity);
      if (news.fresh.length === 0) return;
      setShown({ ids: news.fresh, left: news.left, canReveal: news.canReveal });
      setCount(news.canReveal ? AUTO_REVEAL_SECONDS : AUTO_CLOSE_SECONDS);
      // Seen the moment it shows, so a refresh or a second phone does not repeat it.
      await markAchievementsSeen(identity, news.fresh);
    } catch {
      /* a missed toast is no harm; the page still lists everything */
    } finally {
      busy.current = false;
    }
  }, [identity, shown, onReveal]);

  // Ring after writes, a little later so the server has stamped them.
  useEffect(() => {
    hookWrites();
    const ring = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void check(), 700);
    };
    listeners.add(ring);
    return () => {
      listeners.delete(ring);
    };
  }, [check]);

  // On arrival, on every page change, and now and then.
  useEffect(() => {
    void check();
  }, [check, pathname]);
  useEffect(() => {
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => window.clearInterval(id);
  }, [check]);

  const close = useCallback(() => setShown(null), []);
  const goReveal = useCallback(() => {
    setShown(null);
    navigate('/achievements/reveal', { state: { spin: true } });
  }, [navigate]);

  // The countdown: to the reveal when there is one, else to closing.
  useEffect(() => {
    if (!shown) return;
    if (count <= 0) {
      if (shown.canReveal) goReveal();
      else close();
      return;
    }
    const id = window.setTimeout(() => setCount((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [shown, count, goReveal, close]);

  if (!shown) return null;
  const many = shown.ids.length > 1;
  const reveals = Math.min(shown.left, shown.ids.length);

  return (
    <div className="unlock-backdrop" role="dialog" aria-modal="true" aria-labelledby="unlock-heading" onClick={close}>
      <Confetti />
      <div className="unlock-card" onClick={(e) => e.stopPropagation()}>
        <div className="unlock-burst" aria-hidden="true">
          <NavIcon name="trophy" size={44} />
        </div>
        <h2 id="unlock-heading" className="unlock-heading">
          {many ? `${shown.ids.length} ACHIEVEMENTS UNLOCKED` : 'ACHIEVEMENT UNLOCKED'}
        </h2>
        <ul className="unlock-names">
          {shown.ids.slice(0, 6).map((id) => (
            <li key={id}>{TITLE.get(id) ?? id}</li>
          ))}
          {shown.ids.length > 6 && <li className="unlock-more">and {shown.ids.length - 6} more</li>}
        </ul>
        {shown.canReveal ? (
          <>
            <p className="unlock-prize">
              +{reveals} KEEPER {reveals === 1 ? 'REVEAL' : 'REVEALS'}
            </p>
            <button type="button" className="unlock-go tap-btn" onClick={goReveal}>
              SPIN FOR A KEEPER · {count}
            </button>
            <button type="button" className="unlock-later tap-btn" onClick={close}>
              LATER
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="unlock-go tap-btn"
              onClick={() => {
                close();
                navigate('/achievements');
              }}
            >
              SEE ACHIEVEMENTS
            </button>
            <button type="button" className="unlock-later tap-btn" onClick={close}>
              CLOSE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
