import type { LatLng } from "@seekhunt/shared";
import { useEffect, useRef, useState } from "react";

export interface MyFix extends LatLng {
  acc: number;
}

export const SIM_MODE = new URLSearchParams(location.search).has("sim");

/**
 * Watches the device position. In ?sim mode the position comes from map taps instead,
 * which makes it possible to test a whole game from several desktop tabs.
 */
export function useMyLocation(enabled: boolean) {
  const [fix, setFix] = useState<MyFix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || SIM_MODE) return;
    if (!("geolocation" in navigator)) {
      setError("Este navegador no tiene GPS");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? "Necesitamos permiso de ubicación para jugar" : "Buscando señal GPS…"),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, error, setSimFix: (p: LatLng) => SIM_MODE && setFix({ ...p, acc: 5 }) };
}

/** Sends the position to the server at most every `intervalMs`, and immediately on large moves. */
export function useReportLocation(fix: MyFix | null, send: (f: MyFix) => void, intervalMs = 3000) {
  const last = useRef<{ at: number; fix: MyFix } | null>(null);
  const latest = useRef(fix);
  latest.current = fix;

  useEffect(() => {
    if (!fix) return;
    const prev = last.current;
    const now = Date.now();
    if (!prev || now - prev.at >= intervalMs || SIM_MODE) {
      last.current = { at: now, fix };
      send(fix);
    }
  }, [fix, send, intervalMs]);

  // Heartbeat so the server knows we're alive even when standing still.
  useEffect(() => {
    const t = setInterval(() => {
      if (latest.current && (!last.current || Date.now() - last.current.at >= intervalMs)) {
        last.current = { at: Date.now(), fix: latest.current };
        send(latest.current);
      }
    }, intervalMs);
    return () => clearInterval(t);
  }, [send, intervalMs]);
}

/** Keeps the screen on during a game: browsers pause GPS when the phone locks. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Denied (battery saver, not visible...). The UI warns about locking the phone anyway.
      }
    };
    const onVisible = () => document.visibilityState === "visible" && request();
    request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
