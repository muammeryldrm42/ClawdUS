import { WS } from "./api";
import { getToken } from "./api";

export type WsHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (msg: any) => void;
  onError?: (e: any) => void;
};

export function connectRoom(roomCode: string, handlers: WsHandlers) {
  const token = getToken();
  if (!token) throw new Error("Missing token");
  const url = `${WS}?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  ws.onopen = () => handlers.onOpen?.();
  ws.onclose = () => handlers.onClose?.();
  ws.onerror = (e) => handlers.onError?.(e);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      handlers.onMessage?.(msg);
    } catch {}
  };

  const send = (obj: any) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  return { ws, send };
}
