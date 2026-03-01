/**
 * Session persistence (survives page refresh, cleared when tab closes).
 * URL helpers live here too since they're tightly coupled.
 */

const KEY = 'spyfall_session';

export const session = {
  save(roomCode, playerName) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ roomCode, playerName })); } catch {}
  },
  load() {
    try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
  },
  clear() {
    try { sessionStorage.removeItem(KEY); } catch {}
  },
};

/** Extract room code from path like /room/ABC123 → "ABC123", or null. */
export function getUrlCode() {
  const m = window.location.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/i);
  return m ? m[1].toUpperCase() : null;
}

export function pushRoomUrl(code) {
  const target = `/room/${code}`;
  if (window.location.pathname !== target) history.pushState(null, '', target);
}

export function clearRoomUrl() {
  if (window.location.pathname !== '/') history.pushState(null, '', '/');
}
