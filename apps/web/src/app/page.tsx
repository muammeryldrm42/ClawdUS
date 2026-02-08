"use client";

import { useEffect, useState } from "react";
import { apiPost, setToken, getToken } from "../lib/api";
import { useRouter } from "next/navigation";

type Tab = "login" | "register";

export default function Page() {
  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (getToken()) router.push("/rooms");
  }, [router]);

  async function submit() {
    setBusy(true);
    setStatus(null);
    try {
      const path = tab === "login" ? "/api/login" : "/api/register";
      const out = await apiPost(path, { username: username.trim(), password });
      setToken(out.token);
      router.push("/rooms");
    } catch (e: any) {
      setStatus(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <div className="col">
          <div className="h1">Enter Clawd US</div>
          <p className="p">
            No email. No verification. Register instantly with a username + password,
            then join a room and start a round.
          </p>

          <div className="row" style={{ gap: 10 }}>
            <button className="btn" onClick={() => setTab("login")} style={{ opacity: tab==="login"?1:0.7 }}>
              Login
            </button>
            <button className="btn" onClick={() => setTab("register")} style={{ opacity: tab==="register"?1:0.7 }}>
              Register
            </button>
          </div>

          <div className="label">Username (a-z 0-9 _ • 3–16)</div>
          <input className="input" value={username} onChange={(e)=>setUsername(e.target.value.toLowerCase())} placeholder="clawd_player" />

          <div className="label">Password (8–64)</div>
          <input className="input" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="••••••••" />

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ok" onClick={submit} disabled={busy}>
              {busy ? "Please wait..." : (tab === "login" ? "Login" : "Register")}
            </button>
          </div>

          {status && <p className="p" style={{ color: "var(--danger)", marginTop: 10 }}>{status}</p>}

          <div className="hr" />
          <div className="pill">Tip: For MVP, chat is enabled in Lobby and Meeting (not during active play).</div>
        </div>

        <div className="col">
          <div className="h1">MVP Rules</div>
          <div className="kv"><div className="k">Roles</div><div className="v">Crew / Saboteur</div></div>
          <div className="kv"><div className="k">Crew Wins</div><div className="v">Complete tasks OR vote out Saboteurs</div></div>
          <div className="kv"><div className="k">Saboteur Wins</div><div className="v">Parity OR meltdown timer hits 0</div></div>
          <div className="kv"><div className="k">Sabotage</div><div className="v">Lights Out / Meltdown</div></div>
          <div className="kv"><div className="k">Meeting</div><div className="v">Report body or Emergency</div></div>
          <div className="kv"><div className="k">Vote</div><div className="v">Eject or Skip</div></div>
        </div>
      </div>
    </div>
  );
}
