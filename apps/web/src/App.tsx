import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoom, getSavedName, roomExists, saveName } from "./net";
import { CodeInput, Loading, Logo, Notice } from "./ui";
import { ZoneRings } from "./ZoneRings";

// The map stack (MapLibre) is most of the bundle; Home renders without it.
const Room = lazy(() => import("./Room"));

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

  const leave = () => {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setCode("");
    setJoined(false);
  };

  if (code && joined && name)
    return (
      <Suspense fallback={<Loading />}>
        <Room code={code} name={name} onLeave={leave} />
      </Suspense>
    );
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
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "create" | "join", fn: () => Promise<void>) => {
    if (!n.trim()) return setError("Escribe tu nombre para que el resto sepa quién eres.");
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar. Revisa tu conexión.");
    } finally {
      setBusy(null);
    }
  };

  const join = () =>
    run("join", async () => {
      if (!(await roomExists(c))) throw new Error(`No hay ninguna sala con el código ${c}.`);
      onEnter(c, n.trim());
    });

  return (
    <main className="home">
      <div className="brand" translate="no">
        <Logo />
        SeekHunt
      </div>

      <ZoneRings />

      <div className="hero-copy">
        <h1 className="display">
          Escóndete.
          <br />
          <em>La zona</em> se cierra.
        </h1>
        <p>Escondite por GPS para jugar con amigos en tu barrio. Un cazador, una zona que encoge cada pocos minutos y un único superviviente.</p>
      </div>

      <form
        className="join"
        onSubmit={(e) => {
          e.preventDefault();
          if (c.length === 5) join();
          else run("create", async () => onEnter(await createRoom(), n.trim()));
        }}
      >
        <label className="field">
          <span className="label">Tu nombre</span>
          <input id="name" className="input" value={n} maxLength={20} onChange={(e) => setN(e.target.value)} placeholder="Cómo te verán los demás" autoComplete="nickname" />
        </label>
        <button type="button" className="btn btn-block" disabled={!!busy} onClick={() => run("create", async () => onEnter(await createRoom(), n.trim()))}>
          {busy === "create" ? <span className="spinner" /> : "Crear partida"}
        </button>
        <div className="or">o únete con un código</div>
        <div className="join-row">
          <CodeInput length={5} value={c} onChange={setC} label="Código de sala" />
          <button type="button" className="btn btn-soft" style={{ height: 56 }} disabled={!!busy || c.length !== 5} onClick={join} aria-label="Unirse">
            {busy === "join" ? <span className="spinner" /> : <ArrowRight size={20} />}
          </button>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>

      <ol className="steps">
        <li>
          <span>
            <b>Marca la zona</b> en el mapa y comparte el código con tu grupo.
          </span>
        </li>
        <li>
          <span>
            <b>Escondeos</b> mientras el cazador espera en la salida.
          </span>
        </li>
        <li>
          <span>
            <b>Sobrevive</b> a cada cierre. Si sales de la zona, el cazador te ve.
          </span>
        </li>
      </ol>
      <p className="fineprint">Elegid zonas peatonales. Nada de cruzar carreteras corriendo ni entrar en propiedades privadas.</p>
    </main>
  );
}
