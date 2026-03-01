import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // bind to 0.0.0.0 so the browser on another machine can reach it
    proxy: {
      // Forward all socket.io traffic to the backend on the same server.
      // The browser only ever talks to Vite's port — no cross-origin issues.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,          // proxy WebSocket upgrades too
        changeOrigin: true,
      },
    },
  },
});
