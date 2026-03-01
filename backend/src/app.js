/**
 * Express application factory.
 *
 * Intentionally has no `listen()` call so the same app object can be:
 *   - Wrapped by createServer() + Socket.io for local development (server.js)
 *   - Exported directly for serverless adapters (e.g. @vendia/serverless-express)
 *
 * In production (NODE_ENV=production), serves the built frontend from
 * frontend/dist/ so the whole app runs as a single Render/Fly/Railway service.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Relative to backend/src/ → project root → frontend/dist
const DIST_DIR = join(__dirname, '../../frontend/dist');

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.FRONTEND_URL || '*',
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve the compiled frontend when it exists (production / after `npm run build`).
  // In local dev, Vite runs its own server so this block is skipped.
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    // SPA fallback — let the client-side router handle /room/:code etc.
    app.get('*', (_req, res) => res.sendFile(join(DIST_DIR, 'index.html')));
  }

  return app;
}
