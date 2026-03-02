/**
 * Thin wrappers over socket.emit so pages never import the socket directly.
 * All validation and error feedback happens server-side via the 'error' event.
 */

import { socket } from './socket.js';

export const api = {
  createRoom: (payload) => socket.emit('createRoom', payload),
  joinRoom:   (payload) => socket.emit('joinRoom', payload),
  startGame:  ()        => socket.emit('startGame'),
  submitPlace:(place)   => socket.emit('submitPlace', { place }),
  startRound: ()        => socket.emit('startRound'),
  revealRound:()        => socket.emit('revealRound'),
  nextRound:  ()        => socket.emit('nextRound'),
  leaveRoom:       ()           => socket.emit('leaveRoom'),
  toggleSuspicion: (targetId)  => socket.emit('toggleSuspicion', { targetId }),
  initiateVote:    (accusedId) => socket.emit('initiateVote', { accusedId }),
  castVote:        (choice)    => socket.emit('castVote', { choice }),
};
