import { api } from '../api.js';

export function renderLobby(container, state) {
  const { room, socketId } = state;
  if (!room) return;

  const connectedCount = room.players.filter((p) => p.connected).length;
  const canStart = connectedCount >= 3;

  container.innerHTML = `
    <div class="page lobby-page">
      <!-- Header -->
      <div class="section">
        <h3>Room</h3>
        <div class="invite-row">
          <span class="room-code-badge" id="copyCode" title="Click to copy code">${room.code}</span>
        </div>
        <div class="config-chips" style="margin-top:.6rem">
          <span class="chip">${room.config.mode === 'preset' ? 'Preset places' : 'Player places'}</span>
          <span class="chip">${room.config.spyCount} spy${room.config.spyCount > 1 ? 'ies' : ''}</span>
        </div>
      </div>

      <!-- Players -->
      <div class="section card">
        <h3 class="section-header">Players (${room.players.length} / 20)</h3>
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
        <button
          id="startBtn"
          class="btn-primary"
          ${canStart ? '' : 'disabled'}
        >
          ${canStart ? 'Start Game' : 'Need at least 3 connected players'}
        </button>
        <button id="leaveBtn" class="btn-leave">Exit Room</button>
      </div>
    </div>
  `;

  document.getElementById('copyCode').addEventListener('click', () => {
    navigator.clipboard.writeText(room.code).then(() => {
      const el = document.getElementById('copyCode');
      const orig = el.title;
      el.title = 'Copied!';
      setTimeout(() => { el.title = orig; }, 1500);
    });
  });

  document.getElementById('startBtn')?.addEventListener('click', () => api.startGame());
  document.getElementById('leaveBtn').addEventListener('click', () => api.leaveRoom());
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
