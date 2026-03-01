/**
 * Redis-backed room store.
 *
 * Implements the same three-method interface as memoryStore so it can be
 * swapped in without touching any other file.
 *
 * Rooms are stored as JSON strings under the key  spyfall:room:<CODE>
 * and auto-expire after 24 hours so stale data never accumulates.
 *
 * Compatible with any standard Redis provider:
 *   Upstash  →  rediss://:password@host:port   (free tier, recommended)
 *   Redis Cloud, Railway, etc. — same format
 */

import Redis from 'ioredis';

const PREFIX  = 'spyfall:room:';
const TTL_SEC = 24 * 60 * 60; // 24 h

export function createRedisStore(url) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('error', (err) => console.error('[redis]', err.message));
  client.on('connect', ()  => console.log('[redis] connected'));

  return {
    async getRoom(code) {
      const raw = await client.get(`${PREFIX}${code}`);
      return raw ? JSON.parse(raw) : null;
    },

    async setRoom(code, room) {
      await client.set(`${PREFIX}${code}`, JSON.stringify(room), 'EX', TTL_SEC);
    },

    async deleteRoom(code) {
      await client.del(`${PREFIX}${code}`);
    },
  };
}
