/**
 * Session persistence (survives page refresh, cleared when tab closes).
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
