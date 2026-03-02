import { api } from '../api.js';
import { socket, ensureConnected } from '../socket.js';
import { showToast } from '../toast.js';

export function renderHome(container, state) {
  // ── Partial update: only refresh the rooms list if the form already exists ──
  if (container.querySelector('#createForm')) {
    renderRoomsList(state.rooms ?? []);
    return;
  }

  // ── Full render ──────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="page home-page">
      <header>
        <span class="hero-icon">🕵️</span>
        <h1>SpyFall</h1>
        <p class="tagline">Who among you is the spy?</p>
      </header>

      <!-- Step 1: name (shared by join and create) -->
      <div class="form-group name-step">
        <label for="playerName">Your name</label>
        <input id="playerName" type="text" placeholder="e.g. Alice" maxlength="20" autocomplete="off" autofocus value="${escHtml(localStorage.getItem('playerName') ?? '')}" />
      </div>

      <!-- Step 2: join an existing room -->
      <div class="section">
        <h3>Available Rooms</h3>
        <div id="roomsList"></div>
      </div>

      <div class="divider"><span>or create a new room</span></div>

      <!-- Step 3: create -->
      <form id="createForm" class="card mt-2" novalidate>
        <div class="form-row">
          <div class="form-group">
            <label for="spyCount">Spies</label>
            <input id="spyCount" type="number" min="1" max="4" value="1" />
          </div>
          <div class="form-group">
            <label for="gameMode">Mode</label>
            <select id="gameMode">
              <option value="preset">Preset places</option>
              <option value="player">Player places</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn-primary" data-label="Create Room">Create Room</button>
      </form>

      <div class="divider mt-3"><span>How to play</span></div>
      <div class="card mt-2" style="color:var(--muted);font-size:.9rem;line-height:1.7">
        <p>
          Everyone except the <strong style="color:var(--danger)">spy</strong> sees the same secret place.
          The spy must blend in by asking and answering questions.
          Innocents try to expose the spy before it's too late.
        </p>
        <p class="mt-1">
          <strong>Preset mode</strong> — server picks a place from its built-in list.
          <br>
          <strong>Player mode</strong> — each player secretly submits a place;
          the server picks one at random. The player who submitted the chosen place cannot be the spy.
        </p>
      </div>
    </div>
  `;

  renderRoomsList(state.rooms ?? []);

  document.getElementById('playerName').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (v) localStorage.setItem('playerName', v);
    else localStorage.removeItem('playerName');
  });

  function emitWhenReady(emit, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

    if (socket.connected) { emit(); return; }

    ensureConnected();

    function onConnect() { socket.off('connect_error', onError); emit(); }
    function onError() {
      socket.off('connect', onConnect);
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  }

  document.getElementById('createForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('playerName').value.trim();
    const spyCount = parseInt(document.getElementById('spyCount').value, 10);
    const mode = document.getElementById('gameMode').value;
    if (!name) { showToast('Enter your name first', 'error'); document.getElementById('playerName').focus(); return; }
    emitWhenReady(() => api.createRoom({ name, spyCount, mode }), e.submitter);
  });
}

function renderRoomsList(rooms) {
  const el = document.getElementById('roomsList');
  if (!el) return;

  if (!rooms.length) {
    el.innerHTML = '<p class="waiting-text" style="text-align:left;padding:.5rem 0">No open rooms yet.</p>';
    return;
  }

  el.innerHTML = rooms.map((r) => {
    const modeLabel = r.mode === 'preset' ? 'Preset' : 'Player';
    const spyLabel  = `${r.spyCount} spy${r.spyCount > 1 ? 'ies' : ''}`;
    return `
      <button class="room-item" data-code="${escHtml(r.code)}">
        <div>
          <span class="room-item-code">${escHtml(r.code)}</span>
          <span class="room-item-meta">${r.connectedCount} / ${r.totalPlayers} players · ${modeLabel} · ${spyLabel}</span>
        </div>
        <span class="room-item-join">Join →</span>
      </button>
    `;
  }).join('');

  el.querySelectorAll('.room-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const name = document.getElementById('playerName')?.value.trim();
      if (!name) { showToast('Enter your name first', 'error'); document.getElementById('playerName').focus(); return; }
      if (socket.connected) {
        api.joinRoom({ code, name });
      } else {
        ensureConnected();
        socket.once('connect', () => api.joinRoom({ code, name }));
      }
    });
  });
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
