import { api } from '../api.js';

export function renderGame(container, state) {
  const { room, socketId, myRole } = state;
  if (!room) return;

  const isSpy    = myRole?.role === 'spy';
  const roleKnown = !!myRole;

  // suspicions: { suspectorId: [targetId, ...] }
  const suspicions    = room.suspicions ?? {};
  const maxSuspectors = room.players.length - 1; // you can't suspect yourself

  function suspicionCount(playerId) {
    return Object.values(suspicions).filter((arr) => arr.includes(playerId)).length;
  }
  function iSuspect(playerId) {
    return (suspicions[socketId] ?? []).includes(playerId);
  }

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
        <h3 class="section-header">Players — tap another player to suspect them</h3>
        <ul class="player-list">
          ${room.players.map((p) => {
            const isMe      = p.id === socketId;
            const count     = suspicionCount(p.id);
            const suspected = iSuspect(p.id);
            const title     = !isMe ? (suspected ? `Clear suspicion of ${escHtml(p.name)}` : `Suspect ${escHtml(p.name)}`) : '';
            return `
              <li ${!isMe ? `class="suspectable" data-id="${escHtml(p.id)}" title="${title}"` : ''}>
                <span class="dot ${p.connected ? '' : 'offline'}"></span>
                <span>${escHtml(p.name)}</span>
                ${isMe ? '<span class="you-badge">you</span>' : ''}
                ${suspicionBarHTML(count, isMe ? false : suspected, maxSuspectors)}
              </li>
            `;
          }).join('')}
        </ul>
      </div>

      <!-- Actions -->
      <div class="section">
        <button id="revealBtn" class="btn-primary">Reveal & End Round</button>
        <button id="leaveBtn" class="btn-leave">Exit Room</button>
      </div>
    </div>
  `;

  container.querySelectorAll('.suspectable').forEach((li) => {
    li.addEventListener('click', () => api.toggleSuspicion(li.dataset.id));
  });

  document.getElementById('revealBtn').addEventListener('click', () => api.revealRound());
  document.getElementById('leaveBtn').addEventListener('click', () => api.leaveRoom());
}

/** Render a row of discrete suspicion segments.
 *  mine=true  → one segment rendered as "my mark" (brighter)
 *  filled     → other suspectors (dimmer red)
 *  empty      → remaining slots
 */
function suspicionBarHTML(count, iMine, max) {
  if (max <= 0) return '';
  const segs = [];
  let remaining = count;
  if (iMine) {
    segs.push('<span class="suspicion-seg mine"></span>');
    remaining--;
  }
  for (let i = 0; i < remaining; i++) segs.push('<span class="suspicion-seg filled"></span>');
  for (let i = count; i < max; i++)   segs.push('<span class="suspicion-seg"></span>');
  return `<div class="suspicion-bar">${segs.join('')}</div>`;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
