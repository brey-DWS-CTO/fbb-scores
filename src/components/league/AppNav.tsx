import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import NavIcon, { type NavIconName } from './NavIcon.js';

type NavItem = {
  to: string;
  label: string;
  icon: NavIconName;
  primary?: boolean;
  commishOnly?: boolean;
};

// One list drives both bars. `primary` items sit on the phone's bottom bar;
// the rest live behind MORE. Desktop shows every page in the sidebar.
const NAV: NavItem[] = [
  { to: '/keepers', label: 'KEEPERS', icon: 'lock', primary: true },
  { to: '/draft', label: 'DRAFT', icon: 'target', primary: true },
  { to: '/teams', label: 'TEAMS', icon: 'people', primary: true },
  { to: '/trades', label: 'TRADES', icon: 'arrows', primary: true },
  { to: '/rules', label: 'RULEBOOK', icon: 'book' },
  { to: '/votes', label: 'VOTES', icon: 'ballot' },
  { to: '/league', label: 'LEAGUE HQ', icon: 'home' },
  { to: '/history', label: 'HISTORY', icon: 'trophy' },
  { to: '/schedule', label: 'SCHEDULE', icon: 'calendar', commishOnly: true },
  { to: '/admin', label: 'COMMISH', icon: 'shield', commishOnly: true },
];


type MenuId = 'league' | 'rules' | 'commish';

const MENU_GROUPS: Array<{ id: MenuId; label: string; routes: string[] }> = [
  { id: 'league', label: 'LEAGUE', routes: ['/league', '/history'] },
  { id: 'rules', label: 'RULES', routes: ['/rules', '/votes'] },
  { id: 'commish', label: 'COMMISH', routes: ['/admin', '/schedule'] },
];

function TradeBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="nav-badge" aria-label={`${count} offers waiting`}>
      {count}
    </span>
  );
}

export default function AppNav() {
  const { identity } = useIdentity();
  const { meta } = useLeagueState();
  const location = useLocation();
  // The sheet is open only for the path it was opened on, so navigating
  // anywhere closes it without an effect.
  const [moreAnchor, setMoreAnchor] = useState<string | null>(null);
  const moreOpen = moreAnchor === location.pathname;
  const setMoreOpen = (open: boolean) => setMoreAnchor(open ? location.pathname : null);

  // Offers waiting on this member. The server counts them, so the badge cannot
  // give away an offer between two other teams.
  const pendingTrades = meta?.pendingTrades ?? 0;

  const items = NAV.filter((t) => !t.commishOnly || identity?.isCommissioner);
  const primary = items.filter((t) => t.primary);
  const secondary = items.filter((t) => !t.primary);
  const moreActive = secondary.some((t) => location.pathname.startsWith(t.to));

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreAnchor(null);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [moreOpen]);



  return (
    <>
      <header className="top-nav">
        <div className="top-nav-inner">
          <NavLink to="/keepers" className="top-nav-brand hub-heading">
            <img src="/logo.png" alt="" aria-hidden="true" />
            <span>FBB Scores</span>
          </NavLink>
          <nav className="top-nav-links" aria-label="Main">
            {items.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => (isActive ? 'top-nav-link hub-heading active' : 'top-nav-link hub-heading')}
              >
                <span aria-hidden="true"><NavIcon name={t.icon} /></span><span>{t.label}</span>
                {t.to === '/trades' && pendingTrades > 0 && (
                  <span className="nav-pill" aria-label={`${pendingTrades} offers waiting`}>
                    {pendingTrades}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="top-nav-account">
            <IdentityChip placement="nav" />
          </div>
        </div>
      </header>


      <nav className="bottom-nav" aria-label="Main">
        {primary.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => (isActive ? 'bottom-nav-tab active' : 'bottom-nav-tab')}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              <NavIcon name={t.icon} />
              {t.to === '/trades' && <TradeBadge count={pendingTrades} />}
            </span>
            <span className="hub-heading bottom-nav-label">{t.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={moreActive || moreOpen ? 'bottom-nav-tab tap-btn active' : 'bottom-nav-tab tap-btn'}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <span className="bottom-nav-icon" aria-hidden="true"><NavIcon name="menu" /></span>
          <span className="hub-heading bottom-nav-label">MORE</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-drawer" role="dialog" aria-modal="true" aria-label="More pages">
            <div className="more-drawer-head">
              <span className="hub-heading more-drawer-title">More</span>
              <button
                type="button"
                className="tap-btn more-drawer-close"
                aria-label="Close menu"
                onClick={() => setMoreOpen(false)}
              >
                <NavIcon name="close" />
              </button>
            </div>
            <div className="more-list">
              {MENU_GROUPS.map((group) => {
                const groupItems = secondary.filter((item) => group.routes.includes(item.to));
                if (groupItems.length === 0) return null;
                return (
                  <section className="more-section" key={group.id} aria-labelledby={`more-${group.id}`}>
                    <h2 className="more-section-title hub-heading" id={`more-${group.id}`}>{group.label}</h2>
                    {groupItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => (isActive ? 'more-item active' : 'more-item')}
                        onClick={() => setMoreOpen(false)}
                      >
                        <span className="more-item-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
                        <span className="hub-heading more-item-label">{item.label === 'LEAGUE' ? 'LEAGUE HQ' : item.label === 'RULES' ? 'RULEBOOK' : item.label}</span>
                      </NavLink>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
