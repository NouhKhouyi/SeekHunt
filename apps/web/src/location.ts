import { type LatLng, WALKING_SPEED_LIMIT } from "@seekhunt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MyFix extends LatLng {
  acc: number;
  /** m/s as reported by the device, when it knows. */
  speed?: number;
  /** Altitude and its accuracy (m). Many phones report none indoors; the server only trusts ±10 m or better. */
  alt?: number;
  altAcc?: number;
}

const toFix = (c: GeolocationCoordinates): MyFix => ({
  lat: c.latitude,
  lng: c.longitude,
  acc: c.accuracy,
  speed: c.speed ?? undefined,
  alt: c.altitude ?? undefined,
  altAcc: c.altitudeAccuracy ?? undefined,
});

/** 25 km/h: faster than running, so the player is on wheels. Same rule the server enforces on catches. */
export const WALKING_LIMIT = WALKING_SPEED_LIMIT;

export const SIM_MODE = new URLSearchParams(location.search).has("sim");

/** Browsers only expose GPS on https:// (or localhost). Opening the dev server by LAN IP silently fails. */
export const GPS_NEEDS_HTTPS = !window.isSecureContext;
/** Errors are message keys (see i18n.ts), translated where they are shown. */
const HTTPS_MESSAGE = "gps.https";

function describe(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return "gps.denied";
  if (e.code === e.TIMEOUT) return "gps.timeout";
  return "gps.unavailable";
}

/**
 * Watches the device position. In ?sim mode the position comes from map taps instead,
 * which makes it possible to test a whole game from several desktop tabs.
 */
export function useMyLocation(enabled: boolean) {
  const [fix, setFix] = useState<MyFix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || SIM_MODE) return;
    if (GPS_NEEDS_HTTPS) return setError(HTTPS_MESSAGE);
    if (!("geolocation" in navigator)) return setError("gps.unsupported");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix(toFix(p.coords));
      },
      (e) => setError(describe(e)),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  /** One-shot request, used by "centre on me" so the tap itself triggers the permission prompt. */
  const requestFix = useCallback((): Promise<MyFix> => {
    if (SIM_MODE && fix) return Promise.resolve(fix);
    if (GPS_NEEDS_HTTPS) return Promise.reject(new Error(HTTPS_MESSAGE));
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const f = toFix(p.coords);
          setFix(f);
          setError(null);
          resolve(f);
        },
        (e) => reject(new Error(describe(e))),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      ),
    );
  }, [fix]);

  return { fix, error, requestFix, setSimFix: (p: LatLng) => SIM_MODE && setFix({ ...p, acc: 5 }) };
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
