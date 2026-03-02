/**
 * Local development entry point.
 *
 * For serverless deployment:
 *   1. Replace this file with a thin adapter (e.g. Lambda handler).
 *   2. Swap memoryStore for a persistent store (Redis / DynamoDB).
 *   3. Replace Socket.io with a managed WebSocket service or SSE.
 *      The rest of the codebase — app.js, core/, socketHandlers.js — is unchanged.
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { memoryStore } from './store/memoryStore.js';
import { registerHandlers } from './api/socketHandlers.js';

const store = memoryStore;

const PORT = Number(process.env.PORT) || 3001;
// In production set FRONTEND_URL to your deployed frontend origin.
// In development, `true` tells Socket.io to reflect whatever origin the browser sends.
const corsOrigin = process.env.FRONTEND_URL ?? true;

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`[ws] connected    ${socket.id}`);
  registerHandlers(io, socket, store);
  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnected ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`SpyFall backend → http://localhost:${PORT}`);
});
