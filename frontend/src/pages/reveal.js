import { api } from '../api.js';

export function renderReveal(container, state) {
  const { room, socketId } = state;
  if (!room || !room.reveal) return;

  const { place, assignments, submitterId } = room.reveal;

  container.innerHTML = `
    <div class="page reveal-page">

      <!-- Secret place -->
      <div class="section reveal-place">
        <div class="label">The secret place was</div>
        <div class="place">${escHtml(place)}</div>
        ${submitterId
          ? `<div style="color:var(--muted);font-size:.85rem;margin-top:.4rem">
               Submitted by <strong style="color:var(--accent-lit)">${escHtml(playerName(room, submitterId))}</strong>
             </div>`
          : ''
        }
      </div>

      <!-- Player assignments -->
      <div class="section card">
        <h3 class="section-header">Results</h3>
        <ul class="assignments-list">
          ${room.players.map((p) => {
            const a = assignments?.[p.id];
            const role = a?.role ?? 'unknown';
            return `
              <li>
                <span class="dot ${p.connected ? '' : 'offline'}"></span>
                <span>${escHtml(p.name)}</span>
                ${p.id === socketId ? '<span class="you-badge">you</span>' : ''}
                ${p.id === submitterId ? '<span class="submitter-tag">submitted place</span>' : ''}
                <span class="role-pill ${role}">${role === 'spy' ? 'Spy' : role === 'innocent' ? 'Innocent' : '?'}</span>
              </li>
            `;
          }).join('')}
        </ul>
      </div>

      <!-- Actions -->
      <div class="section btn-group">
        <button id="nextRoundBtn" class="btn-primary" style="flex:1">Play Again</button>
      </div>
    </div>
  `;

  document.getElementById('nextRoundBtn').addEventListener('click', () => api.nextRound());
}

function playerName(room, id) {
  return room.players.find((p) => p.id === id)?.name ?? 'Unknown';
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
