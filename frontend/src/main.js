/**
 * Application entry point.
 *
 * Startup sequence:
 *   1. Check URL for a room code  (/room/ABC123)
 *   2. Check sessionStorage for a saved session
 *   3. If both match → auto-rejoin silently (handles page refresh)
 *   4. If URL has code but no session → pre-fill the join form
 *   5. Otherwise → plain home page
 */

import './socket.js'; // registers all server → client event listeners

import { getState, setState, subscribe } from './state.js';
import { socket, ensureConnected } from './socket.js';
import { api } from './api.js';
import { session, getUrlCode, clearRoomUrl } from './session.js';
import { renderHome }       from './pages/home.js';
import { renderLobby }      from './pages/lobby.js';
import { renderSubmission } from './pages/submission.js';
import { renderGame }       from './pages/game.js';
import { renderReveal }     from './pages/reveal.js';

const app = document.getElementById('app');

const pages = {
  home:       renderHome,
  lobby:      renderLobby,
  submission: renderSubmission,
  game:       renderGame,
  reveal:     renderReveal,
};

function render(state) {
  const renderer = pages[state.page];
  if (renderer) renderer(app, state);
}

subscribe(render);

// ── Startup routing ───────────────────────────────────────────────────────────

const urlCode  = getUrlCode();
const saved    = session.load();

if (urlCode && saved?.roomCode === urlCode && saved?.playerName) {
  // Page was refreshed while in a room — silently rejoin.
  ensureConnected();
  socket.once('connect', () => api.joinRoom({ code: urlCode, name: saved.playerName }));
  // Show home page with the code visible while we reconnect.
  setState({ page: 'home', prefillCode: urlCode });
} else if (urlCode) {
  // Shared link clicked — show join form with the code pre-filled.
  setState({ page: 'home', prefillCode: urlCode });
  render(getState());
} else {
  render(getState());
}

// ── Browser back / forward ────────────────────────────────────────────────────

window.addEventListener('popstate', () => {
  const code = getUrlCode();
  if (!code) {
    // Navigated away from a room page — go home.
    session.clear();
    setState({ page: 'home', room: null, myRole: null, prefillCode: null });
  }
});
