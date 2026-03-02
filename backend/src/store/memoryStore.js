/**
 * In-memory room store.
 *
 * To make the backend serverless-ready, implement the same interface backed
 * by DynamoDB, Redis, or Upstash and swap this import in app.js.
 *
 * Interface:
 *   getRoom(code)          → Room | null
 *   setRoom(code, room)    → void
 *   deleteRoom(code)       → void
 */

const rooms = new Map();

export const memoryStore = {
  getRoom(code) {
    return rooms.get(code) ?? null;
  },

  setRoom(code, room) {
    rooms.set(code, room);
  },

  deleteRoom(code) {
    rooms.delete(code);
  },

  listRooms() {
    return [...rooms.values()];
  },
};
