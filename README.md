# Clawd US (MVP) — Render/Vercel Ready

Online social-deduction inspired game (not a clone).  
**Web**: Next.js + Phaser (deploy to Vercel)  
**Server**: Node.js + WebSocket + REST auth (deploy to Render/Fly/Railway)

## What’s included (MVP)
- Register/Login (username+password, **no verification**)
- Room create/join by code
- Lobby: movement + chat
- Match: hidden roles (Crew/Saboteur), tasks, kill, report, meeting+vote
- Sabotage: Lights Out + Critical Meltdown

## Repo structure
- `apps/web`   → Vercel
- `apps/server`→ WebSocket game server

## Local run (optional)
Prereqs: Node 18+ (recommended 20)

```bash
npm install
npm run dev:server
npm run dev:web
```

Server: http://localhost:8787  
WS: ws://localhost:8787/ws  
Web: http://localhost:3000

## Env vars (web)
For production (Vercel):
- `NEXT_PUBLIC_SERVER_HTTP` (e.g. https://YOUR-SERVER-DOMAIN)
- `NEXT_PUBLIC_SERVER_WS` (e.g. wss://YOUR-SERVER-DOMAIN/ws)

## Deploy: Server on Render (Docker) ✅
Create a **Web Service**:
- **Language:** Docker
- **Branch:** main
- **Root Directory:** `apps/server`
- **Dockerfile Path:** `Dockerfile`

Environment Variables:
- `JWT_SECRET` = long random string

Persistent Disk (recommended so users don’t reset on restart):
- Add Disk → **Mount Path:** `/app/data` (1GB is enough)

Health check:
- `https://YOUR-SERVER/health` → `{ ok: true }`

## Deploy: Web on Vercel ✅
- Import repo
- **Root Directory:** `apps/web`
- Add env vars:
  - `NEXT_PUBLIC_SERVER_HTTP=https://YOUR-SERVER`
  - `NEXT_PUBLIC_SERVER_WS=wss://YOUR-SERVER/ws`

## Notes
- Users are stored in `data/users.json` (server uses `DATA_DIR=/app/data` in Docker).
- This ZIP removes the `COPY data ./data` Docker step that breaks Render builds (because `data/` is created at runtime).
