import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import FantasyCastPage from './FantasyCastPage.js';
import NavIcon from './NavIcon.js';
import './fantasyCast.css';
import { castPageScope } from '../../lib/league/castContext.js';

type CastMode = 'float' | 'dock';
const MODE_KEY = 'nerds.cast.mode';
function savedMode(): CastMode {
  try { return window.localStorage.getItem(MODE_KEY) === 'dock' ? 'dock' : 'float'; }
  catch { return 'float'; }
}

export default function FantasyCastBubble() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [draggingTrigger, setDraggingTrigger] = useState(false);
  const movedTrigger = useRef(false);
  const [mode, setMode] = useState<CastMode>(savedMode);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const shell = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const move = (left: number, top: number) => {
    const rect = shell.current?.getBoundingClientRect();
    if (!rect) return;
    const navSpace = window.innerWidth < 840 ? 72 : 8;
    setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - rect.height - navSpace)) });
  };
  const visible = !dismissed && (pathname === '/scores' || (pathname.startsWith('/scores/') && pathname !== '/scores/cast'));
  const minimize = () => { restoreFocus.current = true; setOpen(false); };
  const changeMode = (next: CastMode) => {
    drag.current = null;
    setMode(next);
    try { window.localStorage.setItem(MODE_KEY, next); } catch { /* Works without persistence when storage is blocked. */ }
  };
  useEffect(() => {
    const keepOnScreen = () => {
      const rect = shell.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(previous => previous ? { left: Math.max(8, Math.min(previous.left, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(previous.top, window.innerHeight - rect.height - (window.innerWidth < 840 ? 72 : 8))) } : previous);
    };
    const observer = new ResizeObserver(keepOnScreen);
    if (shell.current) observer.observe(shell.current);
    window.addEventListener('resize', keepOnScreen);
    return () => { observer.disconnect(); window.removeEventListener('resize', keepOnScreen); };
  }, [visible]);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('cast-docked', open && visible && mode === 'dock');
    return () => document.documentElement.classList.remove('cast-docked');
  }, [open, visible, mode]);
  useEffect(() => {
    if (!open && restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; }
    if (!open || !visible) return;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { restoreFocus.current = true; setOpen(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, visible]);
  if (!visible) return null;
  const pageParams = new URLSearchParams(search);
  const scope = castPageScope(pathname, pageParams);
  const contextKey = [pathname, ...['date', 'week', 'day', 'demo', 'team', 'fantasyTeam'].map(key => pageParams.get(key))].join('|');
  return <aside ref={shell} style={(!open || mode === 'float') && position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined} className={`cast-bubble${open && mode === 'dock' ? ' is-docked' : ''}`} aria-label={`${mode === 'dock' ? 'Docked' : 'Floating'} Fantasy Cast`}>
    {open && <div id="floating-cast-panel" className="cast-bubble-panel" role="region" aria-label="Fantasy Cast mini feed">
      <div className="cast-bubble-toolbar"><button className="cast-drag-handle" type="button" disabled={mode === 'dock'} aria-label="Move Fantasy Cast. Drag or use arrow keys." onPointerDown={event => {
        if (mode !== 'float' || event.button !== 0) return;
        const rect = shell.current!.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => { const start = drag.current; if (start) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y); }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const rect = shell.current!.getBoundingClientRect();
        move(rect.left + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), rect.top + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0));
      }}><NavIcon name="bolt" size={15} /> Fantasy Cast{mode === 'float' && <NavIcon name="dots" size={14} />}</button><div className="cast-mode-switch"><button type="button" aria-label={mode === 'float' ? 'Dock Fantasy Cast' : 'Pop out Fantasy Cast'} onClick={() => changeMode(mode === 'float' ? 'dock' : 'float')}><NavIcon name={mode === 'float' ? 'book' : 'layers'} size={13} />{mode === 'float' ? 'Dock' : 'Pop out'}</button></div><Link to="/scores/cast" aria-label="Open full Fantasy Cast page" title="Full page">↗</Link><button ref={close} type="button" aria-label="Minimize Fantasy Cast" onClick={minimize}><NavIcon name="close" size={17} /></button></div>

      <div className="cast-bubble-scroll"><FantasyCastPage key={contextKey} embedded peek={mode === 'dock'} initialScope={scope} /></div>
    </div>}
    {!open && <div className="cast-launcher">
      <button ref={trigger} type="button" className="cast-bubble-trigger" aria-expanded={false} aria-label="Open Fantasy Cast mini feed. Drag to move." onPointerDown={event => {
        if (event.button !== 0) return;
        const rect = shell.current!.getBoundingClientRect();
        movedTrigger.current = false;
        drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const start = drag.current;
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) { movedTrigger.current = true; setDraggingTrigger(true); }
        if (movedTrigger.current) move(start.left + event.clientX - start.x, start.top + event.clientY - start.y);
      }} onPointerUp={event => {
        if (movedTrigger.current && event.clientY > window.innerHeight - 110 && Math.abs(event.clientX - window.innerWidth / 2) < 70) { setDismissed(true); setOpen(false); }
        drag.current = null; setDraggingTrigger(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { drag.current = null; setDraggingTrigger(false); }} onLostPointerCapture={() => { drag.current = null; setDraggingTrigger(false); }} onClick={() => {
        if (!movedTrigger.current) setOpen(true);
        movedTrigger.current = false;
      }}><NavIcon name="bolt" size={20} /><span>CAST</span></button>
      <button type="button" className="cast-launcher-dismiss" aria-label="Dismiss Fantasy Cast button" onClick={() => setDismissed(true)}><NavIcon name="close" size={16} /></button>
    </div>}
    {draggingTrigger && <div className="cast-dismiss-target" aria-hidden="true"><NavIcon name="close" size={22} />Drop to hide</div>}
  </aside>;
}
