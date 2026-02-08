import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadUsers() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2), "utf-8");
  }
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

export function saveUsers(db) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2), "utf-8");
}

function validateUsername(username) {
  if (typeof username !== "string") throw new Error("Invalid username");
  const u = username.trim();
  if (u.length < 3 || u.length > 16) throw new Error("Username must be 3-16 chars");
  if (!/^[a-z0-9_]+$/.test(u)) throw new Error("Username allowed: a-z 0-9 _");
  return u;
}
function validatePassword(password) {
  if (typeof password !== "string") throw new Error("Invalid password");
  if (password.length < 8 || password.length > 64) throw new Error("Password must be 8-64 chars");
}

export function createUser(db, username, password) {
  const u = validateUsername(username);
  validatePassword(password);

  const exists = db.users.find(x => x.username === u);
  if (exists) throw new Error("Username already taken");

  const hash = bcrypt.hashSync(password, 10);
  const user = {
    id: crypto.randomUUID(),
    username: u,
    password_hash: hash,
    created_at: Date.now(),
    last_login_at: Date.now()
  };
  db.users.push(user);
  return user;
}

export function verifyUser(db, username, password) {
  const u = validateUsername(username);
  validatePassword(password);
  const user = db.users.find(x => x.username === u);
  if (!user) throw new Error("Invalid credentials");
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) throw new Error("Invalid credentials");
  user.last_login_at = Date.now();
  return user;
}
