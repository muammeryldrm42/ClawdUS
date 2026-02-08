import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import http from "http";
import crypto from "crypto";

import { loadUsers, saveUsers, createUser, verifyUser } from "./users.js";
import { makeRoomCode, clamp, nowMs } from "./util.js";
import { World, defaultSettings } from "./world.js";
import { signToken, authMiddleware, verifyTokenFromQuery } from "./auth.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// In-memory state
const usersDb = loadUsers();
const worlds = new Map(); // roomCode -> World

function getOrCreateWorld(code) {
  let w = worlds.get(code);
  if (!w) {
    w = new World(code, defaultSettings());
    worlds.set(code, w);
  }
  return w;
}

// Health
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Auth: Register (no verification)
app.post("/api/register", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const out = createUser(usersDb, username, password);
    saveUsers(usersDb);
    const token = signToken({ uid: out.id, username: out.username });
    res.json({ ok: true, token, user: { id: out.id, username: out.username } });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// Auth: Login
app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = verifyUser(usersDb, username, password);
    const token = signToken({ uid: user.id, username: user.username });
    res.json({ ok: true, token, user: { id: user.id, username: user.username } });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// Rooms
app.get("/api/rooms/public", authMiddleware, (req, res) => {
  // MVP: just list active rooms
  const list = [];
  for (const [code, w] of worlds.entries()) {
    list.push({ code, players: w.playerCount(), status: w.state.phase });
  }
  res.json({ ok: true, rooms: list.sort((a,b)=>b.players-a.players).slice(0, 25) });
});

app.post("/api/rooms/create", authMiddleware, (req, res) => {
  const code = makeRoomCode();
  const w = getOrCreateWorld(code);
  // host is requester
  w.setHost(req.user.uid);
  res.json({ ok: true, code, settings: w.settings });
});

app.post("/api/rooms/join", authMiddleware, (req, res) => {
  const { code } = req.body || {};
  if (!code || typeof code !== "string") return res.status(400).json({ ok:false, error:"Missing code" });
  const roomCode = code.toUpperCase();
  const w = worlds.get(roomCode);
  if (!w) return res.status(404).json({ ok:false, error:"Room not found" });
  res.json({ ok: true, code: roomCode, settings: w.settings, phase: w.state.phase });
});

app.post("/api/rooms/settings", authMiddleware, (req, res) => {
  const { code, settings } = req.body || {};
  const roomCode = String(code || "").toUpperCase();
  const w = worlds.get(roomCode);
  if (!w) return res.status(404).json({ ok:false, error:"Room not found" });
  if (!w.isHost(req.user.uid)) return res.status(403).json({ ok:false, error:"Only host can change settings" });
  w.updateSettings(settings || {});
  res.json({ ok:true, settings: w.settings });
});

app.post("/api/rooms/start", authMiddleware, (req, res) => {
  const { code } = req.body || {};
  const roomCode = String(code || "").toUpperCase();
  const w = worlds.get(roomCode);
  if (!w) return res.status(404).json({ ok:false, error:"Room not found" });
  if (!w.isHost(req.user.uid)) return res.status(403).json({ ok:false, error:"Only host can start" });
  const ok = w.startMatch();
  if (!ok) return res.status(400).json({ ok:false, error:"Need at least 4 players to start" });
  res.json({ ok:true });
});

const server = http.createServer(app);

// WebSocket server at /ws
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, url);
  });
});

// Very light rate limit for WS messages
function rateLimiter() {
  let tokens = 60;
  let last = nowMs();
  return () => {
    const t = nowMs();
    const dt = t - last;
    last = t;
    tokens = Math.min(60, tokens + dt * 0.06); // refill ~3.6 tokens/sec
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

wss.on("connection", (ws, req, url) => {
  try {
    const token = url.searchParams.get("token") || "";
    const payload = verifyTokenFromQuery(token);
    const uid = payload.uid;
    const username = payload.username;

    const roomCode = (url.searchParams.get("room") || "").toUpperCase();
    if (!roomCode) {
      ws.close(1008, "Missing room");
      return;
    }
    const world = getOrCreateWorld(roomCode);

    const playerId = crypto.randomUUID();
    const limiter = rateLimiter();

    const client = {
      ws,
      uid,
      username,
      playerId,
      roomCode,
      send: (obj) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
      }
    };

    // Join world
    const joinRes = world.addClient(client);
    if (!joinRes.ok) {
      ws.close(1008, joinRes.error || "Join failed");
      return;
    }

    // Initial snapshot
    client.send({ t: "hello", playerId, room: roomCode, hostUid: world.state.hostUid, settings: world.settings });
    client.send({ t: "state", state: world.publicStateFor(uid) });

    ws.on("message", (buf) => {
      if (!limiter()) return;
      let msg;
      try { msg = JSON.parse(buf.toString("utf-8")); } catch { return; }
      world.onClientMessage(client, msg);
    });

    ws.on("close", () => {
      world.removeClient(client);
      // Cleanup empty rooms (after grace)
      if (world.playerCount() === 0) {
        setTimeout(() => {
          const w = worlds.get(roomCode);
          if (w && w.playerCount() === 0) worlds.delete(roomCode);
        }, 30_000);
      }
    });

  } catch (e) {
    try { ws.close(1008, "Auth failed"); } catch {}
  }
});

// Tick loop (authoritative)
setInterval(() => {
  for (const w of worlds.values()) {
    w.tick();
  }
}, 50); // 20Hz

server.listen(PORT, () => {
  console.log(`[clawd-us/server] listening on :${PORT}`);
});
