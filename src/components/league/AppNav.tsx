import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';

type NavItem = {
  to: string;
  label: string;
  icon: string;
  primary?: boolean;
  commishOnly?: boolean;
};

// One list drives both bars. `primary` items sit on the phone's bottom bar;
// the rest live behind MORE. Desktop shows everything in the top bar.
const NAV: NavItem[] = [
  { to: '/keepers', label: 'KEEPERS', icon: '🔒', primary: true },
  { to: '/draft', label: 'DRAFT', icon: '🎯', primary: true },
  { to: '/teams', label: 'TEAMS', icon: '👥', primary: true },
  { to: '/trades', label: 'TRADES', icon: '🔁', primary: true },
  { to: '/rules', label: 'RULES', icon: '📖' },
  { to: '/votes', label: 'VOTES', icon: '🗳' },
  { to: '/league', label: 'LEAGUE', icon: '🏀' },
  { to: '/history', label: 'HISTORY', icon: '🏆' },
  { to: '/schedule', label: 'SCHEDULE', icon: '📅', commishOnly: true },
  { to: '/admin', label: 'COMMISH', icon: '👑', commishOnly: true },
];

const DESKTOP_STANDALONE = ['/keepers', '/draft', '/teams', '/trades'];

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
  const [desktopAnchor, setDesktopAnchor] = useState<{ id: MenuId; key: string } | null>(null);
  const desktopMenu = desktopAnchor?.key === location.key ? desktopAnchor.id : null;
  const setDesktopMenu = (id: MenuId | null) => setDesktopAnchor(id ? { id, key: location.key } : null);
  const moreOpen = moreAnchor === location.pathname;
  const setMoreOpen = (open: boolean) => setMoreAnchor(open ? location.pathname : null);

  // Offers waiting on this member. The server counts them, so the badge cannot
  // give away an offer between two other teams.
  const pendingTrades = meta?.pendingTrades ?? 0;

  const items = NAV.filter((t) => !t.commishOnly || identity?.isCommissioner);
  const primary = items.filter((t) => t.primary);
  const secondary = items.filter((t) => !t.primary);
  const moreActive = secondary.some((t) => location.pathname.startsWith(t.to));
  const standalone = items.filter((t) => DESKTOP_STANDALONE.includes(t.to));

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

  useEffect(() => {
    if (!desktopMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        document.getElementById(`nav-trigger-${desktopMenu}`)?.focus();
        setDesktopAnchor(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktopMenu]);

  return (
    <>
      <header className="top-nav">
        <div className="top-nav-inner">
          <NavLink to="/keepers" className="top-nav-brand hub-heading">
            <img src="/logo.png" alt="" aria-hidden="true" />
            <span>FBB Scores</span>
          </NavLink>
          <nav className="top-nav-links" aria-label="Main">
            {standalone.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => (isActive ? 'top-nav-link hub-heading active' : 'top-nav-link hub-heading')}
              >
                <span>{t.label}</span>
                {t.to === '/trades' && pendingTrades > 0 && (
                  <span className="nav-pill" aria-label={`${pendingTrades} offers waiting`}>
                    {pendingTrades}
                  </span>
                )}
              </NavLink>
            ))}
            {MENU_GROUPS.map((group) => {
              const groupItems = items.filter((item) => group.routes.includes(item.to));
              if (groupItems.length === 0) return null;
              const open = desktopMenu === group.id;
              const active = groupItems.some((item) => location.pathname.startsWith(item.to));
              return (
                <div className="top-nav-group" key={group.id}>
                  <button
                    type="button"
                    className={active || open ? 'top-nav-link top-nav-trigger hub-heading active' : 'top-nav-link top-nav-trigger hub-heading'}
                    aria-expanded={open}
                    id={`nav-trigger-${group.id}`}
                    aria-controls={`nav-links-${group.id}`}
                    onClick={() => setDesktopMenu(open ? null : group.id)}
                  >
                    {group.label}
                    <span className="top-nav-chevron" aria-hidden="true">▾</span>
                  </button>
                  {open && (
                    <div className="top-nav-menu" id={`nav-links-${group.id}`}>
                      {groupItems.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) => (isActive ? 'top-nav-menu-item active' : 'top-nav-menu-item')}
                          onClick={() => setDesktopMenu(null)}
                        >
                          <span className="top-nav-menu-icon" aria-hidden="true">{item.icon}</span>
                          <span>
                            <strong>{item.label === 'LEAGUE' ? 'LEAGUE HQ' : item.label === 'RULES' ? 'RULEBOOK' : item.label}</strong>
                            <small>{item.to === '/league' ? 'Scoring, records, and league info' : item.to === '/history' ? 'Seasons, champions, and records' : item.to === '/rules' ? 'Read and search the constitution' : item.to === '/votes' ? 'Proposals and league decisions' : item.to === '/admin' ? 'Draft and keeper controls' : 'NBA weeks and playoff grid'}</small>
                          </span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <div className="top-nav-account">
            <IdentityChip placement="nav" />
          </div>
        </div>
      </header>

      {desktopMenu && <button className="desktop-nav-backdrop" type="button" aria-label="Close navigation menu" onClick={() => setDesktopMenu(null)} />}

      <nav className="bottom-nav" aria-label="Main">
        {primary.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => (isActive ? 'bottom-nav-tab active' : 'bottom-nav-tab')}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              {t.icon}
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
          <span className="bottom-nav-icon" aria-hidden="true">☰</span>
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
                ✕
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
                        <span className="more-item-icon" aria-hidden="true">{item.icon}</span>
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
