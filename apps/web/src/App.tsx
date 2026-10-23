import type { Msg } from "@seekhunt/shared";
import { ArrowRight } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useT } from "./i18n";
import { createRoom, getSavedName, roomExists, saveName } from "./net";
import { CodeInput, LangToggle, Loading, Logo, Notice } from "./ui";
import { Hero } from "./Hero";

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

/** Errors thrown with a message key (see net.ts) are translated; anything else is a connection problem. */
class KeyedError extends Error {
  constructor(readonly msg: Msg) {
    super(msg.key);
  }
}

function Home({ initialCode, name, onEnter }: { initialCode: string; name: string; onEnter: (code: string, name: string) => void }) {
  const t = useT();
  const [n, setN] = useState(name);
  const [c, setC] = useState(initialCode);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<Msg | null>(null);

  const run = async (kind: "create" | "join", fn: () => Promise<void>) => {
    if (!n.trim()) return setError({ key: "home.needName" });
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof KeyedError ? e.msg : e instanceof Error && e.message.startsWith("err.") ? { key: e.message } : { key: "home.connectFailed" });
    } finally {
      setBusy(null);
    }
  };

  const join = () =>
    run("join", async () => {
      if (!(await roomExists(c))) throw new KeyedError({ key: "home.noRoom", params: { code: c } });
      onEnter(c, n.trim());
    });

  return (
    <main className="home">
      <div className="brand" translate="no">
        <Logo />
        SeekHunt
      </div>
      <div className="home-lang">
        <LangToggle />
      </div>

      <Hero />

      <section className="home-panel">
        <div className="hero-copy">
          <h1 className="display">
            {t("home.title1")} <br />
            {t("home.title2")}
          </h1>
          <p>{t("home.lede")}</p>
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
            <span className="label">{t("home.name")}</span>
            <input id="name" className="input" value={n} maxLength={20} onChange={(e) => setN(e.target.value)} name="nickname" placeholder={t("home.namePlaceholder")} autoComplete="nickname" />
          </label>
          <button type="button" className="btn btn-block" disabled={!!busy} onClick={() => run("create", async () => onEnter(await createRoom(), n.trim()))}>
            {busy === "create" ? <span className="spinner" /> : t("home.create")}
          </button>
          <div className="or">{t("home.or")}</div>
          <div className="join-row">
            <CodeInput length={5} value={c} onChange={setC} label={t("home.roomCode")} />
            <button type="button" className="btn btn-soft" style={{ height: 56 }} disabled={!!busy || c.length !== 5} onClick={join} aria-label={t("home.join")}>
              {busy === "join" ? <span className="spinner" /> : <ArrowRight size={20} />}
            </button>
          </div>
          {error && <Notice tone="danger">{t.msg(error)}</Notice>}
        </form>

        <p className="fineprint">{t("home.fineprint")}</p>
      </section>
    </main>
  );
}
