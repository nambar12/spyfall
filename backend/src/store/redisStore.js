/**
 * Redis-backed room store.
 *
 * Parses the connection URL explicitly so ioredis never falls back to
 * a local Unix socket (which causes EACCES in restricted environments).
 *
 * Tested with Upstash free tier (rediss://default:pass@host.upstash.io:6380).
 */

import Redis from 'ioredis';

const PREFIX  = 'spyfall:room:';
const TTL_SEC = 24 * 60 * 60; // 24 h — rooms auto-expire

export function createRedisStore(connectionUrl) {
  const parsed = new URL(connectionUrl);

  const client = new Redis({
    host:     parsed.hostname,
    port:     Number(parsed.port) || 6379,
    password: parsed.password   || undefined,
    username: parsed.username   || undefined,
    tls:      parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
  });

  client.on('connect', () => console.log('[redis] connected'));
  client.on('error',   (e) => console.error('[redis]', e.message));

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
