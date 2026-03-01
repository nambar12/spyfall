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
  reconnectionAttempts: 10,   // survive a ~30s cold-start boot
  reconnectionDelay: 2000,    // start at 2 s between attempts
  reconnectionDelayMax: 8000, // cap at 8 s
});

// ── Keep-alive (Render free tier) ────────────────────────────────────────────
// Render spins down after 15 min with no HTTP traffic; WebSocket pings don't
// count. A lightweight fetch to /health every 4 min resets that timer.
// Only runs in the production build (import.meta.env.PROD is false in dev).

let _keepAliveTimer = null;

function startKeepAlive() {
  if (!import.meta.env.PROD) return;
  stopKeepAlive();
  _keepAliveTimer = setInterval(() => fetch('/health').catch(() => {}), 3000);
}

function stopKeepAlive() {
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
}

// ── Connection lifecycle ─────────────────────────────────────────────────────

socket.on('connect', () => {
  setState({ socketId: socket.id });
  startKeepAlive();
});

socket.on('disconnect', () => {
  setState({ socketId: null });
  stopKeepAlive();
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

// ── Public helper ────────────────────────────────────────────────────────────

export function ensureConnected() {
  if (!socket.connected) socket.connect();
}
