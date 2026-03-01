/**
 * Socket.io event handlers.
 *
 * All business logic delegates to pure functions in core/gameLogic.js.
 * The store is injected — memoryStore (dev) or redisStore (prod).
 *
 * Disconnect policy (handles mobile apps going to background):
 *   Host disconnects      → 45-second grace period before the room is closed.
 *   Player disconnects in lobby → 30-second grace period before removal.
 *   Player disconnects in-game  → marked offline; stays in assignments; can rejoin.
 * Any reconnection within the grace period cancels the timer.
 */

import {
  generateRoomCode,
  createRoom,
  addPlayer,
  removePlayer,
  setPlayerConnected,
  remapPlayerId,
  beginSubmissionPhase,
  recordSubmission,
  allPlayersSubmitted,
  beginRound,
  revealRound,
  resetToLobby,
} from '../core/gameLogic.js';

// ---------------------------------------------------------------------------
// Module-level grace-period timers (in-process; survive reconnects, not restarts)
// ---------------------------------------------------------------------------

/** roomCode → timerId  —  host disconnect timers */
const hostTimers = new Map();

/** `${roomCode}:${playerName}` → timerId  —  lobby-player disconnect timers */
const playerTimers = new Map();

function cancelHostTimer(code) {
  if (hostTimers.has(code)) { clearTimeout(hostTimers.get(code)); hostTimers.delete(code); }
}

function cancelPlayerTimer(code, name) {
  const key = `${code}:${name}`;
  if (playerTimers.has(key)) { clearTimeout(playerTimers.get(key)); playerTimers.delete(key); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPublicRoom(room) {
  const base = {
    code:    room.code,
    hostId:  room.hostId,
    players: room.players.map(({ id, name, isHost, connected }) => ({ id, name, isHost, connected })),
    config:  room.config,
    phase:   room.phase,
  };
  if (room.phase === 'submission') {
    base.submittedIds = Object.keys(room.round?.submissions ?? {});
  }
  if (room.phase === 'reveal') {
    base.reveal = {
      place:       room.round.place,
      assignments: room.round.assignments,
      submitterId: room.round.submitterId ?? null,
    };
  }
  return base;
}

function broadcastRoomState(io, room) {
  io.to(room.code).emit('roomState', toPublicRoom(room));
}

function broadcastRoundStart(io, room) {
  broadcastRoomState(io, room);
  for (const player of room.players) {
    const a = room.round.assignments[player.id];
    if (a) io.to(player.id).emit('roleAssigned', a);
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerHandlers(io, socket, store) {

  async function getRoom(code) {
    const room = await store.getRoom(code ?? socket.data.roomCode);
    if (!room) throw new Error('Room not found — check the code');
    return room;
  }

  async function getHostRoom() {
    const room = await getRoom();
    if (room.hostId !== socket.id) throw new Error('Only the host can do that');
    return room;
  }

  function safe(handler) {
    return (...args) => {
      Promise.resolve(handler(...args)).catch((err) => {
        socket.emit('error', { message: err.message });
      });
    };
  }

  // -------------------------------------------------------------------------
  // Create room
  // -------------------------------------------------------------------------
  socket.on('createRoom', safe(async ({ name, spyCount, mode } = {}) => {
    if (!name?.trim()) throw new Error('Name is required');

    let code;
    do { code = generateRoomCode(); } while (await store.getRoom(code));

    const room = { ...createRoom({ hostId: socket.id, hostName: name, spyCount, mode }), code };
    await store.setRoom(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('roomCreated', { code });
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Join room  (also handles reconnection after backgrounding / page refresh)
  // -------------------------------------------------------------------------
  socket.on('joinRoom', safe(async ({ code, name } = {}) => {
    if (!name?.trim()) throw new Error('Name is required');

    const upperCode   = code?.toUpperCase().trim();
    let   room        = await store.getRoom(upperCode);
    if (!room) throw new Error('Room not found — check the code');

    const trimmedName = name.trim();
    const existing    = room.players.find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (existing) {
      // ── Reconnection path ──────────────────────────────────────────────
      if (existing.connected) throw new Error('Someone with that name is already connected');

      // Cancel any pending disconnect timers for this player.
      cancelHostTimer(upperCode);
      cancelPlayerTimer(upperCode, trimmedName);

      room = remapPlayerId(room, existing.id, socket.id);
      await store.setRoom(upperCode, room);

      socket.join(upperCode);
      socket.data.roomCode = upperCode;

      socket.emit('roomJoined', { code: upperCode });
      broadcastRoomState(io, room);

      if (room.phase === 'playing' && room.round?.assignments?.[socket.id]) {
        socket.emit('roleAssigned', room.round.assignments[socket.id]);
      }
      return;
    }

    // ── New player path ────────────────────────────────────────────────
    if (room.phase !== 'lobby') throw new Error('Game already in progress');
    if (room.players.length >= 12) throw new Error('Room is full (max 12 players)');

    room = addPlayer(room, { id: socket.id, name: trimmedName });
    await store.setRoom(upperCode, room);

    socket.join(upperCode);
    socket.data.roomCode = upperCode;

    socket.emit('roomJoined', { code: upperCode });
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Start game
  // -------------------------------------------------------------------------
  socket.on('startGame', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'lobby') throw new Error('Game is already running');
    if (room.players.filter(p => p.connected).length < 3)
      throw new Error('Need at least 3 connected players to start');

    if (room.config.mode === 'player') {
      room = beginSubmissionPhase(room);
      await store.setRoom(room.code, room);
      broadcastRoomState(io, room);
    } else {
      room = beginRound(room);
      await store.setRoom(room.code, room);
      broadcastRoundStart(io, room);
    }
  }));

  // -------------------------------------------------------------------------
  // Submit place
  // -------------------------------------------------------------------------
  socket.on('submitPlace', safe(async ({ place } = {}) => {
    if (!place?.trim()) throw new Error('Place name cannot be empty');
    if (place.trim().length > 60) throw new Error('Place name is too long (max 60 chars)');

    let room = await getRoom();
    if (room.phase !== 'submission') throw new Error('Not in the submission phase');

    room = recordSubmission(room, socket.id, place);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Start round
  // -------------------------------------------------------------------------
  socket.on('startRound', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'submission') throw new Error('Not in the submission phase');
    if (!allPlayersSubmitted(room)) throw new Error('Waiting for all players to submit');

    room = beginRound(room);
    await store.setRoom(room.code, room);
    broadcastRoundStart(io, room);
  }));

  // -------------------------------------------------------------------------
  // Reveal
  // -------------------------------------------------------------------------
  socket.on('revealRound', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'playing') throw new Error('No round is in progress');

    room = revealRound(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Next round
  // -------------------------------------------------------------------------
  socket.on('nextRound', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'reveal') throw new Error('Round has not been revealed yet');

    room = resetToLobby(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Disconnect  — grace-period policy
  // -------------------------------------------------------------------------
  socket.on('disconnect', async () => {
    const code = socket.data.roomCode;
    if (!code) return;

    try {
      const room = await store.getRoom(code);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      // Mark the player as offline immediately so others see it.
      const updated = setPlayerConnected(room, socket.id, false);
      await store.setRoom(code, updated);
      broadcastRoomState(io, updated);

      if (room.hostId === socket.id) {
        // ── Host disconnected — 45-second grace period ───────────────────
        console.log(`[room ${code}] host disconnected, starting 45s grace period`);
        const timerId = setTimeout(async () => {
          hostTimers.delete(code);
          try {
            const current = await store.getRoom(code);
            if (!current) return;
            const hostBack = current.players.find((p) => p.isHost && p.connected);
            if (!hostBack) {
              console.log(`[room ${code}] host did not return, closing room`);
              io.to(code).emit('roomClosed', { reason: 'The host disconnected' });
              await store.deleteRoom(code);
            }
          } catch (e) { console.error('[hostTimer]', e.message); }
        }, 45_000);
        hostTimers.set(code, timerId);

      } else if (room.phase === 'lobby') {
        // ── Lobby player — 30-second grace period, then remove ───────────
        const timerKey = `${code}:${player.name}`;
        const timerId = setTimeout(async () => {
          playerTimers.delete(timerKey);
          try {
            const current = await store.getRoom(code);
            if (!current) return;
            const p = current.players.find((pl) => pl.name === player.name);
            if (p && !p.connected) {
              const pruned = removePlayer(current, p.id);
              await store.setRoom(code, pruned);
              broadcastRoomState(io, pruned);
            }
          } catch (e) { console.error('[playerTimer]', e.message); }
        }, 30_000);
        playerTimers.set(timerKey, timerId);
      }
      // In-game non-host: stays disconnected indefinitely; can rejoin.

    } catch (err) {
      console.error('[disconnect]', err.message);
    }
  });
}
