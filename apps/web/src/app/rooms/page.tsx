"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, clearToken, getToken } from "../../lib/api";
import { useRouter } from "next/navigation";

export default function RoomsPage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.push("/");
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const out = await apiGet("/api/rooms/public");
      setRooms(out.rooms || []);
    } catch (e:any) {
      setStatus(e.message || "Failed to load rooms");
    }
  }

  async function createRoom() {
    setStatus(null);
    try {
      const out = await apiPost("/api/rooms/create", {});
      router.push(`/room/${out.code}`);
    } catch (e:any) {
      setStatus(e.message || "Create failed");
    }
  }

  async function joinRoom() {
    setStatus(null);
    try {
      const out = await apiPost("/api/rooms/join", { code: code.trim() });
      router.push(`/room/${out.code}`);
    } catch (e:any) {
      setStatus(e.message || "Join failed");
    }
  }

  function logout() {
    clearToken();
    router.push("/");
  }

  return (
    <div className="card">
      <div className="h1">Rooms</div>
      <p className="p">Create a room or join with a code. Public list is just active rooms (MVP).</p>

      <div className="row">
        <div className="col">
          <button className="btn ok" onClick={createRoom}>Create Room</button>
          <div className="hr" />
          <div className="label">Join by code</div>
          <input className="input" value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={joinRoom}>Join</button>
            <button className="btn" onClick={refresh}>Refresh</button>
            <button className="btn danger" onClick={logout}>Logout</button>
          </div>

          {status && <p className="p" style={{ color: "var(--danger)", marginTop: 10 }}>{status}</p>}
        </div>

        <div className="col">
          <div className="h1">Active</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {rooms.length === 0 && <div className="small">No rooms yet. Create one.</div>}
            {rooms.map(r => (
              <div key={r.code} className="playerRow">
                <div>
                  <div style={{ fontWeight:800 }}>{r.code}</div>
                  <div className="badge">{r.players} players • {r.status}</div>
                </div>
                <button className="btn" onClick={()=>router.push(`/room/${r.code}`)}>Open</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
