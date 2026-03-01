/**
 * Socket.io client setup.
 * Handles all server-to-client events and translates them into state updates.
 */

import { io } from 'socket.io-client';
import { setState, resetState } from './state.js';
import { showToast } from './toast.js';
import { session, pushRoomUrl, clearRoomUrl } from './session.js';

// No URL → Socket.io connects to window.location.origin.
// In dev, Vite's proxy forwards /socket.io → http://localhost:3001.
// In production, point VITE_BACKEND_URL to a separate backend if needed.
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
});

socket.on('disconnect', () => {
  setState({ socketId: null });
});

// ── Room creation / joining ──────────────────────────────────────────────────

socket.on('roomCreated', ({ code }) => {
  pushRoomUrl(code);
});

socket.on('roomJoined', ({ code }) => {
  pushRoomUrl(code);
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

  if (pageMap[room.phase]) {
    updates.page = pageMap[room.phase];
  }

  // Clear private role when returning to lobby.
  if (room.phase === 'lobby') {
    updates.myRole = null;
  }

  setState(updates);

  // Persist session so a page refresh can rejoin.
  // Find ourselves by socket.id — works for both first join and reconnection.
  const me = room.players.find((p) => p.id === socket.id);
  if (me) session.save(room.code, me.name);
});

// ── Private role assignment ──────────────────────────────────────────────────

socket.on('roleAssigned', (assignment) => {
  setState({ myRole: assignment });
});

// ── Room closed by host ──────────────────────────────────────────────────────

socket.on('roomClosed', ({ reason }) => {
  showToast(reason, 'error', 5000);
  session.clear();
  clearRoomUrl();
  resetState();
});

// ── Connection errors ─────────────────────────────────────────────────────────

socket.on('connect_error', (err) => {
  showToast(`Cannot reach server — is the backend running? (${err.message})`, 'error', 6000);
});

socket.on('reconnect_failed', () => {
  showToast('Could not connect to the server after several attempts.', 'error', 6000);
});

// ── Game errors ───────────────────────────────────────────────────────────────

socket.on('error', ({ message }) => {
  showToast(message, 'error');
  // If the room we tried to (re)join no longer exists, clean up navigation state.
  if (message === 'Room not found — check the code') {
    session.clear();
    clearRoomUrl();
    setState({ page: 'home', prefillCode: null });
  }
});

// ── Reconnect immediately when the user returns to the tab ───────────────────
// Mobile browsers suspend WebSockets when an app goes to the background.
// visibilitychange fires reliably when the user switches back, giving us
// a hook to reconnect before Socket.io's own backoff timer would fire.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) {
    socket.connect();
  }
});

// ── Public helper ────────────────────────────────────────────────────────────

export function ensureConnected() {
  if (!socket.connected) socket.connect();
}
