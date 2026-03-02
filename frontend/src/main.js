/**
 * Application entry point.
 *
 * Startup sequence:
 *   1. Check sessionStorage for a saved session
 *   2. If name + room code saved → auto-rejoin silently (handles page refresh)
 *   3. Otherwise → plain home page with room list
 */

import './socket.js'; // registers all server → client event listeners

import { getState, setState, subscribe } from './state.js';
import { socket, ensureConnected } from './socket.js';
import { api } from './api.js';
import { session } from './session.js';
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

const saved = session.load();

if (saved?.roomCode && saved?.playerName) {
  // Page was refreshed while in a room — silently rejoin.
  ensureConnected();
  socket.once('connect', () => api.joinRoom({ code: saved.roomCode, name: saved.playerName }));
}

render(getState());
