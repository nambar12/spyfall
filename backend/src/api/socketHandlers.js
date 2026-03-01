/**
 * Socket.io event handlers.
 *
 * All business logic delegates to pure functions in core/gameLogic.js.
 * The store is injected — memoryStore (dev) or redisStore (prod) — and all
 * store methods are awaited so either implementation works transparently.
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
    const assignment = room.round.assignments[player.id];
    if (assignment) io.to(player.id).emit('roleAssigned', assignment);
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerHandlers(io, socket, store) {

  // Async-safe helpers — throw on error, caller catches.
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

  // Wraps async handlers so uncaught rejections emit an 'error' event to the socket.
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
  // Join room  (also handles reconnection after page refresh)
  // -------------------------------------------------------------------------
  socket.on('joinRoom', safe(async ({ code, name } = {}) => {
    if (!name?.trim()) throw new Error('Name is required');

    const upperCode  = code?.toUpperCase().trim();
    let   room       = await store.getRoom(upperCode);
    if (!room) throw new Error('Room not found — check the code');

    const trimmedName = name.trim();
    const existing    = room.players.find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (existing) {
      // ── Reconnection path ────────────────────────────────────────────────
      if (existing.connected) throw new Error('Someone with that name is already connected');

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

    // ── New player path ──────────────────────────────────────────────────
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
  // Start game (from lobby)
  // -------------------------------------------------------------------------
  socket.on('startGame', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'lobby') throw new Error('Game is already running');
    if (room.players.length < 3) throw new Error('Need at least 3 players to start');

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
  // Submit a place (player mode — submission phase)
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
  // Start round (host, after all players submitted in player mode)
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
  // Reveal (host, during playing phase)
  // -------------------------------------------------------------------------
  socket.on('revealRound', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'playing') throw new Error('No round is in progress');

    room = revealRound(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Next round / back to lobby (host, reveal phase)
  // -------------------------------------------------------------------------
  socket.on('nextRound', safe(async () => {
    let room = await getHostRoom();
    if (room.phase !== 'reveal') throw new Error('Round has not been revealed yet');

    room = resetToLobby(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------
  socket.on('disconnect', async () => {
    const code = socket.data.roomCode;
    if (!code) return;

    try {
      const room = await store.getRoom(code);
      if (!room) return;

      if (room.hostId === socket.id) {
        io.to(code).emit('roomClosed', { reason: 'The host left the game' });
        await store.deleteRoom(code);
      } else if (room.phase === 'lobby') {
        const updated = removePlayer(room, socket.id);
        await store.setRoom(code, updated);
        broadcastRoomState(io, updated);
      } else {
        const updated = setPlayerConnected(room, socket.id, false);
        await store.setRoom(code, updated);
        broadcastRoomState(io, updated);
      }
    } catch (err) {
      console.error('[disconnect]', err.message);
    }
  });
}
