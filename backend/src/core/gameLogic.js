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
export function createRoom({ creatorId, creatorName, spyCount, mode }) {
  return {
    code: null,
    players: [{ id: creatorId, name: creatorName.trim(), connected: true }],
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
    players: [...room.players, { id, name: name.trim(), connected: true }],
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

  const shuffled = [...spyPool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
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
    round: { ...round, place, submitterId, assignments, suspicions: {}, revealVotes: [] },
  };
}

/** Toggle a player's "ready to reveal" vote. Returns updated room. */
export function toggleRevealVote(room, playerId) {
  const votes   = room.round?.revealVotes ?? [];
  const updated = votes.includes(playerId)
    ? votes.filter((id) => id !== playerId)
    : [...votes, playerId];
  return { ...room, round: { ...room.round, revealVotes: updated } };
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

/** Start a vote: accuser's yes is recorded immediately. */
export function initiateVote(room, accuserId, accusedId) {
  return {
    ...room,
    vote: { accuserId, accusedId, votes: { [accuserId]: 'yes' }, resolved: false, result: null },
  };
}

/** Record one player's vote choice. */
export function castVote(room, voterId, choice) {
  return {
    ...room,
    vote: { ...room.vote, votes: { ...room.vote.votes, [voterId]: choice } },
  };
}

/**
 * Check whether the vote can be resolved now.
 * Returns the updated room (with resolved vote) or null if still pending.
 */
export function resolveVote(room) {
  const { vote, players } = room;
  if (!vote || vote.resolved) return null;

  // Only connected non-accused players vote.
  const voters = players.filter((p) => p.connected && p.id !== vote.accusedId);
  const total   = voters.length;

  if (total === 0) {
    return { ...room, vote: { ...vote, resolved: true, result: 'failed' } };
  }

  const yesCount = Object.values(vote.votes).filter((v) => v === 'yes').length;
  const noCount  = Object.values(vote.votes).filter((v) => v === 'no').length;
  const majority = Math.floor(total / 2) + 1;

  let result = null;
  if (yesCount >= majority) {
    result = room.round?.assignments?.[vote.accusedId]?.role === 'spy' ? 'spy_caught' : 'wrong';
  } else if (noCount >= majority || yesCount + noCount >= total) {
    result = 'failed';
  }

  if (!result) return null;
  return { ...room, vote: { ...vote, resolved: true, result } };
}

// ---------------------------------------------------------------------------
// Suspicion
// ---------------------------------------------------------------------------

/**
 * Toggle one player's suspicion of another.
 * suspicions: { suspectorId: [targetId, ...] }
 */
export function toggleSuspicion(room, suspectorId, targetId) {
  const suspicions = room.round?.suspicions ?? {};
  const mine = suspicions[suspectorId] ?? [];
  const updated = mine.includes(targetId)
    ? mine.filter((id) => id !== targetId)
    : [...mine, targetId];
  return {
    ...room,
    round: { ...room.round, suspicions: { ...suspicions, [suspectorId]: updated } },
  };
}

/** Advance to the reveal phase (assignments become public). */
export function revealRound(room) {
  return { ...room, phase: 'reveal' };
}

/** Reset back to the lobby for a new round. */
export function resetToLobby(room) {
  return { ...room, phase: 'lobby', round: null, vote: null };
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

  const remapSuspicions = (suspicions) => {
    if (!suspicions) return suspicions;
    const result = {};
    for (const [sid, targets] of Object.entries(suspicions)) {
      result[sid === oldId ? newId : sid] = targets.map((t) => (t === oldId ? newId : t));
    }
    return result;
  };

  return {
    ...room,
    players: room.players.map((p) =>
      p.id === oldId ? { ...p, id: newId, connected: true } : p,
    ),
    vote: room.vote ? {
      ...room.vote,
      accuserId: room.vote.accuserId === oldId ? newId : room.vote.accuserId,
      accusedId: room.vote.accusedId === oldId ? newId : room.vote.accusedId,
      votes:     remapObj(room.vote.votes),
    } : room.vote,
    round: room.round
      ? {
          ...room.round,
          assignments:  remapObj(room.round.assignments),
          submissions:  remapObj(room.round.submissions),
          submitterId:  room.round.submitterId === oldId ? newId : room.round.submitterId,
          suspicions:   remapSuspicions(room.round.suspicions),
          revealVotes:  (room.round.revealVotes ?? []).map((id) => (id === oldId ? newId : id)),
        }
      : null,
  };
}
