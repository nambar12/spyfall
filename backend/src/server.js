/**
 * Local development entry point.
 *
 * For serverless deployment:
 *   1. Replace this file with a thin adapter (e.g. Lambda handler).
 *   2. Swap memoryStore for a persistent store (Redis / DynamoDB).
 *   3. Replace Socket.io with a managed WebSocket service or SSE.
 *      The rest of the codebase — app.js, core/, socketHandlers.js — is unchanged.
 */

import { exec } from 'child_process';
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

// --- Idle auto-shutdown (production only) ---
// When no sockets are connected for IDLE_SHUTDOWN_MINUTES, the EC2 instance
// shuts itself down to avoid running (and billing) when not in use.
// The instance is started remotely via the wake Lambda in deploy/wake/.
const IDLE_SHUTDOWN_MS =
  Number(process.env.IDLE_SHUTDOWN_MINUTES ?? 30) * 60_000;
const isProduction = process.env.NODE_ENV === 'production';
let idleTimer = null;

function startIdleTimer() {
  if (!isProduction || idleTimer) return;
  console.log(
    `[idle] No active connections – shutting down in ${IDLE_SHUTDOWN_MS / 60_000} min if nobody joins.`,
  );
  idleTimer = setTimeout(() => {
    console.log('[idle] Idle timeout reached – shutting down instance.');
    exec('sudo shutdown -h now');
  }, IDLE_SHUTDOWN_MS);
}

function cancelIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
    console.log('[idle] Connection received – shutdown cancelled.');
  }
}

// Begin counting from the moment the server starts.
startIdleTimer();

io.on('connection', (socket) => {
  cancelIdleTimer();
  console.log(`[ws] connected    ${socket.id}`);
  registerHandlers(io, socket, store);
  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnected ${socket.id} (${reason})`);
    if (io.sockets.sockets.size === 0) {
      startIdleTimer();
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`SpyFall backend → http://localhost:${PORT}`);
});
