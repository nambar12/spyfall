/**
 * Pure game-logic functions — no I/O, no side effects.
 * These can be unit-tested in isolation and run identically in a Lambda.
 */

import { PRESET_PLACES } from './places.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode() {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join('');
}

/** Returns a brand-new room object (code assigned by caller to allow retry on collision). */
export function createRoom({ hostId, hostName, spyCount, mode }) {
  return {
    code: null,
    hostId,
    players: [{ id: hostId, name: hostName.trim(), isHost: true, connected: true }],
    config: {
      spyCount: Math.max(1, Math.min(Number(spyCount) || 1, 4)),
      mode: mode === 'player' ? 'player' : 'preset',
    },
    phase: 'lobby', // lobby | submission | playing | reveal
    round: null,
  };
}

export function addPlayer(room, { id, name }) {
  return {
    ...room,
    players: [...room.players, { id, name: name.trim(), isHost: false, connected: true }],
  };
}

export function removePlayer(room, playerId) {
  return { ...room, players: room.players.filter((p) => p.id !== playerId) };
}

export function setPlayerConnected(room, playerId, connected) {
  return {
    ...room,
    players: room.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
  };
}

/** Transition to the place-submission phase (player mode only). */
export function beginSubmissionPhase(room) {
  return { ...room, phase: 'submission', round: { submissions: {} } };
}

/** Record one player's place submission. Returns updated room. */
export function recordSubmission(room, playerId, place) {
  return {
    ...room,
    round: {
      ...room.round,
      submissions: { ...room.round.submissions, [playerId]: place.trim() },
    },
  };
}

/** True when every connected player has submitted a place. */
export function allPlayersSubmitted(room) {
  return room.players
    .filter((p) => p.connected)
    .every((p) => room.round.submissions[p.id]);
}

/**
 * Assign roles and advance to the playing phase.
 *
 * Preset mode  — picks a random place from PRESET_PLACES.
 * Player mode  — picks a random submission; the submitting player is immune to spy selection.
 */
export function beginRound(room) {
  const { players, config, round } = room;
  let place;
  let submitterId = null;

  if (config.mode === 'player') {
    const entries = Object.entries(round.submissions);
    const [pid, pl] = entries[Math.floor(Math.random() * entries.length)];
    submitterId = pid;
    place = pl;
  } else {
    place = PRESET_PLACES[Math.floor(Math.random() * PRESET_PLACES.length)];
  }

  // Spy pool: everyone except the submitter (player mode constraint).
  const spyPool = players.filter((p) => p.id !== submitterId);
  // Guard: at least 1 innocent must remain.
  const actualSpyCount = Math.min(config.spyCount, spyPool.length - 1);

  const shuffled = [...spyPool].sort(() => Math.random() - 0.5);
  const spyIds = new Set(shuffled.slice(0, actualSpyCount).map((p) => p.id));

  const assignments = Object.fromEntries(
    players.map((p) => [
      p.id,
      { role: spyIds.has(p.id) ? 'spy' : 'innocent', place: spyIds.has(p.id) ? null : place },
    ]),
  );

  return {
    ...room,
    phase: 'playing',
    round: { ...round, place, submitterId, assignments },
  };
}

/** Advance to the reveal phase (assignments become public). */
export function revealRound(room) {
  return { ...room, phase: 'reveal' };
}

/** Reset back to the lobby for a new round. */
export function resetToLobby(room) {
  return { ...room, phase: 'lobby', round: null };
}

/**
 * Remap every reference to oldId → newId across the whole room.
 * Called when a player reconnects and gets a new socket ID.
 */
export function remapPlayerId(room, oldId, newId) {
  const remapObj = (obj) => {
    if (!obj || !(oldId in obj)) return obj;
    const { [oldId]: val, ...rest } = obj;
    return { ...rest, [newId]: val };
  };

  return {
    ...room,
    hostId: room.hostId === oldId ? newId : room.hostId,
    players: room.players.map((p) =>
      p.id === oldId ? { ...p, id: newId, connected: true } : p,
    ),
    round: room.round
      ? {
          ...room.round,
          assignments: remapObj(room.round.assignments),
          submissions:  remapObj(room.round.submissions),
          submitterId: room.round.submitterId === oldId ? newId : room.round.submitterId,
        }
      : null,
  };
}
