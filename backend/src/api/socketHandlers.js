/**
 * Socket.io event handlers.
 *
 * All business logic delegates to pure functions in core/gameLogic.js.
 * The store is injected, so swapping memory for Redis/DynamoDB requires
 * only a different import in server.js — handlers stay unchanged.
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

/**
 * Strips private data before broadcasting room state.
 * Assignments (roles/places) are never included in the public snapshot —
 * they are sent individually via `roleAssigned`.
 */
function toPublicRoom(room) {
  const base = {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ id, name, isHost, connected }) => ({
      id,
      name,
      isHost,
      connected,
    })),
    config: room.config,
    phase: room.phase,
  };

  if (room.phase === 'submission') {
    // Show *who* submitted but not *what* they submitted.
    base.submittedIds = Object.keys(room.round?.submissions ?? {});
  }

  if (room.phase === 'reveal') {
    base.reveal = {
      place: room.round.place,
      assignments: room.round.assignments,
      submitterId: room.round.submitterId ?? null,
    };
  }

  return base;
}

/** Broadcast updated room state to all sockets in the room. */
function broadcastRoomState(io, room) {
  io.to(room.code).emit('roomState', toPublicRoom(room));
}

/**
 * After a round starts, broadcast the public room state then send each
 * player their private role via a targeted emit.
 */
function broadcastRoundStart(io, room) {
  broadcastRoomState(io, room);
  for (const player of room.players) {
    const assignment = room.round.assignments[player.id];
    if (assignment) {
      // Socket.io creates a default room per socket id — this targets one client.
      io.to(player.id).emit('roleAssigned', assignment);
    }
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerHandlers(io, socket, store) {
  // Convenience: get the room the socket is currently in (throws on failure).
  function getRoom(code) {
    const room = store.getRoom(code ?? socket.data.roomCode);
    if (!room) throw new Error('Room not found');
    return room;
  }

  function getHostRoom(code) {
    const room = getRoom(code);
    if (room.hostId !== socket.id) throw new Error('Only the host can do that');
    return room;
  }

  function safe(handler) {
    return (...args) => {
      try {
        handler(...args);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    };
  }

  // -------------------------------------------------------------------------
  // Create room
  // -------------------------------------------------------------------------
  socket.on(
    'createRoom',
    safe(({ name, spyCount, mode } = {}) => {
      if (!name?.trim()) throw new Error('Name is required');

      // Generate a collision-free code.
      let code;
      do {
        code = generateRoomCode();
      } while (store.getRoom(code));

      const room = { ...createRoom({ hostId: socket.id, hostName: name, spyCount, mode }), code };
      store.setRoom(code, room);

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerName = name.trim();

      socket.emit('roomCreated', { code });
      broadcastRoomState(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Join room  (also handles reconnection after page refresh)
  // -------------------------------------------------------------------------
  socket.on(
    'joinRoom',
    safe(({ code, name } = {}) => {
      if (!name?.trim()) throw new Error('Name is required');

      const upperCode = code?.toUpperCase().trim();
      let room = store.getRoom(upperCode);
      if (!room) throw new Error('Room not found — check the code');

      const trimmedName = name.trim();
      const existing = room.players.find(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      if (existing) {
        // ── Reconnection path ──────────────────────────────────────────────
        // The player already has a slot (from before they refreshed).
        if (existing.connected) {
          throw new Error('Someone with that name is already connected');
        }
        // Remap every reference to the old socket ID → new socket ID.
        room = remapPlayerId(room, existing.id, socket.id);
        store.setRoom(upperCode, room);

        socket.join(upperCode);
        socket.data.roomCode = upperCode;
        socket.data.playerName = trimmedName;

        socket.emit('roomJoined', { code: upperCode });
        broadcastRoomState(io, room);

        // Re-deliver the private role if the round is still in progress.
        if (room.phase === 'playing' && room.round?.assignments?.[socket.id]) {
          socket.emit('roleAssigned', room.round.assignments[socket.id]);
        }
        return;
      }

      // ── New player path ────────────────────────────────────────────────
      if (room.phase !== 'lobby') throw new Error('Game already in progress');
      if (room.players.length >= 12) throw new Error('Room is full (max 12 players)');

      room = addPlayer(room, { id: socket.id, name: trimmedName });
      store.setRoom(upperCode, room);

      socket.join(upperCode);
      socket.data.roomCode = upperCode;
      socket.data.playerName = trimmedName;

      socket.emit('roomJoined', { code: upperCode });
      broadcastRoomState(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Start game (from lobby)
  // -------------------------------------------------------------------------
  socket.on(
    'startGame',
    safe(() => {
      let room = getHostRoom();
      if (room.phase !== 'lobby') throw new Error('Game is already running');
      if (room.players.length < 3) throw new Error('Need at least 3 players to start');

      if (room.config.mode === 'player') {
        room = beginSubmissionPhase(room);
        store.setRoom(room.code, room);
        broadcastRoomState(io, room);
      } else {
        room = beginRound(room);
        store.setRoom(room.code, room);
        broadcastRoundStart(io, room);
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Submit a place (player mode — submission phase)
  // -------------------------------------------------------------------------
  socket.on(
    'submitPlace',
    safe(({ place } = {}) => {
      if (!place?.trim()) throw new Error('Place name cannot be empty');
      if (place.trim().length > 60) throw new Error('Place name is too long (max 60 chars)');

      let room = getRoom();
      if (room.phase !== 'submission') throw new Error('Not in the submission phase');

      room = recordSubmission(room, socket.id, place);
      store.setRoom(room.code, room);
      broadcastRoomState(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Start round (host, after all players submitted in player mode)
  // -------------------------------------------------------------------------
  socket.on(
    'startRound',
    safe(() => {
      let room = getHostRoom();
      if (room.phase !== 'submission') throw new Error('Not in the submission phase');
      if (!allPlayersSubmitted(room)) throw new Error('Waiting for all players to submit');

      room = beginRound(room);
      store.setRoom(room.code, room);
      broadcastRoundStart(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Reveal (host, during playing phase)
  // -------------------------------------------------------------------------
  socket.on(
    'revealRound',
    safe(() => {
      let room = getHostRoom();
      if (room.phase !== 'playing') throw new Error('No round is in progress');

      room = revealRound(room);
      store.setRoom(room.code, room);
      broadcastRoomState(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Next round / back to lobby (host, reveal phase)
  // -------------------------------------------------------------------------
  socket.on(
    'nextRound',
    safe(() => {
      let room = getHostRoom();
      if (room.phase !== 'reveal') throw new Error('Round has not been revealed yet');

      room = resetToLobby(room);
      store.setRoom(room.code, room);
      broadcastRoomState(io, room);
    }),
  );

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = store.getRoom(code);
    if (!room) return;

    if (room.hostId === socket.id) {
      // Host left — close the room for everyone.
      io.to(code).emit('roomClosed', { reason: 'The host left the game' });
      store.deleteRoom(code);
    } else {
      // Regular player left.
      if (room.phase === 'lobby') {
        // Remove from room entirely while in lobby.
        const updated = removePlayer(room, socket.id);
        store.setRoom(code, updated);
        broadcastRoomState(io, updated);
      } else {
        // During a round, mark as disconnected but keep in the assignments.
        const updated = setPlayerConnected(room, socket.id, false);
        store.setRoom(code, updated);
        broadcastRoomState(io, updated);
      }
    }
  });
}
