import { useCallback, useEffect, useState } from "react";
import { Lobby } from "./Lobby";
import { useMyLocation, useReportLocation, useWakeLock, type MyFix } from "./location";
import { createRoom, getSavedName, roomExists, saveName, useRoom } from "./net";
import { Play } from "./Play";
import { Banner, Toasts } from "./ui";

const readCode = () => location.hash.replace(/^#/, "").toUpperCase();

export function App() {
  const [code, setCode] = useState(readCode);
  const [name, setName] = useState(getSavedName);
  // Coming back to a room link with a known name (reload, phone woke up) rejoins straight away.
  const [joined, setJoined] = useState(() => !!readCode() && !!getSavedName());

  useEffect(() => {
    const onHash = () => {
      setCode(readCode());
      setJoined(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (code && joined && name) return <Room code={code} name={name} />;
  return (
    <Home
      initialCode={code}
      name={name}
      onEnter={(c, n) => {
        saveName(n);
        setName(n);
        // replaceState doesn't fire hashchange, which would bounce us back to Home.
        history.replaceState(null, "", `${location.pathname}${location.search}#${c}`);
        setCode(c);
        setJoined(true);
      }}
    />
  );
}

function Home({ initialCode, name, onEnter }: { initialCode: string; name: string; onEnter: (code: string, name: string) => void }) {
  const [n, setN] = useState(name);
  const [c, setC] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (!n.trim()) return setError("Pon tu nombre primero");
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo ha fallado");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <img src="/icon.svg" alt="" className="logo" />
      <h1>SeekHunt</h1>
      <p className="tagline">Escondite en la calle. La zona se cierra. Solo uno sobrevive.</p>
      <label className="field">
        <span>Tu nombre</span>
        <input value={n} maxLength={20} onChange={(e) => setN(e.target.value)} placeholder="Ej. Nouh" autoComplete="nickname" />
      </label>
      <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => onEnter(await createRoom(), n.trim()))}>
        Crear partida
      </button>
      <div className="divider">o únete con un código</div>
      <div className="row">
        <input
          className="code-input"
          value={c}
          maxLength={5}
          onChange={(e) => setC(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="ABCDE"
          autoCapitalize="characters"
        />
        <button
          className="btn"
          disabled={busy || c.length !== 5}
          onClick={() =>
            run(async () => {
              if (!(await roomExists(c))) throw new Error("No existe ninguna sala con ese código");
              onEnter(c, n.trim());
            })
          }
        >
          Unirse
        </button>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      <p className="fineprint">Jugad en zonas seguras, sin cruzar carreteras corriendo ni entrar en propiedades privadas.</p>
    </main>
  );
}

function Room({ code, name }: { code: string; name: string }) {
  const conn = useRoom(code, name);
  const { view, send } = conn;
  const playing = view?.phase === "hiding" || view?.phase === "seeking";
  const { fix, error: gpsError, setSimFix } = useMyLocation(true);
  useWakeLock(playing);
  const sendFix = useCallback((f: MyFix) => send({ t: "loc", lat: f.lat, lng: f.lng, acc: f.acc }), [send]);
  useReportLocation(conn.status === "open" ? fix : null, sendFix);

  return (
    <>
      <Toasts toasts={conn.toasts} />
      <div className="status-stack">
        {conn.status !== "open" && <Banner tone="warn">Reconectando…</Banner>}
        {gpsError && <Banner tone="danger">{gpsError}</Banner>}
        {conn.error && (
          <Banner tone="danger">
            {conn.error}{" "}
            <button className="link" onClick={conn.dismissError}>
              OK
            </button>
          </Banner>
        )}
      </div>
      {!view ? (
        <main className="home">
          <p>Conectando a la sala {code}…</p>
        </main>
      ) : view.phase === "lobby" ? (
        <Lobby view={view} send={send} fix={fix} />
      ) : (
        <Play view={view} send={send} fix={fix} clockOffset={conn.clockOffset} onSimTap={setSimFix} />
      )}
    </>
  );
}
