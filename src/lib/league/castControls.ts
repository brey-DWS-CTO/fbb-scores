/** Score-page Cast entries open the contextual panel without changing the URL. */
export const OPEN_CAST_EVENT = 'nerds:open-cast';
export function isCastScorePage(pathname: string): boolean {
  return pathname === '/scores' || (pathname.startsWith('/scores/') && pathname !== '/scores/cast');
}
export function openCastDock(): void { window.dispatchEvent(new Event(OPEN_CAST_EVENT)); }
