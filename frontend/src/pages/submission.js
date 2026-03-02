import { api } from '../api.js';

export function renderSubmission(container, state) {
  const { room, socketId } = state;
  if (!room) return;

  const submittedIds   = new Set(room.submittedIds ?? []);
  const iHaveSubmitted = submittedIds.has(socketId);

  // ── Partial update path ──────────────────────────────────────────────────
  // If the input form is already in the DOM and the player hasn't submitted,
  // only update the status list and the start button.
  // This preserves whatever they've typed and keeps the mobile keyboard open.
  if (container.querySelector('#submitForm') && !iHaveSubmitted) {
    const allSubmitted = room.players.every((p) => submittedIds.has(p.id));

    const list = container.querySelector('.player-list');
    if (list) list.innerHTML = playerListHTML(room.players, submittedIds, socketId);

    const header = container.querySelector('.submission-count');
    if (header) header.textContent = `Submissions (${submittedIds.size} / ${room.players.length})`;

    const btn = container.querySelector('#startRoundBtn');
    if (btn) {
      btn.disabled    = !allSubmitted;
      btn.textContent = allSubmitted ? 'Start Round' : 'Waiting for all submissions…';
    }
    return;
  }

  // ── Full render ──────────────────────────────────────────────────────────
  const allSubmitted = room.players.every((p) => submittedIds.has(p.id));

  container.innerHTML = `
    <div class="page submission-page">
      <div class="section">
        <h2>Submit a Place</h2>
        <p style="color:var(--muted);font-size:.9rem">
          Enter any real or fictional location. The server will pick one at random.
          If your place is chosen, you cannot be selected as the spy.
        </p>
      </div>

      <div class="section card">
        ${iHaveSubmitted
          ? `<div class="submitted-banner">✓ Your place has been submitted — waiting for others…</div>`
          : `<form id="submitForm" novalidate>
              <div class="form-group">
                <label for="placeInput">Your secret place</label>
                <input
                  id="placeInput"
                  type="text"
                  placeholder="e.g. Underground Lab"
                  maxlength="60"
                  autocomplete="off"
                  autofocus
                />
              </div>
              <button type="submit" class="btn-primary">Submit Place</button>
            </form>`
        }
      </div>

      <div class="section card">
        <h3 class="section-header submission-count">Submissions (${submittedIds.size} / ${room.players.length})</h3>
        <ul class="player-list">
          ${playerListHTML(room.players, submittedIds, socketId)}
        </ul>
      </div>

      <div class="section">
        <button id="startRoundBtn" class="btn-primary" ${allSubmitted ? '' : 'disabled'}>
          ${allSubmitted ? 'Start Round' : 'Waiting for all submissions…'}
        </button>
      </div>
    </div>
  `;

  document.getElementById('submitForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const place = document.getElementById('placeInput').value.trim();
    if (!place) return;
    api.submitPlace(place);
  });

  document.getElementById('startRoundBtn')?.addEventListener('click', () => api.startRound());
}

function playerListHTML(players, submittedIds, socketId) {
  return players.map((p) => {
    const done = submittedIds.has(p.id);
    return `
      <li>
        <span class="dot ${p.connected ? '' : 'offline'}"></span>
        <span>${escHtml(p.name)}</span>
        ${p.id === socketId ? '<span class="you-badge">you</span>' : ''}
        <span class="${done ? 'submitted-check' : 'pending-dot'}">${done ? '✓' : '…'}</span>
      </li>`;
  }).join('');
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
