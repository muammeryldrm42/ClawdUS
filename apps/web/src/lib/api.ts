export const HTTP = process.env.NEXT_PUBLIC_SERVER_HTTP || "http://localhost:8787";
export const WS = process.env.NEXT_PUBLIC_SERVER_WS || "ws://localhost:8787/ws";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("clawd_token");
}
export function setToken(t: string) {
  localStorage.setItem("clawd_token", t);
}
export function clearToken() {
  localStorage.removeItem("clawd_token");
}

export async function apiPost(path: string, body: any) {
  const token = getToken();
  const res = await fetch(`${HTTP}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "authorization": `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "Request failed");
  return json;
}

export async function apiGet(path: string) {
  const token = getToken();
  const res = await fetch(`${HTTP}${path}`, {
    method: "GET",
    headers: {
      ...(token ? { "authorization": `Bearer ${token}` } : {})
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || "Request failed");
  return json;
}
