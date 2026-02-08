import crypto from "crypto";
import { clamp, nowMs } from "./util.js";

export function defaultSettings() {
  return {
    maxPlayers: 10,
    saboteurs: 1,            // 1-2 (MVP)
    killCooldownMs: 30_000,
    meetingDiscussMs: 90_000,
    meetingVoteMs: 30_000,
    tasksPerPlayer: 3,        // 2-5
    revealRolesOnEject: false,
    emergencyMeetingsPerPlayer: 1,
    lightsDurationMs: 25_000,
    meltdownDurationMs: 45_000
  };
}

// Simple world layout: positions in pixels (top-down)
export const MAP = {
  width: 1200,
  height: 800,
  spawn: { x: 600, y: 400 },
  // Interactable objects
  objects: [
    // Tasks
    { id: "task_lab_scan", type: "task", taskType: "lab_scan", x: 980, y: 180, radius: 60, label: "Lab Scan" },
    { id: "task_wires", type: "task", taskType: "wires", x: 260, y: 160, radius: 60, label: "Wire Patch" },
    { id: "task_fuel", type: "task", taskType: "fuel", x: 980, y: 640, radius: 60, label: "Fuel Pump" },
    { id: "task_security", type: "task", taskType: "security_log", x: 600, y: 120, radius: 60, label: "Security Log" },
    { id: "task_storage", type: "task", taskType: "storage_sort", x: 240, y: 650, radius: 60, label: "Storage Sort" },

    // Sabotage fix panels
    { id: "fix_lights", type: "fix", fixType: "lights", x: 160, y: 400, radius: 70, label: "Electrical Panel" },
    { id: "fix_meltdown_a", type: "fix", fixType: "meltdown_a", x: 1040, y: 420, radius: 70, label: "Reactor Panel" },
    { id: "fix_meltdown_b", type: "fix", fixType: "meltdown_b", x: 720, y: 700, radius: 70, label: "Lab Panel" },

    // Meeting button
    { id: "meeting_button", type: "meeting", x: 600, y: 420, radius: 90, label: "Emergency Table" }
  ]
};

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx*dx + dy*dy;
}

export class World {
  constructor(roomCode, settings) {
    this.roomCode = roomCode;
    this.settings = settings;
    this.clients = new Map(); // playerId -> client
    this.players = new Map(); // playerId -> player state
    this.bodies = new Map();  // bodyId -> {x,y, victimPid}
    this.chat = [];
    this.state = {
      phase: "lobby", // lobby | playing | meeting | ended
      hostUid: null,
      startedAt: null,
      meeting: null,
      sabotage: { lights: { active:false, endsAt:0 }, meltdown: { active:false, endsAt:0, fixedA:false, fixedB:false } },
      taskProgress: { done: 0, total: 0 },
      winner: null
    };
    this._lastBroadcast = 0;
  }

  playerCount() { return this.players.size; }
  isHost(uid) { return this.state.hostUid === uid; }
  setHost(uid) { this.state.hostUid = uid; }

  updateSettings(partial) {
    // clamp some settings
    const s = { ...this.settings, ...partial };
    s.maxPlayers = clamp(Number(s.maxPlayers||10), 4, 12);
    s.saboteurs = clamp(Number(s.saboteurs||1), 1, 2);
    s.killCooldownMs = clamp(Number(s.killCooldownMs||30000), 10_000, 60_000);
    s.tasksPerPlayer = clamp(Number(s.tasksPerPlayer||3), 2, 5);
    s.meetingDiscussMs = clamp(Number(s.meetingDiscussMs||90000), 30_000, 180_000);
    s.meetingVoteMs = clamp(Number(s.meetingVoteMs||30000), 15_000, 60_000);
    s.emergencyMeetingsPerPlayer = clamp(Number(s.emergencyMeetingsPerPlayer||1), 0, 2);
    s.lightsDurationMs = clamp(Number(s.lightsDurationMs||25000), 10_000, 60_000);
    s.meltdownDurationMs = clamp(Number(s.meltdownDurationMs||45000), 20_000, 90_000);
    s.revealRolesOnEject = !!s.revealRolesOnEject;
    this.settings = s;
  }

  addClient(client) {
    if (this.players.size >= this.settings.maxPlayers) return { ok:false, error:"Room full" };
    if (!this.state.hostUid) this.state.hostUid = client.uid;

    this.clients.set(client.playerId, client);

    const spawn = MAP.spawn;
    const player = {
      id: client.playerId,
      uid: client.uid,
      username: client.username,
      x: spawn.x + (Math.random()*40-20),
      y: spawn.y + (Math.random()*40-20),
      vx: 0, vy: 0,
      speed: 240, // px/sec
      input: { up:false, down:false, left:false, right:false },
      alive: true,
      role: "crew", // hidden from others
      killReadyAt: 0,
      meetingsLeft: this.settings.emergencyMeetingsPerPlayer,
      tasks: [], // assigned object ids
      tasksDone: new Set()
    };
    this.players.set(client.playerId, player);

    this.broadcast({ t:"event.player_join", username: player.username });
    return { ok:true };
  }

  removeClient(client) {
    const p = this.players.get(client.playerId);
    this.clients.delete(client.playerId);
    this.players.delete(client.playerId);
    if (p) this.broadcast({ t:"event.player_leave", username: p.username });

    // If host left, assign new host
    if (p && this.state.hostUid === p.uid) {
      const next = [...this.players.values()][0];
      this.state.hostUid = next ? next.uid : null;
      this.broadcast({ t:"event.host", hostUid: this.state.hostUid });
    }

    // End match if too few players
    if (this.state.phase !== "lobby" && this.players.size < 3) {
      this.endMatch("crew"); // arbitrary safe end
    }
  }

  publicStateFor(uid) {
    // Build a state that hides roles except for self
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        username: p.username,
        x: p.x, y: p.y,
        alive: p.alive,
        // role only for self
        role: p.uid === uid ? p.role : undefined,
        meetingsLeft: p.uid === uid ? p.meetingsLeft : undefined,
        tasks: p.uid === uid ? p.tasks : undefined,
        tasksDone: p.uid === uid ? [...p.tasksDone] : undefined,
        killCooldownMs: p.uid === uid && p.role === "saboteur" ? Math.max(0, p.killReadyAt - nowMs()) : undefined
      });
    }
    const bodies = [...this.bodies.entries()].map(([id,b])=>({ id, x:b.x, y:b.y }));
    return {
      room: this.roomCode,
      phase: this.state.phase,
      hostUid: this.state.hostUid,
      settings: this.settings,
      map: { width: MAP.width, height: MAP.height, objects: MAP.objects },
      players,
      bodies,
      sabotage: this.state.sabotage,
      taskProgress: this.state.taskProgress,
      meeting: this.state.meeting ? {
        endsAt: this.state.meeting.endsAt,
        stage: this.state.meeting.stage,
        votes: this.state.meeting.stage === "vote" ? this.state.meeting.votesPublic() : undefined,
        reportedBy: this.state.meeting.reportedBy,
        reportLocation: this.state.meeting.reportLocation
      } : null,
      winner: this.state.winner
    };
  }

  sendTo(client, obj) { client.send(obj); }
  broadcast(obj) {
    for (const c of this.clients.values()) c.send(obj);
  }

  startMatch() {
    if (this.players.size < 4) return false;
    if (this.state.phase !== "lobby") return false;

    // reset
    this.bodies.clear();
    for (const p of this.players.values()) {
      p.alive = true;
      p.killReadyAt = 0;
      p.tasksDone = new Set();
      p.meetingsLeft = this.settings.emergencyMeetingsPerPlayer;
    }

    // assign roles
    const all = [...this.players.values()];
    shuffle(all);
    const sabCount = clamp(this.settings.saboteurs, 1, Math.max(1, Math.floor(all.length/4)));
    const saboteurs = new Set(all.slice(0, sabCount).map(p=>p.id));
    for (const p of all) {
      p.role = saboteurs.has(p.id) ? "saboteur" : "crew";
    }

    // assign tasks to crews
    const taskObjects = MAP.objects.filter(o=>o.type==="task").map(o=>o.id);
    let total = 0;
    for (const p of all) {
      p.tasks = [];
      if (p.role === "crew") {
        const pick = pickN(taskObjects, this.settings.tasksPerPlayer);
        p.tasks = pick;
        total += pick.length;
      }
    }
    this.state.taskProgress = { done: 0, total };

    // reset sabotage
    this.state.sabotage = {
      lights: { active:false, endsAt:0 },
      meltdown: { active:false, endsAt:0, fixedA:false, fixedB:false }
    };

    this.state.phase = "playing";
    this.state.startedAt = nowMs();
    this.state.meeting = null;
    this.state.winner = null;

    this.broadcast({ t:"event.match_start" });
    this.broadcast({ t:"state", state: this.publicStateForSelfBroadcast() });
    return true;
  }

  publicStateForSelfBroadcast() {
    // For broadcast, we send per-client tailored self info.
    // We'll instead send a lightweight "state-lite" and follow with per-client self payload.
    return null;
  }

  endMatch(winner) {
    this.state.phase = "ended";
    this.state.winner = winner;
    this.state.meeting = null;
    this.broadcast({ t:"event.match_end", winner });
  }

  // Client message router
  onClientMessage(client, msg) {
    const p = this.players.get(client.playerId);
    if (!p) return;

    switch (msg.t) {
      case "input":
        if (this.state.phase === "meeting" || this.state.phase === "ended") return;
        this.handleInput(p, msg);
        break;
      case "chat":
        this.handleChat(client, p, msg);
        break;
      case "action.interact":
        this.handleInteract(client, p, msg);
        break;
      case "action.kill":
        this.handleKill(client, p, msg);
        break;
      case "action.report":
        this.handleReport(client, p, msg);
        break;
      case "action.meeting_call":
        this.handleMeetingCall(client, p);
        break;
      case "action.vote":
        this.handleVote(client, p, msg);
        break;
      case "action.sabotage":
        this.handleSabotage(client, p, msg);
        break;
      default:
        break;
    }
  }

  handleInput(p, msg) {
    const i = msg.input || {};
    p.input.up = !!i.up;
    p.input.down = !!i.down;
    p.input.left = !!i.left;
    p.input.right = !!i.right;
  }

  handleChat(client, p, msg) {
    const text = String(msg.text || "").slice(0, 180);
    if (!text.trim()) return;

    // In match: allow only in lobby or meeting for MVP
    if (this.state.phase === "playing") return;

    this.broadcast({ t:"chat", from: p.username, text, ts: nowMs() });
  }

  handleInteract(client, p, msg) {
    if (this.state.phase !== "playing") return;
    if (!p.alive) return;

    const objId = String(msg.objectId || "");
    const obj = MAP.objects.find(o=>o.id===objId);
    if (!obj) return;

    const near = dist2(p.x, p.y, obj.x, obj.y) <= (obj.radius*obj.radius);
    if (!near) return;

    if (obj.type === "task") {
      if (p.role !== "crew") return;
      if (!p.tasks.includes(obj.id)) return;
      if (p.tasksDone.has(obj.id)) return;

      // Server-side complete instantly for MVP (client shows progress animation)
      p.tasksDone.add(obj.id);
      this.state.taskProgress.done += 1;

      this.sendTo(client, { t:"event.task_complete", objectId: obj.id });
      this.broadcast({ t:"event.task_progress", done: this.state.taskProgress.done, total: this.state.taskProgress.total });

      if (this.state.taskProgress.done >= this.state.taskProgress.total) {
        this.endMatch("crew");
      }
      return;
    }

    if (obj.type === "fix") {
      // Fix lights
      if (obj.fixType === "lights") {
        if (!this.state.sabotage.lights.active) return;
        this.state.sabotage.lights.active = false;
        this.state.sabotage.lights.endsAt = 0;
        this.broadcast({ t:"event.sabotage_end", kind:"lights" });
        return;
      }
      // Fix meltdown
      if (this.state.sabotage.meltdown.active) {
        if (obj.fixType === "meltdown_a") this.state.sabotage.meltdown.fixedA = true;
        if (obj.fixType === "meltdown_b") this.state.sabotage.meltdown.fixedB = true;

        this.broadcast({ t:"event.meltdown_fix", fixedA: this.state.sabotage.meltdown.fixedA, fixedB: this.state.sabotage.meltdown.fixedB });

        if (this.state.sabotage.meltdown.fixedA && this.state.sabotage.meltdown.fixedB) {
          this.state.sabotage.meltdown.active = false;
          this.state.sabotage.meltdown.endsAt = 0;
          this.broadcast({ t:"event.sabotage_end", kind:"meltdown" });
        }
      }
      return;
    }
  }

  handleKill(client, p, msg) {
    if (this.state.phase !== "playing") return;
    if (!p.alive) return;
    if (p.role !== "saboteur") return;

    const t = nowMs();
    if (t < p.killReadyAt) return;

    const targetId = String(msg.targetId || "");
    const q = this.players.get(targetId);
    if (!q || !q.alive) return;
    if (q.role === "saboteur") return;

    const range = 70; // px
    if (dist2(p.x, p.y, q.x, q.y) > range*range) return;

    // kill
    q.alive = false;
    const bodyId = crypto.randomUUID();
    this.bodies.set(bodyId, { x: q.x, y: q.y, victimPid: q.id });
    p.killReadyAt = t + this.settings.killCooldownMs;

    this.broadcast({ t:"event.kill", victim: q.username });
    this.broadcast({ t:"event.body_spawn", body: { id: bodyId, x: q.x, y: q.y } });

    this.checkParityWin();
  }

  handleReport(client, p, msg) {
    if (this.state.phase !== "playing") return;
    if (!p.alive) return;
    const bodyId = String(msg.bodyId || "");
    const body = this.bodies.get(bodyId);
    if (!body) return;
    if (dist2(p.x, p.y, body.x, body.y) > 90*90) return;

    // remove body (reported)
    this.bodies.delete(bodyId);
    this.startMeeting(p.username, { x: body.x, y: body.y });
  }

  handleMeetingCall(client, p) {
    if (this.state.phase !== "playing") return;
    if (!p.alive) return;
    if (p.meetingsLeft <= 0) return;

    // must be near meeting button
    const obj = MAP.objects.find(o=>o.id==="meeting_button");
    if (!obj) return;
    if (dist2(p.x, p.y, obj.x, obj.y) > obj.radius*obj.radius) return;

    p.meetingsLeft -= 1;
    this.startMeeting(p.username, { x: obj.x, y: obj.y });
  }

  startMeeting(reportedBy, reportLocation) {
    this.state.phase = "meeting";
    const endsAt = nowMs() + this.settings.meetingDiscussMs;

    const meeting = {
      stage: "discuss", // discuss -> vote -> resolve
      endsAt,
      reportedBy,
      reportLocation,
      votes: new Map(), // voterPid -> targetPid|"skip"
      votesPublic() {
        // public tally
        const tally = {};
        for (const v of this.votes.values()) {
          tally[v] = (tally[v] || 0) + 1;
        }
        return tally;
      }
    };
    this.state.meeting = meeting;

    this.broadcast({ t:"event.meeting_start", reportedBy, reportLocation, discussEndsAt: endsAt });
  }

  handleVote(client, p, msg) {
    if (this.state.phase !== "meeting") return;
    if (!p.alive) return;
    const m = this.state.meeting;
    if (!m) return;

    // Only during vote stage
    if (m.stage !== "vote") return;

    const target = msg.target;
    if (target !== "skip" && !this.players.has(String(target))) return;
    m.votes.set(p.id, target);
    this.broadcast({ t:"event.vote_cast", from: p.username });

    // If everyone voted (alive players)
    const alive = [...this.players.values()].filter(x=>x.alive);
    if (m.votes.size >= alive.length) {
      this.resolveVote();
    }
  }

  handleSabotage(client, p, msg) {
    if (this.state.phase !== "playing") return;
    if (!p.alive) return;
    if (p.role !== "saboteur") return;

    const kind = String(msg.kind || "");
    if (kind === "lights") {
      if (this.state.sabotage.lights.active) return;
      this.state.sabotage.lights.active = true;
      this.state.sabotage.lights.endsAt = nowMs() + this.settings.lightsDurationMs;
      this.broadcast({ t:"event.sabotage_start", kind:"lights", endsAt: this.state.sabotage.lights.endsAt });
      return;
    }
    if (kind === "meltdown") {
      if (this.state.sabotage.meltdown.active) return;
      this.state.sabotage.meltdown.active = true;
      this.state.sabotage.meltdown.fixedA = false;
      this.state.sabotage.meltdown.fixedB = false;
      this.state.sabotage.meltdown.endsAt = nowMs() + this.settings.meltdownDurationMs;
      this.broadcast({ t:"event.sabotage_start", kind:"meltdown", endsAt: this.state.sabotage.meltdown.endsAt });
      return;
    }
  }

  resolveVote() {
    const m = this.state.meeting;
    if (!m) return;
    // Tally
    const tally = new Map(); // target -> count
    for (const v of m.votes.values()) {
      tally.set(v, (tally.get(v) || 0) + 1);
    }

    // Find max excluding skip if tie
    let max = 0;
    let winner = null;
    let tie = false;
    for (const [target, cnt] of tally.entries()) {
      if (cnt > max) { max = cnt; winner = target; tie = false; }
      else if (cnt === max) { tie = true; }
    }

    let ejected = null;
    if (!tie && winner && winner !== "skip") {
      const p = this.players.get(winner);
      if (p && p.alive) {
        p.alive = false;
        ejected = { username: p.username, role: this.settings.revealRolesOnEject ? p.role : null };
      }
    }

    this.broadcast({ t:"event.vote_result", ejected, tally: Object.fromEntries(tally) });

    // End meeting, resume play
    this.state.phase = "playing";
    this.state.meeting = null;

    // Win checks
    this.checkParityWin();
  }

  checkParityWin() {
    if (this.state.phase !== "playing") return;
    const alive = [...this.players.values()].filter(x=>x.alive);
    const sab = alive.filter(x=>x.role==="saboteur").length;
    const crew = alive.filter(x=>x.role==="crew").length;
    if (sab >= crew && sab > 0) this.endMatch("saboteur");
  }

  tick() {
    const t = nowMs();

    // Meeting stage transitions
    if (this.state.phase === "meeting" && this.state.meeting) {
      const m = this.state.meeting;
      if (t >= m.endsAt) {
        if (m.stage === "discuss") {
          m.stage = "vote";
          m.endsAt = t + this.settings.meetingVoteMs;
          this.broadcast({ t:"event.meeting_vote_start", voteEndsAt: m.endsAt });
        } else if (m.stage === "vote") {
          // resolve with current votes
          this.resolveVote();
        }
      }
    }

    // Sabotage timers
    if (this.state.phase === "playing") {
      if (this.state.sabotage.lights.active && t >= this.state.sabotage.lights.endsAt) {
        this.state.sabotage.lights.active = false;
        this.state.sabotage.lights.endsAt = 0;
        this.broadcast({ t:"event.sabotage_end", kind:"lights" });
      }
      if (this.state.sabotage.meltdown.active) {
        if (t >= this.state.sabotage.meltdown.endsAt) {
          this.endMatch("saboteur");
          return;
        }
      }
    }

    // Movement
    if (this.state.phase === "playing" || this.state.phase === "lobby") {
      const dt = 0.05; // seconds per tick (50ms)
      for (const p of this.players.values()) {
        if (!p.alive && this.state.phase === "playing") continue;
        const ix = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
        const iy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
        let mag = Math.hypot(ix, iy);
        const nx = mag > 0 ? ix / mag : 0;
        const ny = mag > 0 ? iy / mag : 0;
        p.x = clamp(p.x + nx * p.speed * dt, 20, MAP.width-20);
        p.y = clamp(p.y + ny * p.speed * dt, 20, MAP.height-20);
      }
    }

    // Broadcast state periodically
    if (t - this._lastBroadcast >= 100) {
      this._lastBroadcast = t;
      // Send per-client tailored snapshot (self role/tasks)
      for (const c of this.clients.values()) {
        c.send({ t:"state", state: this.publicStateFor(c.uid) });
      }
    }
  }
}

function shuffle(arr) {
  for (let i=arr.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pickN(arr, n) {
  const copy = [...arr];
  shuffle(copy);
  return copy.slice(0, n);
}
