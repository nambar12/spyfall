/**
 * Socket.io client setup.
 * Handles all server-to-client events and translates them into state updates.
 */

import { io } from 'socket.io-client';
import { getState, setState, resetState } from './state.js';
import { showToast } from './toast.js';
import { session } from './session.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL; // undefined = same origin

export const socket = io(BACKEND_URL, {
  autoConnect: false,
  reconnectionAttempts: Infinity, // never give up — mobile browsers can suspend for a long time
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

// ── Connection lifecycle ─────────────────────────────────────────────────────

socket.on('connect', () => {
  setState({ socketId: socket.id });

  // ── Auto-rejoin after socket.io reconnects ──────────────────────────────
  // When socket.io reconnects (e.g. after backgrounding the app), the server
  // gets a brand-new socket with no room association. We must re-emit joinRoom
  // so the server remaps our new socket ID onto our existing player slot and
  // cancels the inactivity timer.
  //
  // We only do this when we already have a room in state (so we don't
  // interfere with the normal first-connect flow from the home page).
  const saved = session.load();
  const { room } = getState();
  if (room && saved) {
    socket.emit('joinRoom', { code: saved.roomCode, name: saved.playerName });
  }
});

socket.on('disconnect', () => {
  setState({ socketId: null });
});

// ── Room list (home page) ────────────────────────────────────────────────────

socket.on('roomList', (rooms) => {
  setState({ rooms });
});

// ── Room state (primary sync mechanism) ─────────────────────────────────────

socket.on('roomState', (room) => {
  const pageMap = {
    lobby:      'lobby',
    submission: 'submission',
    playing:    'game',
    reveal:     'reveal',
  };

  const updates = { room };
  if (pageMap[room.phase]) updates.page = pageMap[room.phase];
  if (room.phase === 'lobby') updates.myRole = null;

  setState(updates);

  const me = room.players.find((p) => p.id === socket.id);
  if (me) session.save(room.code, me.name);
});

// ── Private role assignment ──────────────────────────────────────────────────

socket.on('roleAssigned', (assignment) => {
  setState({ myRole: assignment });
});

// ── Voluntary leave ──────────────────────────────────────────────────────────

socket.on('leftRoom', () => {
  session.clear();
  resetState();
});

// ── Room closed ──────────────────────────────────────────────────────────────

socket.on('roomClosed', ({ reason }) => {
  showToast(reason, 'error', 5000);
  session.clear();
  resetState();
});

// ── Connection errors ─────────────────────────────────────────────────────────

socket.on('connect_error', (err) => {
  // Suppress noisy toasts while reconnecting mid-game — the player list
  // already shows who is offline. Only show the full error on the home page
  // where there is no other visual feedback.
  const { room } = getState();
  if (!room) {
    showToast(`Cannot reach server — is the backend running? (${err.message})`, 'error', 6000);
  }
});

// ── Game errors ───────────────────────────────────────────────────────────────

socket.on('error', ({ message }) => {
  showToast(message, 'error');
  if (message === 'Room not found') {
    session.clear();
    setState({ page: 'home' });
  }
});

// ── Reconnect immediately when the user returns to the tab ───────────────────
// Mobile browsers suspend WebSockets/timers when an app is backgrounded.
// visibilitychange fires reliably on return, triggering an immediate
// reconnect attempt instead of waiting for Socket.io's backoff timer.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) {
    socket.connect();
  }
});

// ── Public helper ────────────────────────────────────────────────────────────

export function ensureConnected() {
  if (!socket.connected) socket.connect();
}
