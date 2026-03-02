# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands use the Node.js at `/infrastructure/nambar/nodejs/bin/node` (v22). Add it to PATH or invoke with full path.

**Backend** (from `backend/`):
```sh
node --watch src/server.js   # dev with hot-reload, port 3001
node src/server.js           # production
```

**Frontend** (from `frontend/`):
```sh
npx vite                     # dev server, port 5173
npx vite build               # compile to frontend/dist/
```

**Install dependencies:**
```sh
cd backend && /infrastructure/nambar/nodejs/bin/npm install
cd frontend && /infrastructure/nambar/nodejs/bin/npm install
```

There are no tests.

## Architecture

### Data flow
All real-time communication goes through Socket.io — there are no REST endpoints beyond `/health`. Pages never import the socket directly; they use `api.js` emit wrappers and react to state changes via `state.js` subscribers.

### Backend layers

| Layer | Location | Responsibility |
|---|---|---|
| Pure logic | `backend/src/core/gameLogic.js` | All game rules — no I/O, fully testable |
| Store interface | `backend/src/store/` | `getRoom / setRoom / deleteRoom / listRooms` — swap `memoryStore` (dev) for `redisStore` (prod) |
| Socket handlers | `backend/src/api/socketHandlers.js` | Translates socket events → pure function calls → store writes → broadcasts |
| HTTP app | `backend/src/app.js` | No `listen()` call — serves `frontend/dist/` in prod, SPA fallback |
| Entry point | `backend/src/server.js` | Attaches Socket.io, calls `httpServer.listen()`, selects store via `REDIS_URL` |

### Frontend layers

| Layer | Location | Responsibility |
|---|---|---|
| State | `frontend/src/state.js` | Single pub-sub object: `page`, `room`, `rooms`, `myRole`, `socketId` |
| Socket | `frontend/src/socket.js` | All server→client events; updates state; handles reconnection |
| API | `frontend/src/api.js` | Client→server emit wrappers |
| Router | `frontend/src/main.js` | Calls `pages[state.page](app, state)` on every state change |
| Pages | `frontend/src/pages/` | `home`, `lobby`, `submission`, `game`, `reveal` — pure render functions |

### Game phases
`lobby` → `submission` (player mode only) → `playing` → `reveal` → `lobby`

- `roomState` broadcast contains public data only; `roleAssigned` is emitted privately per socket.
- Reveal data (`assignments`, `place`) is included in `roomState` only when `phase === 'reveal'`.
- `roomList` is broadcast to all connected sockets whenever room state changes; contains lobby-phase rooms only.

### No-host model
- There is no host. Any player can start the game, reveal the round, or start the next round.
- Rooms are discovered via a live list on the home page — no link sharing required.
- The home page shows a shared name input; clicking a room in the list joins it directly.

### Disconnect / inactivity policy
- Any player disconnects → marked `connected: false` immediately.
- If **all** players in a room are offline → 15-minute inactivity timer starts.
- Any reconnection cancels the timer.
- After 15 minutes with everyone offline → room deleted, `roomClosed` emitted.
- In-game players: stay in assignments; rejoin via `joinRoom` with the same name → `remapPlayerId` transfers their slot.
- The frontend auto-rejoins on socket reconnect using the saved session (name + room code in `sessionStorage`).

### Environment variables
| Variable | Used in | Effect |
|---|---|---|
| `REDIS_URL` | backend | Activates `redisStore` instead of in-memory. Format: `rediss://default:pass@host:port` |
| `PORT` | backend | HTTP listen port (default `3001`) |
| `FRONTEND_URL` | backend | CORS origin (default `*` in dev) |
| `VITE_BACKEND_URL` | frontend build | Socket.io server URL (omit = same origin) |
