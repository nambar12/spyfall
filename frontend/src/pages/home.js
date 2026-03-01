import { api } from '../api.js';
import { socket, ensureConnected } from '../socket.js';
import { showToast } from '../toast.js';

export function renderHome(container, state) {
  container.innerHTML = `
    <div class="page home-page">
      <header>
        <span class="hero-icon">🕵️</span>
        <h1>SpyFall</h1>
        <p class="tagline">Who among you is the spy?</p>
      </header>

      <div class="home-grid">
        <!-- Create room -->
        <div class="card">
          <h2>Create Room</h2>
          <form id="createForm" novalidate>
            <div class="form-group">
              <label for="createName">Your name</label>
              <input id="createName" type="text" placeholder="e.g. Alice" maxlength="20" autocomplete="off" />
            </div>

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

            <button type="submit" class="btn-primary">Create Room</button>
          </form>
        </div>

        <!-- Join room -->
        <div class="card">
          <h2>Join Room</h2>
          <form id="joinForm" novalidate>
            <div class="form-group">
              <label for="joinName">Your name</label>
              <input id="joinName" type="text" placeholder="e.g. Bob" maxlength="20" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="joinCode">Room code</label>
              <input
                id="joinCode"
                type="text"
                placeholder="e.g. A3BX9K"
                maxlength="6"
                style="text-transform:uppercase;font-family:monospace;font-size:1.1rem;letter-spacing:.1em"
                autocomplete="off"
              />
            </div>
            <button type="submit" class="btn-primary">Join Room</button>
          </form>
        </div>
      </div>

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

  /**
   * Connect the socket (if needed) then call emit().
   * Shows a "Connecting…" state on the button while waiting.
   * If the connection fails, the connect_error handler in socket.js shows a toast.
   */
  function emitWhenReady(emit, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }

    if (socket.connected) {
      emit();
      return;
    }

    ensureConnected();

    function onConnect() {
      socket.off('connect_error', onError);
      emit();
    }
    function onError() {
      socket.off('connect', onConnect);
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  }

  // Stash original button labels so we can restore them on error
  document.querySelectorAll('button[type=submit]').forEach((b) => {
    b.dataset.label = b.textContent;
  });

  // Create room
  document.getElementById('createForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('createName').value.trim();
    const spyCount = parseInt(document.getElementById('spyCount').value, 10);
    const mode = document.getElementById('gameMode').value;
    if (!name) { showToast('Enter your name first', 'error'); return; }
    emitWhenReady(() => api.createRoom({ name, spyCount, mode }), e.submitter);
  });

  // Join room
  document.getElementById('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('joinName').value.trim();
    const code = document.getElementById('joinCode').value.toUpperCase().trim();
    if (!name) { showToast('Enter your name first', 'error'); return; }
    if (!code)  { showToast('Enter the room code', 'error'); return; }
    emitWhenReady(() => api.joinRoom({ code, name }), e.submitter);
  });

  // Pre-fill join code from URL or shared link.
  if (state?.prefillCode) {
    const codeEl = document.getElementById('joinCode');
    codeEl.value = state.prefillCode;
    document.getElementById('joinName').focus();
  }

  // Force-uppercase room code as user types.
  document.getElementById('joinCode').addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
  });
}
