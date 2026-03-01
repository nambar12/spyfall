import { api } from '../api.js';
import { getState } from '../state.js';
import { showToast } from '../toast.js';

export function renderLobby(container, state) {
  const { room, socketId } = state;
  if (!room) return;

  const isHost = room.hostId === socketId;
  const canStart = room.players.length >= 3;

  container.innerHTML = `
    <div class="page lobby-page">
      <!-- Header -->
      <div class="section">
        <h3>Invite players</h3>
        <div class="invite-row">
          <span class="room-code-badge" id="copyCode" title="Click to copy code">${room.code}</span>
          <button class="btn-secondary invite-btn" id="copyLink" type="button">Copy invite link</button>
        </div>
        <div class="config-chips" style="margin-top:.6rem">
          <span class="chip">${room.config.mode === 'preset' ? 'Preset places' : 'Player places'}</span>
          <span class="chip">${room.config.spyCount} spy${room.config.spyCount > 1 ? 'ies' : ''}</span>
        </div>
      </div>

      <!-- Players -->
      <div class="section card">
        <h3 class="section-header">Players (${room.players.length} / 12)</h3>
        <ul class="player-list">
          ${room.players.map((p) => `
            <li>
              <span class="dot ${p.connected ? '' : 'offline'}"></span>
              ${p.isHost ? '<span class="crown">♛</span>' : ''}
              <span>${escHtml(p.name)}</span>
              ${p.id === socketId ? '<span class="you-badge">you</span>' : ''}
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Actions -->
      <div class="section">
        ${isHost ? `
          <button
            id="startBtn"
            class="btn-primary"
            ${canStart ? '' : 'disabled'}
          >
            ${canStart ? 'Start Game' : 'Need at least 3 players'}
          </button>
        ` : `
          <p class="waiting-text">Waiting for the host to start…</p>
        `}
      </div>
    </div>
  `;

  const inviteUrl = `${window.location.origin}/room/${room.code}`;

  document.getElementById('copyCode').addEventListener('click', () => {
    navigator.clipboard.writeText(room.code).then(() => showToast('Code copied!', 'success', 2000));
  });

  document.getElementById('copyLink').addEventListener('click', () => {
    navigator.clipboard.writeText(inviteUrl).then(() => showToast('Link copied!', 'success', 2000));
  });

  if (isHost) {
    document.getElementById('startBtn')?.addEventListener('click', () => api.startGame());
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
