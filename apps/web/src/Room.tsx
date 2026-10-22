import type { MyFix } from "./location";
import { useCallback, useEffect, useState } from "react";
import { Consent, hasConsent } from "./Consent";
import { Lobby } from "./Lobby";
import { useMyLocation, useReportLocation, useWakeLock } from "./location";
import { useRoom } from "./net";
import { Play } from "./Play";
import { ConfirmDialog, type ConfirmRequest, Loading, Notice, Toasts } from "./ui";

export default function Room({ code, name, onLeave }: { code: string; name: string; onLeave: () => void }) {
  const conn = useRoom(code, name);
  const { view, send } = conn;
  const playing = view?.phase === "hiding" || view?.phase === "seeking";
  const [consented, setConsented] = useState(hasConsent);
  // No location request until the player has read what is shared and with whom.
  const gps = useMyLocation(consented);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  useWakeLock(playing);
  useEffect(() => {
    const phase = { lobby: "Sala", hiding: "Escondite", seeking: "En juego", ended: "Resultado" }[view?.phase ?? "lobby"];
    document.title = `${phase} ${code} · SeekHunt`;
    return () => {
      document.title = "SeekHunt";
    };
  }, [view?.phase, code]);
  const sendFix = useCallback((f: MyFix) => send({ t: "loc", lat: f.lat, lng: f.lng, acc: f.acc }), [send]);
  useReportLocation(conn.status === "open" ? gps.fix : null, sendFix);

  return (
    <>
      <Toasts toasts={conn.toasts} />
      {conn.error && (
        <div className="toasts" style={{ top: "auto", bottom: "calc(24px + var(--safe-b))", zIndex: 65 }}>
          <Notice
            tone="danger"
            action={
              <button className="notice-action" onClick={conn.dismissError}>
                OK
              </button>
            }
          >
            {conn.error}
          </Notice>
        </div>
      )}
      {view && conn.status !== "open" && (
        <div className="conn">
          <span className="pill">
            <span className="spinner" /> Reconectando…
          </span>
        </div>
      )}
      {!view ? (
        <Loading />
      ) : view.phase === "lobby" ? (
        <Lobby view={view} send={send} gps={gps} onLeave={onLeave} />
      ) : (
        <Play view={view} send={send} gps={gps} clockOffset={conn.clockOffset} ask={setConfirm} />
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      {!consented && <Consent onAccept={() => setConsented(true)} onLeave={onLeave} />}
    </>
  );
}

export type Gps = ReturnType<typeof useMyLocation>;
