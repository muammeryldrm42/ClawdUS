"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiPost } from "../../../lib/api";
import { connectRoom } from "../../../lib/ws";
import PhaserWorld from "../../../game/PhaserWorld";

type Phase = "lobby" | "playing" | "meeting" | "ended";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [state, setState] = useState<any>(null);
  const [chat, setChat] = useState<{from:string, text:string, ts:number}[]>([]);
  const [chatText, setChatText] = useState("");
  const [meetingUi, setMeetingUi] = useState<any>(null);

  const connRef = useRef<any>(null);

  useEffect(() => {
    setStatus(null);
    const conn = connectRoom(code, {
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (msg) => {
        if (msg.t === "state") {
          setState(msg.state);
        } else if (msg.t === "chat") {
          setChat(prev => [...prev.slice(-60), msg]);
        } else if (msg.t?.startsWith("event.meeting")) {
          // handled via state updates too
        } else if (msg.t === "event.vote_result") {
          // toast could be added later
        } else if (msg.t === "event.match_end") {
          // handled by state
        } else if (msg.t === "event.task_complete") {
          // handled by state
        }
      },
      onError: () => setStatus("WebSocket error")
    });
    connRef.current = conn;

    return () => {
      try { conn.ws.close(); } catch {}
    };
  }, [code]);

  const me = useMemo(() => {
    if (!state) return null;
    return (state.players || []).find((p:any)=>p.role); // only self has role field
  }, [state]);

  async function startMatch() {
    try {
      await apiPost("/api/rooms/start", { code });
    } catch (e:any) {
      setStatus(e.message || "Start failed");
    }
  }

  async function updateSettings(patch:any) {
    try {
      await apiPost("/api/rooms/settings", { code, settings: patch });
    } catch (e:any) {
      setStatus(e.message || "Settings failed");
    }
  }

  function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    connRef.current?.send({ t:"chat", text });
    setChatText("");
  }

  const phase: Phase = state?.phase || "lobby";
  const isHost = state?.hostUid && me?.uid && state.hostUid === me.uid; // uid not exposed in state; keep simple
  // note: uid isn't in client state; host button is still shown by server via hostUid only, but we don't know uid.
  // MVP workaround: allow start button always; server enforces host. We'll show it anyway.

  const canChat = phase === "lobby" || phase === "meeting";

  const players = state?.players || [];
  const bodies = state?.bodies || [];
  const sabotage = state?.sabotage || {};
  const taskProgress = state?.taskProgress || {done:0,total:0};

  // Meeting overlay
  const meeting = state?.meeting || null;

  function vote(target:any) {
    connRef.current?.send({ t:"action.vote", target });
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div className="h1">Room {code}</div>
          <div className="small">
            Status: <b style={{ color:"var(--text)" }}>{connected ? "Connected" : "Disconnected"}</b> • Phase: <b style={{ color:"var(--text)" }}>{phase}</b>
          </div>
        </div>
        <div className="row" style={{ gap:10 }}>
          <button className="btn" onClick={()=>router.push("/rooms")}>Back</button>
          <button className="btn ok" onClick={startMatch}>Start Match</button>
        </div>
      </div>

      {status && <p className="p" style={{ color:"var(--danger)" }}>{status}</p>}

      <div className="grid">
        <div className="canvasWrap" style={{ height: 560 }}>
          {state && (
            <PhaserWorld
              state={state}
              me={me}
              onSend={(obj)=>connRef.current?.send(obj)}
            />
          )}

          {meeting && (
            <div className="overlay">
              <div className="modal">
                <div className="h1">Meeting</div>
                <p className="p">
                  Reported by <b>{meeting.reportedBy}</b>. Discussion / vote timers are active.
                </p>
                <div className="playerList">
                  {players.filter((p:any)=>p.alive).map((p:any)=>(
                    <div key={p.id} className="playerRow">
                      <div>
                        <div style={{ fontWeight:800 }}>{p.username}</div>
                        <div className="badge">alive</div>
                      </div>
                      <div className="row" style={{ gap:8 }}>
                        <button className="btn" onClick={()=>vote(p.id)}>Vote</button>
                      </div>
                    </div>
                  ))}
                  <div className="playerRow">
                    <div>
                      <div style={{ fontWeight:800 }}>Skip</div>
                      <div className="badge">no ejection</div>
                    </div>
                    <button className="btn" onClick={()=>vote("skip")}>Vote Skip</button>
                  </div>
                </div>
                <div className="hr" />
                <div className="small">Chat is enabled in meetings (MVP).</div>
              </div>
            </div>
          )}

          {phase === "ended" && (
            <div className="overlay">
              <div className="modal">
                <div className="h1">Match Ended</div>
                <p className="p">
                  Winner: <b style={{ color: state?.winner === "crew" ? "var(--ok)" : "var(--danger)" }}>{state?.winner}</b>
                </p>
                <div className="small">Click Start Match to run another round.</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="h1">HUD</div>
          <div className="kv"><div className="k">You</div><div className="v">{me ? `${me.username} (${me.role})` : "—"}</div></div>
          <div className="kv"><div className="k">Tasks</div><div className="v">{taskProgress.done}/{taskProgress.total}</div></div>
          <div className="kv"><div className="k">Lights</div><div className="v">{sabotage?.lights?.active ? "OUT" : "OK"}</div></div>
          <div className="kv"><div className="k">Meltdown</div><div className="v">{sabotage?.meltdown?.active ? "ACTIVE" : "OK"}</div></div>

          <div className="hr" />

          <div className="h1">Actions</div>
          <div className="row">
            <button className="btn" onClick={()=>connRef.current?.send({ t:"action.meeting_call" })}>Emergency</button>
            <button className="btn" onClick={()=>connRef.current?.send({ t:"action.sabotage", kind:"lights" })} disabled={!me || me.role!=="saboteur" || phase!=="playing"}>Lights Out</button>
            <button className="btn" onClick={()=>connRef.current?.send({ t:"action.sabotage", kind:"meltdown" })} disabled={!me || me.role!=="saboteur" || phase!=="playing"}>Meltdown</button>
          </div>

          <div className="hr" />

          <div className="h1">Chat</div>
          <div className="chat">
            {chat.map((c, idx)=>(
              <p key={idx} className="chatline"><b>{c.from}:</b> {c.text}</p>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input" value={chatText} onChange={(e)=>setChatText(e.target.value)} placeholder={canChat ? "Type message..." : "Chat disabled during play (MVP)"} disabled={!canChat} />
            <button className="btn" onClick={sendChat} disabled={!canChat}>Send</button>
          </div>

          <div className="hr" />
          <div className="h1">Players</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {players.map((p:any)=>(
              <div key={p.id} className="playerRow">
                <div>
                  <div style={{ fontWeight:800 }}>{p.username}</div>
                  <div className="badge">{p.alive ? "alive" : "dead"}</div>
                </div>
                <div className="badge">{(p.role && p.role) ? p.role : ""}</div>
              </div>
            ))}
          </div>

          <div className="hr" />
          <div className="small">Interact: walk near a circle + press <b>E</b> or click the circle. Kill: Saboteur presses <b>K</b> near a target.</div>
        </div>
      </div>
    </div>
  );
}
