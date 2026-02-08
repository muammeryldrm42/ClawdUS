import { nanoid } from "nanoid";

export function makeRoomCode() {
  // 6-char uppercase
  const code = nanoid(6).replace(/[-_]/g, "A").toUpperCase();
  return code.slice(0,6);
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function nowMs() {
  return Date.now();
}
