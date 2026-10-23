import type { ClientMsg, GameEvent, GameView, Msg, ServerMsg } from "@seekhunt/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { cue } from "./sfx";

export interface Identity {
  playerId: string;
  secret: string;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: identity only lasts for this tab.
  }
}

/** Stable per-device identity so a reload or a dropped connection rejoins as the same player. */
export function getIdentity(): Identity {
  const stored = safeGet("seekhunt:identity");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Identity;
      if (parsed.playerId && parsed.secret) return parsed;
    } catch {
      // fall through and regenerate
    }
  }
  const id = { playerId: randomId(), secret: randomId() };
  safeSet("seekhunt:identity", JSON.stringify(id));
  return id;
}

export const getSavedName = () => safeGet("seekhunt:name") ?? "";
export const saveName = (name: string) => safeSet("seekhunt:name", name);

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  const body = (await res.json()) as { code?: string; error?: string };
  if (!res.ok || !body.code) throw new Error(body.error?.startsWith("err.") ? body.error : "err.createFailed");
  return body.code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return false;
  return ((await res.json()) as { exists: boolean }).exists;
}

export type Toast = Omit<GameEvent, "to"> & { id: number };

export interface Connection {
  view: GameView | null;
  status: "connecting" | "open" | "closed";
  /** Last server error, as a message key; translated where it is shown. */
  error: Msg | null;
  toasts: Toast[];
  /** Server clock minus local clock, in ms. */
  clockOffset: number;
  send: (msg: ClientMsg) => void;
  dismissError: () => void;
}

/** Keeps a WebSocket to the room open, reconnecting with backoff, and exposes the latest personalised view. */
export function useRoom(code: string, name: string): Connection {
  const [view, setView] = useState<GameView | null>(null);
  const [status, setStatus] = useState<Connection["status"]>("connecting");
  const [error, setError] = useState<Msg | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [clockOffset, setClockOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const identity = getIdentity();

    const connect = () => {
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        ws.send(JSON.stringify({ t: "hello", ...identity, name } satisfies ClientMsg));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        if (msg.t === "state") {
          setView(msg.view);
          setClockOffset(msg.view.serverNow - Date.now());
        } else if (msg.t === "error") {
          setError(msg.error);
        } else if (msg.t === "event") {
          const id = ++toastId.current;
          setToasts((t) => [...t.slice(-3), { ...msg.event, id }]);
          cue(msg.event.kind);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), msg.event.kind === "info" ? 3500 : 6000);
        }
      };
      ws.onclose = (e) => {
        if (closed) return;
        setStatus("closed");
        if (e.code === 4001) return; // kicked
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      const ws = wsRef.current;
      // Closing mid-handshake logs a browser error (React's dev double-mount does this); close once open instead.
      if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws?.close();
    };
  }, [code, name]);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { view, status, error, toasts, clockOffset, send, dismissError: () => setError(null) };
}
