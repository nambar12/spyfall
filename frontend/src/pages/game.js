import { api } from '../api.js';

export function renderGame(container, state) {
  const { room, socketId, myRole } = state;
  if (!room) return;

  const isSpy     = myRole?.role === 'spy';
  const roleKnown = !!myRole;

  const suspicions    = room.suspicions  ?? {};
  const revealVotes   = room.revealVotes ?? [];
  const maxSuspectors = room.players.length - 1;
  const connectedPlayers = room.players.filter((p) => p.connected);
  const iVotedReveal  = revealVotes.includes(socketId);

  const vote        = room.vote ?? null;
  const voteActive  = !!vote && !vote.resolved;
  const voteResolved = !!vote?.resolved;

  function playerName(id) {
    return room.players.find((p) => p.id === id)?.name ?? 'Unknown';
  }
  function suspicionCount(id) {
    return Object.values(suspicions).filter((arr) => arr.includes(id)).length;
  }
  function iSuspect(id) {
    return (suspicions[socketId] ?? []).includes(id);
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
        <h3 class="section-header">Players</h3>
        <ul class="player-list">
          ${room.players.map((p) => {
            const isMe       = p.id === socketId;
            const isAccused  = vote?.accusedId === p.id;
            const count      = suspicionCount(p.id);
            const suspected  = !isMe && iSuspect(p.id);
            const canAccuse  = !isMe && !voteActive && !voteResolved && p.connected;
            const readyToEnd = revealVotes.includes(p.id);
            const title      = !isMe ? (suspected ? `Clear suspicion of ${escHtml(p.name)}` : `Suspect ${escHtml(p.name)}`) : '';
            return `
              <li ${!isMe ? `class="suspectable${isAccused ? ' being-accused' : ''}" data-id="${escHtml(p.id)}" title="${title}"` : ''}>
                <span class="dot ${p.connected ? '' : 'offline'}"></span>
                <span>${escHtml(p.name)}</span>
                ${isMe         ? '<span class="you-badge">you</span>' : ''}
                ${isAccused    ? '<span class="accused-badge">accused</span>' : ''}
                ${readyToEnd   ? '<span class="ready-badge" title="Ready to end round">✓</span>' : ''}
                ${suspicionBarHTML(count, suspected, maxSuspectors)}
                ${canAccuse    ? `<button class="btn-accuse" data-accuse="${escHtml(p.id)}" title="Call a vote against ${escHtml(p.name)}">⚖️</button>` : ''}
              </li>
            `;
          }).join('')}
        </ul>
      </div>

      <!-- Actions -->
      <div class="section">
        <button id="revealBtn" class="btn-primary${iVotedReveal ? ' btn-armed' : ''}">
          ${iVotedReveal ? '✓ ' : ''}End Round · ${revealVotes.filter((id) => connectedPlayers.some((p) => p.id === id)).length} / ${connectedPlayers.length}
        </button>
        <button id="leaveBtn" class="btn-leave">Exit Room</button>
      </div>
    </div>

    ${voteResolved ? renderVoteResult(vote, playerName) : ''}
    ${voteActive   ? renderVotePanel(vote, room, socketId, playerName) : ''}
  `;

  // Suspicion toggle (row click)
  container.querySelectorAll('.suspectable').forEach((li) => {
    li.addEventListener('click', () => api.toggleSuspicion(li.dataset.id));
  });

  // Accuse button (stops propagation so row tap doesn't also toggle suspicion)
  container.querySelectorAll('.btn-accuse').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      api.initiateVote(btn.dataset.accuse);
    });
  });

  // Vote yes/no
  document.getElementById('voteYes')?.addEventListener('click', () => api.castVote('yes'));
  document.getElementById('voteNo')?.addEventListener('click', () => api.castVote('no'));

  document.getElementById('revealBtn').addEventListener('click', () => api.toggleRevealVote());

  document.getElementById('leaveBtn').addEventListener('click', () => api.leaveRoom());
}

// ---------------------------------------------------------------------------
// Vote panel (voting in progress)
// ---------------------------------------------------------------------------
function renderVotePanel(vote, room, socketId, playerName) {
  const accusedName  = playerName(vote.accusedId);
  const accuserName  = playerName(vote.accuserId);
  const voters       = room.players.filter((p) => p.connected && p.id !== vote.accusedId);
  const totalVoters  = voters.length;
  const votedCount   = vote.votedIds.length;
  const isAccused    = socketId === vote.accusedId;
  const iHaveVoted   = vote.votedIds.includes(socketId);
  const canVote      = !isAccused && !iHaveVoted;

  return `
    <div class="vote-overlay">
      <div class="vote-card">
        <div class="vote-icon">⚖️</div>
        <div class="vote-title">Vote: Is this player the spy?</div>
        <div class="vote-accused-name">${escHtml(accusedName)}</div>
        <div class="vote-meta">Accused by ${escHtml(accuserName)}</div>
        <div class="vote-tally">${votedCount} / ${totalVoters} voted</div>
        ${canVote ? `
          <div class="vote-actions">
            <button class="btn-vote btn-vote-yes" id="voteYes">👍 Spy!</button>
            <button class="btn-vote btn-vote-no"  id="voteNo">👎 Innocent</button>
          </div>
        ` : isAccused ? `
          <p class="vote-notice">You are being accused — others are deciding.</p>
        ` : `
          <p class="vote-notice">Your vote is in — waiting for others…</p>
        `}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Vote result overlay (shown for ~3.5 s before server applies consequences)
// ---------------------------------------------------------------------------
function renderVoteResult(vote, playerName) {
  const accusedName = playerName(vote.accusedId);
  const cfg = {
    spy_caught: { cls: 'spy-caught', icon: '🔴', title: 'SPY CAUGHT!',  desc: `${escHtml(accusedName)} was the spy.` },
    wrong:      { cls: 'wrong',      icon: '😇', title: 'INNOCENT!',    desc: `${escHtml(accusedName)} was NOT the spy and has been removed.` },
    failed:     { cls: 'failed',     icon: '🤝', title: 'Vote Failed',  desc: 'No majority. The game continues.' },
  }[vote.result] ?? { cls: 'failed', icon: '?', title: '…', desc: '' };

  return `
    <div class="vote-result-overlay vote-result--${cfg.cls}">
      <div class="vote-result-content">
        <div class="vote-result-icon">${cfg.icon}</div>
        <div class="vote-result-title">${cfg.title}</div>
        <div class="vote-result-desc">${cfg.desc}</div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Suspicion bar
// ---------------------------------------------------------------------------
function suspicionBarHTML(count, iMine, max) {
  if (max <= 0) return '';
  const segs = [];
  let rest = count;
  if (iMine) { segs.push('<span class="suspicion-seg mine"></span>'); rest--; }
  for (let i = 0; i < rest;      i++) segs.push('<span class="suspicion-seg filled"></span>');
  for (let i = count; i < max;   i++) segs.push('<span class="suspicion-seg"></span>');
  return `<div class="suspicion-bar">${segs.join('')}</div>`;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
