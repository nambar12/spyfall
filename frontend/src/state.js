/**
 * Minimal reactive state store.
 * A single object; components call setState() to merge partial updates,
 * then all subscribers are notified synchronously.
 */

const initialState = {
  page: 'home',        // 'home' | 'lobby' | 'submission' | 'game' | 'reveal'
  socketId: null,      // populated once socket connects
  prefillCode: null,   // room code to pre-fill the join form (from URL or shared link)
  room: null,          // public room snapshot from server
  myRole: null,        // { role: 'spy'|'innocent', place: string|null }
};

let state = { ...initialState };
const listeners = new Set();

export function getState() {
  return state;
}

export function setState(partial) {
  state = { ...state, ...partial };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState() {
  state = { ...initialState };
  for (const fn of listeners) fn(state);
}
