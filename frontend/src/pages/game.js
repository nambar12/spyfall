import { api } from '../api.js';

export function renderGame(container, state) {
  const { room, socketId, myRole } = state;
  if (!room) return;

  const isSpy = myRole?.role === 'spy';
  const roleKnown = !!myRole;

  container.innerHTML = `
    <div class="page game-page">

      <!-- Role card -->
      <div class="section">
        ${roleKnown
          ? `<div class="role-card">
              <div class="role-label">Your role</div>
              <div class="role-name">${isSpy ? 'Spy' : 'Innocent'}</div>
              <div><span class="role-pill-inline ${isSpy ? 'spy' : 'innocent'}">${isSpy ? 'spy' : 'innocent'}</span></div>
              ${isSpy
                ? `<p class="spy-hint">You don't know the place — blend in and survive!</p>`
                : `<div class="place-label">Secret place</div>
                   <div class="place-display">${escHtml(myRole.place ?? '')}</div>`
              }
            </div>`
          : `<div class="role-card">
              <p style="color:var(--muted)">Waiting for role assignment…</p>
            </div>`
        }
      </div>

      <!-- Players -->
      <div class="section card">
        <h3 class="section-header">Players</h3>
        <ul class="player-list">
          ${room.players.map((p) => `
            <li>
              <span class="dot ${p.connected ? '' : 'offline'}"></span>
              <span>${escHtml(p.name)}</span>
              ${p.id === socketId ? '<span class="you-badge">you</span>' : ''}
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Actions -->
      <div class="section">
        <button id="revealBtn" class="btn-primary">Reveal & End Round</button>
      </div>
    </div>
  `;

  document.getElementById('revealBtn').addEventListener('click', () => api.revealRound());
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
