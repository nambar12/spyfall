/**
 * Socket.io event handlers.
 *
 * All business logic delegates to pure functions in core/gameLogic.js.
 * The store is injected — memoryStore (dev) or redisStore (prod).
 *
 * Disconnect policy:
 *   Any player disconnects → marked offline immediately.
 *   If ALL players in a room are offline → 15-minute inactivity timer starts.
 *   Any reconnection cancels the timer.
 *   After 15 minutes of everyone offline → room is deleted.
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
  toggleSuspicion,
  initiateVote,
  castVote,
  resolveVote,
} from '../core/gameLogic.js';

// ---------------------------------------------------------------------------
// Module-level inactivity timers (in-process; survive reconnects, not restarts)
// ---------------------------------------------------------------------------

/** roomCode → timerId  —  fires when every player has been offline for 15 min */
const inactivityTimers = new Map();

function cancelInactivityTimer(code) {
  if (inactivityTimers.has(code)) {
    clearTimeout(inactivityTimers.get(code));
    inactivityTimers.delete(code);
  }
}

function scheduleInactivityDelete(code, io, store) {
  if (inactivityTimers.has(code)) return; // already scheduled
  console.log(`[room ${code}] all players offline — starting 15-min inactivity timer`);
  const timerId = setTimeout(async () => {
    inactivityTimers.delete(code);
    try {
      const current = await store.getRoom(code);
      if (!current) return;
      if (current.players.some((p) => p.connected)) return; // someone came back
      console.log(`[room ${code}] inactivity timeout — closing room`);
      io.to(code).emit('roomClosed', { reason: 'Room closed due to inactivity' });
      await store.deleteRoom(code);
      broadcastRoomList(io, store);
    } catch (e) { console.error('[inactivityTimer]', e.message); }
  }, 15 * 60 * 1000);
  inactivityTimers.set(code, timerId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRoomList(rooms) {
  return rooms
    .filter((r) => r.phase === 'lobby')
    .map((r) => ({
      code:           r.code,
      connectedCount: r.players.filter((p) => p.connected).length,
      totalPlayers:   r.players.length,
      mode:           r.config.mode,
      spyCount:       r.config.spyCount,
      phase:          r.phase,
    }));
}

async function broadcastRoomList(io, store) {
  try {
    const rooms = await store.listRooms();
    io.emit('roomList', toRoomList(rooms));
  } catch (e) { console.error('[broadcastRoomList]', e.message); }
}

function toPublicRoom(room) {
  const base = {
    code:    room.code,
    players: room.players.map(({ id, name, connected }) => ({ id, name, connected })),
    config:  room.config,
    phase:   room.phase,
  };
  if (room.phase === 'submission') {
    base.submittedIds = Object.keys(room.round?.submissions ?? {});
  }
  if (room.phase === 'playing' || room.phase === 'reveal') {
    base.suspicions = room.round?.suspicions ?? {};
  }
  if (room.vote) {
    base.vote = {
      accuserId: room.vote.accuserId,
      accusedId: room.vote.accusedId,
      votedIds:  Object.keys(room.vote.votes),
      resolved:  room.vote.resolved,
      result:    room.vote.result,
    };
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
// Vote resolution helpers (module-level so setTimeout callbacks can call them)
// ---------------------------------------------------------------------------

/** After the result animation delay, apply the vote's consequences. */
async function applyVoteConsequences(code, io, store) {
  try {
    let room = await store.getRoom(code);
    if (!room?.vote?.resolved) return; // already cleared (e.g. room restarted)

    const { result, accusedId } = room.vote;
    room = { ...room, vote: null };

    if (result === 'spy_caught') {
      room = revealRound(room);
    } else if (result === 'wrong') {
      room = removePlayer(room, accusedId);
      if (room.players.length === 0) {
        await store.deleteRoom(code);
        broadcastRoomList(io, store);
        return;
      }
    }
    // 'failed': vote already cleared above

    await store.setRoom(code, room);
    broadcastRoomState(io, room);
    broadcastRoomList(io, store);
  } catch (e) { console.error('[applyVoteConsequences]', e.message); }
}

/** Attempt to resolve the vote; if resolved, broadcast and schedule consequences. */
async function handleVoteCheck(code, room, io, store) {
  const resolved = resolveVote(room);
  if (!resolved) return;
  await store.setRoom(code, resolved);
  broadcastRoomState(io, resolved);
  setTimeout(() => applyVoteConsequences(code, io, store), 3500);
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerHandlers(io, socket, store) {

  // Send current room list to the newly connected socket.
  Promise.resolve(store.listRooms()).then((rooms) => socket.emit('roomList', toRoomList(rooms))).catch(() => {});

  async function getRoom(code) {
    const room = await store.getRoom(code ?? socket.data.roomCode);
    if (!room) throw new Error('Room not found');
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

    const room = { ...createRoom({ creatorId: socket.id, creatorName: name, spyCount, mode }), code };
    await store.setRoom(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    broadcastRoomState(io, room);
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Join room  (also handles reconnection after backgrounding / page refresh)
  // -------------------------------------------------------------------------
  socket.on('joinRoom', safe(async ({ code, name } = {}) => {
    if (!name?.trim()) throw new Error('Name is required');

    const upperCode   = code?.toUpperCase().trim();
    let   room        = await store.getRoom(upperCode);
    if (!room) throw new Error('Room not found');

    const trimmedName = name.trim();
    const existing    = room.players.find(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (existing) {
      // ── Reconnection path ──────────────────────────────────────────────
      // Guard against the race where the client reconnects before the server
      // has processed the disconnect of the old socket (e.g. long-polling
      // pingTimeout). If the old socket ID is genuinely still live in
      // Socket.io, reject. Otherwise let the new connection take over.
      if (existing.connected && io.sockets.sockets.has(existing.id)) {
        throw new Error('Someone with that name is already connected');
      }

      cancelInactivityTimer(upperCode);

      room = remapPlayerId(room, existing.id, socket.id);
      await store.setRoom(upperCode, room);

      socket.join(upperCode);
      socket.data.roomCode = upperCode;

      broadcastRoomState(io, room);
      broadcastRoomList(io, store);

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

    broadcastRoomState(io, room);
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Start game  (any player)
  // -------------------------------------------------------------------------
  socket.on('startGame', safe(async () => {
    let room = await getRoom();
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
    broadcastRoomList(io, store);
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
  // Start round  (any player)
  // -------------------------------------------------------------------------
  socket.on('startRound', safe(async () => {
    let room = await getRoom();
    if (room.phase !== 'submission') throw new Error('Not in the submission phase');
    if (!allPlayersSubmitted(room)) throw new Error('Waiting for all players to submit');

    room = beginRound(room);
    await store.setRoom(room.code, room);
    broadcastRoundStart(io, room);
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Reveal  (any player)
  // -------------------------------------------------------------------------
  socket.on('revealRound', safe(async () => {
    let room = await getRoom();
    if (room.phase !== 'playing') throw new Error('No round is in progress');

    room = revealRound(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Next round  (any player)
  // -------------------------------------------------------------------------
  socket.on('nextRound', safe(async () => {
    let room = await getRoom();
    if (room.phase !== 'reveal') throw new Error('Round has not been revealed yet');

    room = resetToLobby(room);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Suspect / un-suspect a player
  // -------------------------------------------------------------------------
  socket.on('toggleSuspicion', safe(async ({ targetId } = {}) => {
    if (!targetId) return;
    let room = await getRoom();
    if (room.phase !== 'playing') return;
    if (targetId === socket.id) return;
    if (!room.players.find((p) => p.id === targetId)) return;

    room = toggleSuspicion(room, socket.id, targetId);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
  }));

  // -------------------------------------------------------------------------
  // Initiate a vote
  // -------------------------------------------------------------------------
  socket.on('initiateVote', safe(async ({ accusedId } = {}) => {
    if (!accusedId) return;
    let room = await getRoom();
    if (room.phase !== 'playing') return;
    if (room.vote) throw new Error('A vote is already in progress');
    if (accusedId === socket.id) throw new Error('Cannot accuse yourself');
    if (!room.players.find((p) => p.id === accusedId && p.connected)) throw new Error('Player not found');

    room = initiateVote(room, socket.id, accusedId);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
    // Accuser auto-voted yes — might already be majority in tiny rooms.
    await handleVoteCheck(room.code, room, io, store);
  }));

  // -------------------------------------------------------------------------
  // Cast a vote
  // -------------------------------------------------------------------------
  socket.on('castVote', safe(async ({ choice } = {}) => {
    if (choice !== 'yes' && choice !== 'no') return;
    let room = await getRoom();
    if (room.phase !== 'playing' || !room.vote || room.vote.resolved) return;
    if (socket.id === room.vote.accusedId) return; // accused cannot vote
    if (room.vote.votes[socket.id] !== undefined) return; // already voted

    room = castVote(room, socket.id, choice);
    await store.setRoom(room.code, room);
    broadcastRoomState(io, room);
    await handleVoteCheck(room.code, room, io, store);
  }));

  // -------------------------------------------------------------------------
  // Leave room  (explicit, voluntary exit)
  // -------------------------------------------------------------------------
  socket.on('leaveRoom', safe(async () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = await store.getRoom(code);
    if (!room) return;

    socket.leave(code);
    socket.data.roomCode = null;
    socket.emit('leftRoom');

    let remaining = removePlayer(room, socket.id);

    // If the accused leaves, cancel the vote.
    if (remaining.vote && remaining.vote.accusedId === socket.id) {
      remaining = { ...remaining, vote: null };
    }

    if (remaining.players.length === 0) {
      await store.deleteRoom(code);
    } else {
      await store.setRoom(code, remaining);
      broadcastRoomState(io, remaining);
      if (!remaining.players.some((p) => p.connected)) {
        scheduleInactivityDelete(code, io, store);
      }
      // A voter leaving might tip a pending vote to resolution.
      if (remaining.vote && !remaining.vote.resolved) {
        await handleVoteCheck(code, remaining, io, store);
      }
    }
    broadcastRoomList(io, store);
  }));

  // -------------------------------------------------------------------------
  // Disconnect  — 15-min inactivity timer when everyone is offline
  // -------------------------------------------------------------------------
  socket.on('disconnect', async () => {
    const code = socket.data.roomCode;
    if (!code) return;

    try {
      const room = await store.getRoom(code);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      let updated = setPlayerConnected(room, socket.id, false);
      await store.setRoom(code, updated);
      broadcastRoomState(io, updated);
      broadcastRoomList(io, store);

      if (!updated.players.some((p) => p.connected)) {
        scheduleInactivityDelete(code, io, store);
      }

      // A disconnecting voter might change vote majority — re-check.
      if (updated.vote && !updated.vote.resolved) {
        await handleVoteCheck(code, updated, io, store);
      }
    } catch (err) {
      console.error('[disconnect]', err.message);
    }
  });
}
