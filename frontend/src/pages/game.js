import { api } from '../api.js';

export function renderGame(container, state) {
  const { room, socketId, myRole } = state;
  if (!room) return;

  const isHost = room.hostId === socketId;
  const isSpy = myRole?.role === 'spy';
  const roleKnown = !!myRole;

  container.innerHTML = `
    <div class="page game-page">

      <!-- Role card -->
      <div class="section">
        ${roleKnown
          ? `<div class="role-card ${isSpy ? 'spy' : 'innocent'}">
              <div class="role-label">Your role</div>
              <div class="role-name">${isSpy ? 'Spy' : 'Innocent'}</div>
              ${isSpy
                ? `<p class="spy-hint">You don't know the place — blend in and survive!</p>`
                : `<div class="place-label">Secret place</div>
                   <div class="place-display">${escHtml(myRole.place ?? '')}</div>`
              }
            </div>`
          : `<div class="role-card" style="border-color:var(--border)">
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
              ${p.isHost ? '<span class="chip" style="margin-left:auto;font-size:.72rem">host</span>' : ''}
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Host actions -->
      ${isHost
        ? `<div class="section">
            <button id="revealBtn" class="btn-primary">Reveal & End Round</button>
           </div>`
        : `<p class="waiting-text">Discuss, ask questions, and find the spy!<br>The host will reveal when ready.</p>`
      }
    </div>
  `;

  document.getElementById('revealBtn')?.addEventListener('click', () => api.revealRound());
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
