import { api } from '../api.js';
import { getState } from '../state.js';

export function renderSubmission(container, state) {
  const { room, socketId } = state;
  if (!room) return;

  const isHost = room.hostId === socketId;
  const submittedIds = new Set(room.submittedIds ?? []);
  const iHaveSubmitted = submittedIds.has(socketId);
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

      <!-- Submission form -->
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

      <!-- Who has submitted -->
      <div class="section card">
        <h3 class="section-header">Submissions (${submittedIds.size} / ${room.players.length})</h3>
        <ul class="player-list">
          ${room.players.map((p) => {
            const done = submittedIds.has(p.id);
            return `
              <li>
                <span class="dot ${p.connected ? '' : 'offline'}"></span>
                <span>${escHtml(p.name)}</span>
                ${p.id === socketId ? '<span class="you-badge">you</span>' : ''}
                <span class="${done ? 'submitted-check' : 'pending-dot'}">${done ? '✓' : '…'}</span>
              </li>
            `;
          }).join('')}
        </ul>
      </div>

      <!-- Host control -->
      ${isHost ? `
        <div class="section">
          <button
            id="startRoundBtn"
            class="btn-primary"
            ${allSubmitted ? '' : 'disabled'}
          >
            ${allSubmitted ? 'Start Round' : 'Waiting for all submissions…'}
          </button>
        </div>
      ` : ''}
    </div>
  `;

  if (!iHaveSubmitted) {
    document.getElementById('submitForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const place = document.getElementById('placeInput').value.trim();
      if (!place) return;
      api.submitPlace(place);
    });
  }

  if (isHost) {
    document.getElementById('startRoundBtn')?.addEventListener('click', () => api.startRound());
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
