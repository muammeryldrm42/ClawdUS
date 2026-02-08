"use client";

import React, { useEffect, useRef } from "react";

type Props = {
  state: any;
  me: any;
  onSend: (obj: any) => void;
};

/**
 * IMPORTANT:
 * Phaser touches window/document at import time on some builds.
 * To keep Vercel/Next build stable, we only import Phaser dynamically in useEffect (client-only).
 */
export default function PhaserWorld({ state, me, onSend }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<any>(null);
  const latestRef = useRef<{ state: any; me: any }>({ state, me });

  // keep latest state for the scene to read
  useEffect(() => {
    latestRef.current = { state, me };
    const g = gameRef.current;
    const scene = g?.scene?.keys?.main;
    if (scene && scene.__setState) scene.__setState(state, me);
  }, [state, me]);

  useEffect(() => {
    let destroyed = false;

    async function boot() {
      if (!hostRef.current) return;

      const Phaser = (await import("phaser")).default;
      if (destroyed) return;

      class MainScene extends Phaser.Scene {
        cursors: any;
        keys: any;
        sprites: Map<string, any> = new Map();
        labels: Map<string, any> = new Map();
        bodies: Map<string, any> = new Map();
        lastSend = 0;

        create() {
          this.cameras.main.setBackgroundColor(0x0b0f17);

          const s0 = latestRef.current.state;
          const mw = s0?.map?.width || 1200;
          const mh = s0?.map?.height || 800;
          this.physics.world.setBounds(0, 0, mw, mh);
          this.cameras.main.setBounds(0, 0, mw, mh);

          this.cursors = this.input.keyboard.createCursorKeys();
          this.keys = this.input.keyboard.addKeys("W,A,S,D,E,K");

          // initial paint
          this.__setState(s0, latestRef.current.me);

          // Interact/report key
          this.input.keyboard.on("keydown-E", () => {
            const s = latestRef.current.state;
            const objects = s?.map?.objects || [];
            const my = this._getMe(s);
            if (!my) return;

            // nearest object
            let best: any = null;
            let bestD = Infinity;
            for (const o of objects) {
              const r = o.radius || 60;
              const dx = my.x - o.x;
              const dy = my.y - o.y;
              const d = dx * dx + dy * dy;
              if (d <= r * r && d < bestD) {
                bestD = d;
                best = o;
              }
            }

            if (best) {
              if (best.type === "task" || best.type === "fix") onSend({ t: "action.interact", objectId: best.id });
              if (best.type === "meeting") onSend({ t: "action.meeting_call" });
              return;
            }

            // body report fallback
            const bodies = s?.bodies || [];
            let bbest: any = null;
            let bbestD = Infinity;
            for (const b of bodies) {
              const dx = my.x - b.x;
              const dy = my.y - b.y;
              const d = dx * dx + dy * dy;
              if (d <= 90 * 90 && d < bbestD) {
                bbestD = d;
                bbest = b;
              }
            }
            if (bbest) onSend({ t: "action.report", bodyId: bbest.id });
          });

          // Kill key (saboteur)
          this.input.keyboard.on("keydown-K", () => {
            const s = latestRef.current.state;
            const my = this._getMe(s);
            if (!my || my.role !== "saboteur") return;

            const players = s?.players || [];
            let best: any = null;
            let bestD = Infinity;
            for (const p of players) {
              if (!p.alive) continue;
              if (p.id === my.id) continue;
              const dx = my.x - p.x;
              const dy = my.y - p.y;
              const d = dx * dx + dy * dy;
              if (d <= 70 * 70 && d < bestD) {
                bestD = d;
                best = p;
              }
            }
            if (best) onSend({ t: "action.kill", targetId: best.id });
          });
        }

        __setState(s: any, _m: any) {
          const players = s?.players || [];

          // ensure sprites exist
          for (const p of players) {
            let spr = this.sprites.get(p.id);
            let lbl = this.labels.get(p.id);
            if (!spr) {
              spr = this.add.circle(p.x, p.y, 14, 0x61dafb);
              this.sprites.set(p.id, spr);
            }
            if (!lbl) {
              lbl = this.add.text(p.x - 22, p.y - 36, p.username, { fontSize: "12px" });
              this.labels.set(p.id, lbl);
            }
          }

          // remove missing
          for (const id of [...this.sprites.keys()]) {
            if (!players.find((p: any) => p.id === id)) {
              this.sprites.get(id)?.destroy();
              this.labels.get(id)?.destroy();
              this.sprites.delete(id);
              this.labels.delete(id);
            }
          }

          // bodies
          const bodies = s?.bodies || [];
          for (const b of bodies) {
            if (!this.bodies.has(b.id)) {
              const r = this.add.rectangle(b.x, b.y, 22, 14, 0xff5a7a);
              this.bodies.set(b.id, r);
            }
          }
          for (const id of [...this.bodies.keys()]) {
            if (!bodies.find((b: any) => b.id === id)) {
              this.bodies.get(id)?.destroy();
              this.bodies.delete(id);
            }
          }

          // center camera on me
          const my = this._getMe(s);
          if (my) this.cameras.main.centerOn(my.x, my.y);
        }

        _getMe(s: any) {
          // only self has role populated in server state payload
          return (s?.players || []).find((p: any) => p.role) || null;
        }

        update(_time: number) {
          const s = latestRef.current.state;
          if (!s) return;

          // update visuals
          for (const p of s.players || []) {
            const spr = this.sprites.get(p.id);
            const lbl = this.labels.get(p.id);
            if (spr) {
              spr.x = p.x;
              spr.y = p.y;
              spr.setAlpha(p.alive ? 1 : 0.35);
            }
            if (lbl) {
              lbl.x = p.x - 22;
              lbl.y = p.y - 36;
              lbl.setAlpha(p.alive ? 1 : 0.5);
            }
          }

          // send input at ~20Hz
          const meP = this._getMe(s);
          if (!meP) return;
          if (s.phase === "meeting" || s.phase === "ended") return;

          const up = !!(this.cursors.up?.isDown || this.keys.W?.isDown);
          const down = !!(this.cursors.down?.isDown || this.keys.S?.isDown);
          const left = !!(this.cursors.left?.isDown || this.keys.A?.isDown);
          const right = !!(this.cursors.right?.isDown || this.keys.D?.isDown);

          const now = performance.now();
          if (now - this.lastSend > 50) {
            this.lastSend = now;
            onSend({ t: "input", input: { up, down, left, right } });
          }
        }
      }

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 640,
        height: 560,
        physics: { default: "arcade" },
        scene: MainScene
      });

      gameRef.current = game;
    }

    boot();

    return () => {
      destroyed = true;
      try {
        gameRef.current?.destroy(true);
      } catch {}
      gameRef.current = null;
    };
  }, []);

  return <div style={{ width: "100%", height: "100%" }} ref={hostRef} />;
}
