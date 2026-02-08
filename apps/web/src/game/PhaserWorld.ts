"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";

type Props = {
  state: any;
  me: any;
  onSend: (obj:any) => void;
};

export default function PhaserWorld({ state, me, onSend }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const lastInputRef = useRef<any>({ up:false, down:false, left:false, right:false });

  useEffect(() => {
    if (!ref.current) return;
    if (gameRef.current) return;

    const scene = new MainScene(state, me, onSend, lastInputRef);

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current,
      width: 640,
      height: 560,
      backgroundColor: "#0b0f17",
      scene: [scene],
      physics: { default: "arcade" }
    });

    gameRef.current = game;

    return () => {
      try { game.destroy(true); } catch {}
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // push state into scene
    const g = gameRef.current;
    if (!g) return;
    const s = g.scene.getScenes(true)[0] as any;
    if (s && s.applyState) s.applyState(state, me);
  }, [state, me]);

  return <div style={{ width:"100%", height:"100%" }} ref={ref} />;
}

class MainScene extends Phaser.Scene {
  state: any;
  me: any;
  onSend: (obj:any) => void;
  lastInputRef: any;

  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keys!: any;

  playerSprites: Map<string, Phaser.GameObjects.Arc> = new Map();
  nameTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  objSprites: Map<string, Phaser.GameObjects.Arc> = new Map();
  bodySprites: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  darkness!: Phaser.GameObjects.Graphics;

  constructor(state:any, me:any, onSend:any, lastInputRef:any) {
    super("main");
    this.state = state;
    this.me = me;
    this.onSend = onSend;
    this.lastInputRef = lastInputRef;
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,E,K");

    // click interaction
    this.input.on("pointerdown", (pointer:Phaser.Input.Pointer) => {
      const world = this.state?.map;
      if (!world) return;
      // Check near object circles by click distance (screen-space approx)
      const mx = pointer.worldX;
      const my = pointer.worldY;
      const objs = world.objects || [];
      for (const o of objs) {
        const dx = mx - o.x * this.scaleX();
        const dy = my - o.y * this.scaleY();
        // We'll do interactions by proximity on server anyway; client just sends objectId
      }
    });

    this.darkness = this.add.graphics();
  }

  scaleX() {
    const mw = this.state?.map?.width || 1200;
    return 640 / mw;
  }
  scaleY() {
    const mh = this.state?.map?.height || 800;
    return 560 / mh;
  }

  applyState(state:any, me:any) {
    this.state = state;
    this.me = me;
  }

  update() {
    if (!this.state) return;
    const sx = this.scaleX(), sy = this.scaleY();

    // Input → server (throttled by change)
    const input = {
      up: !!(this.cursors.up.isDown || this.keys.W.isDown),
      down: !!(this.cursors.down.isDown || this.keys.S.isDown),
      left: !!(this.cursors.left.isDown || this.keys.A.isDown),
      right: !!(this.cursors.right.isDown || this.keys.D.isDown),
    };
    const last = this.lastInputRef.current;
    const changed = input.up!==last.up || input.down!==last.down || input.left!==last.left || input.right!==last.right;
    if (changed) {
      this.lastInputRef.current = input;
      this.onSend({ t:"input", input });
    }

    // Interact key E: find nearest object
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      const my = this.mePlayer();
      if (my) {
        const obj = nearestObject(this.state.map.objects, my.x, my.y, 90);
        if (obj) this.onSend({ t:"action.interact", objectId: obj.id });
        const body = nearestBody(this.state.bodies, my.x, my.y, 90);
        if (body) this.onSend({ t:"action.report", bodyId: body.id });
      }
    }

    // Kill key K (saboteur): nearest living player
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
      if (this.me?.role === "saboteur" && this.state.phase === "playing") {
        const my = this.mePlayer();
        if (my) {
          const target = nearestAliveTarget(this.state.players, my.id, my.x, my.y, 80);
          if (target) this.onSend({ t:"action.kill", targetId: target.id });
        }
      }
    }

    // Draw map background
    this.drawBackground();

    // Draw objects
    this.drawObjects();

    // Draw bodies
    this.drawBodies();

    // Draw players
    this.drawPlayers();

    // Draw darkness overlay for lights sabotage
    this.drawDarkness();
  }

  mePlayer() {
    const ps = this.state.players || [];
    // self is the one with role present
    return ps.find((p:any)=>p.role);
  }

  drawBackground() {
    // simple grid
    const g = this.add.graphics();
    g.clear();
    g.lineStyle(1, 0x1d2a44, 0.35);

    const w = 640, h = 560;
    for (let x=0; x<=w; x+=40) { g.lineBetween(x,0,x,h); }
    for (let y=0; y<=h; y+=40) { g.lineBetween(0,y,w,y); }

    // border
    g.lineStyle(2, 0xffffff, 0.12);
    g.strokeRect(10,10,w-20,h-20);

    // remove next tick
    g.destroy();
  }

  drawObjects() {
    const objs = this.state.map?.objects || [];
    const sx = this.scaleX(), sy = this.scaleY();

    // keep and update circles
    const seen = new Set<string>();
    for (const o of objs) {
      seen.add(o.id);
      let circle = this.objSprites.get(o.id);
      if (!circle) {
        circle = this.add.circle(o.x*sx, o.y*sy, Math.max(10, o.radius*Math.min(sx,sy)), 0x61dafb, 0.10);
        this.objSprites.set(o.id, circle);
        const t = this.add.text(o.x*sx - 40, o.y*sy - 8, o.label, { fontSize:"12px", color:"#8aa0c2" });
        (t as any).__objId = o.id;
        this.nameTexts.set("obj_"+o.id, t);
      }
      circle.setPosition(o.x*sx, o.y*sy);

      // color by type
      if (o.type === "task") circle.setFillStyle(0x4ade80, 0.10);
      if (o.type === "fix") circle.setFillStyle(0x61dafb, 0.10);
      if (o.type === "meeting") circle.setFillStyle(0xff5a7a, 0.08);

      const t = this.nameTexts.get("obj_"+o.id);
      if (t) t.setPosition(o.x*sx - 44, o.y*sy - 8);
    }

    // cleanup removed
    for (const [id, c] of this.objSprites.entries()) {
      if (!seen.has(id)) { c.destroy(); this.objSprites.delete(id); }
    }
  }

  drawPlayers() {
    const ps = this.state.players || [];
    const sx = this.scaleX(), sy = this.scaleY();
    const seen = new Set<string>();

    for (const p of ps) {
      seen.add(p.id);

      let spr = this.playerSprites.get(p.id);
      if (!spr) {
        spr = this.add.circle(p.x*sx, p.y*sy, 10, 0xffffff, 1);
        this.playerSprites.set(p.id, spr);
        const nt = this.add.text(p.x*sx + 12, p.y*sy - 8, p.username, { fontSize:"12px", color:"#e6edf6" });
        this.nameTexts.set(p.id, nt);
      }
      spr.setPosition(p.x*sx, p.y*sy);

      // color
      if (!p.alive) spr.setFillStyle(0x8aa0c2, 0.6);
      else spr.setFillStyle(p.role === "saboteur" ? 0xff5a7a : 0x4ade80, p.role ? 1 : 0.75);

      const nt = this.nameTexts.get(p.id);
      if (nt) nt.setPosition(p.x*sx + 12, p.y*sy - 8);
    }

    for (const [id, spr] of this.playerSprites.entries()) {
      if (!seen.has(id)) { spr.destroy(); this.playerSprites.delete(id); }
    }
    for (const [id, t] of this.nameTexts.entries()) {
      if (id.startsWith("obj_")) continue;
      if (!seen.has(id)) { t.destroy(); this.nameTexts.delete(id); }
    }
  }

  drawBodies() {
    const bodies = this.state.bodies || [];
    const sx = this.scaleX(), sy = this.scaleY();
    const seen = new Set<string>();

    for (const b of bodies) {
      seen.add(b.id);
      let r = this.bodySprites.get(b.id);
      if (!r) {
        r = this.add.rectangle(b.x*sx, b.y*sy, 18, 10, 0xff5a7a, 0.9);
        this.bodySprites.set(b.id, r);
      }
      r.setPosition(b.x*sx, b.y*sy);
    }

    for (const [id, r] of this.bodySprites.entries()) {
      if (!seen.has(id)) { r.destroy(); this.bodySprites.delete(id); }
    }
  }

  drawDarkness() {
    const lights = this.state?.sabotage?.lights;
    const active = !!lights?.active;
    this.darkness.clear();
    if (!active) return;

    // simple darkness overlay with a visible circle around the player
    const my = this.mePlayer();
    const sx = this.scaleX(), sy = this.scaleY();

    this.darkness.fillStyle(0x000000, 0.62);
    this.darkness.fillRect(0, 0, 640, 560);

    if (my) {
      const cx = my.x * sx;
      const cy = my.y * sy;
      const r = 120;
      this.darkness.setBlendMode(Phaser.BlendModes.NORMAL);
      this.darkness.fillStyle(0x000000, 0.0);
      this.darkness.beginPath();
      this.darkness.arc(cx, cy, r, 0, Math.PI*2);
      this.darkness.closePath();
      this.darkness.fillPath();

      // Punch hole effect by drawing with ERASE blend mode
      this.darkness.setBlendMode(Phaser.BlendModes.ERASE);
      this.darkness.fillCircle(cx, cy, r);
      this.darkness.setBlendMode(Phaser.BlendModes.NORMAL);
    }
  }
}

// helpers
function nearestObject(objs:any[], x:number, y:number, maxDist:number) {
  if (!objs) return null;
  let best:any = null;
  let bestD = maxDist*maxDist;
  for (const o of objs) {
    const dx = o.x - x, dy = o.y - y;
    const d = dx*dx+dy*dy;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function nearestBody(bodies:any[], x:number, y:number, maxDist:number) {
  if (!bodies) return null;
  let best:any = null;
  let bestD = maxDist*maxDist;
  for (const b of bodies) {
    const dx = b.x - x, dy = b.y - y;
    const d = dx*dx+dy*dy;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}
function nearestAliveTarget(players:any[], selfId:string, x:number, y:number, maxDist:number) {
  if (!players) return null;
  let best:any = null;
  let bestD = maxDist*maxDist;
  for (const p of players) {
    if (p.id === selfId) continue;
    if (!p.alive) continue;
    // role hidden for others; we just target any alive
    const dx = p.x - x, dy = p.y - y;
    const d = dx*dx+dy*dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
