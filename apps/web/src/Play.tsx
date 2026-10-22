import { buildSchedule, type ClientMsg, distance, gameDeadline, type GameView, type LatLng, zoneAt } from "@seekhunt/shared";
import { useMemo, useState } from "react";
import { GameMap, type MapPlayer } from "./GameMap";
import { type MyFix, SIM_MODE } from "./location";
import { Banner, fmt, useNow } from "./ui";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  fix: MyFix | null;
  clockOffset: number;
  onSimTap: (p: LatLng) => void;
}

export function Play({ view, send, fix, clockOffset, onSimTap }: Props) {
  const now = useNow(clockOffset);
  const { config, me, phase } = view;
  const isHost = me.id === view.hostId;
  const ended = phase === "ended";
  const spectating = ended || me.status !== "active";

  const schedule = useMemo(
    () => (view.seekStartAt !== null ? buildSchedule(config, view.seed, view.seekStartAt) : null),
    [config, view.seed, view.seekStartAt],
  );
  const zone = schedule && phase === "seeking" ? zoneAt(schedule, now) : null;
  const current = zone?.current ?? config.zone;
  const deadline = schedule ? gameDeadline(schedule, config) : null;

  const activeHiders = view.players.filter((p) => p.role === "hider" && p.status === "active");
  const myEntry = view.players.find((p) => p.id === me.id);
  const outSince = myEntry?.outOfZoneSince ?? null;
  const locallyOutside = fix && me.role === "hider" && me.status === "active" && distance(fix, current.center) > current.radius;

  const players: MapPlayer[] = view.players
    .filter((p) => p.loc && p.id !== me.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.loc!,
      kind: p.role === "seeker" ? "seeker" : p.visibleBecause === "outOfZone" || p.visibleBecause === "stale" ? "revealed" : "hider",
    }));
  if (fix) players.push({ id: me.id, name: "Tú", pos: fix, kind: "me" });

  const names = Object.fromEntries(view.players.map((p) => [p.id, p.name]));
  const pings = view.pings.map((p) => ({
    area: p.area,
    label: names[p.playerId] ?? "?",
    kind: (view.players.find((x) => x.id === p.playerId)?.role ?? "hider") as "seeker" | "hider",
  }));

  let headline: string;
  let timer: string | null = null;
  if (phase === "hiding") {
    headline = me.role === "seeker" ? "Espera, se están escondiendo" : "¡Escóndete!";
    timer = fmt(view.seekStartAt! - now);
  } else if (phase === "seeking" && zone) {
    if (zone.shrinking) {
      headline = "La zona se está cerrando";
    } else if (zone.nextShrinkAt) {
      headline = "Próximo cierre";
      timer = fmt(zone.nextShrinkAt - now);
    } else {
      headline = "Zona final";
      timer = deadline ? fmt(deadline - now) : null;
    }
  } else {
    headline = "Partida terminada";
  }

  return (
    <main className="play">
      <GameMap zone={current} nextZone={zone?.next ?? null} pings={pings} players={players} focus={config.zone} onTap={SIM_MODE && !spectating ? onSimTap : undefined} />

      <header className={`hud hud-${me.role}`}>
        <div>
          <div className="eyebrow">{me.role === "seeker" ? "Cazador" : me.status === "active" ? "Escondido" : me.status === "caught" ? "Pillado" : "Eliminado"}</div>
          <div className="hud-title">{headline}</div>
        </div>
        <div className="hud-right">
          {timer && <div className="hud-timer">{timer}</div>}
          <div className="muted small">
            {activeHiders.length} vivo{activeHiders.length === 1 ? "" : "s"}
            {view.nextPingAt && phase === "seeking" ? ` · radar ${fmt(view.nextPingAt - now)}` : ""}
          </div>
        </div>
      </header>

      <div className="overlay-stack">
        {outSince !== null && me.status === "active" && (
          <Banner tone="danger">¡Fuera de la zona! Te eliminan en {fmt(outSince + config.outOfZoneGraceSeconds * 1000 - now)}</Banner>
        )}
        {outSince === null && locallyOutside && <Banner tone="warn">Estás saliendo de la zona</Banner>}
        {phase === "hiding" && <Banner tone="info">Mantén la pantalla encendida: si bloqueas el móvil dejas de enviar tu posición y acabarás revelado.</Banner>}
        {SIM_MODE && !spectating && <Banner tone="info">Modo simulación: toca el mapa para moverte.</Banner>}
      </div>

      <footer className="panel">
        {ended ? <EndPanel view={view} isHost={isHost} send={send} /> : me.role === "seeker" ? <SeekerPanel view={view} send={send} /> : <HiderPanel view={view} send={send} />}
        {isHost && !ended && (
          <button className="btn btn-ghost btn-small" onClick={() => confirm("¿Terminar la partida para todos?") && send({ t: "end" })}>
            Terminar partida
          </button>
        )}
      </footer>
    </main>
  );
}

function SeekerPanel({ view, send }: { view: GameView; send: (m: ClientMsg) => void }) {
  const [code, setCode] = useState("");
  if (view.phase === "hiding") return <p className="hint">Quédate en el punto de salida. Saldrás cuando acabe la cuenta atrás.</p>;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        send({ t: "catch", code });
        setCode("");
      }}
    >
      <input
        className="code-input"
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        placeholder="Código"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        aria-label="Código del jugador pillado"
      />
      <button className="btn btn-primary" disabled={code.length !== 4}>
        ¡Pillado!
      </button>
    </form>
  );
}

function HiderPanel({ view, send }: { view: GameView; send: (m: ClientMsg) => void }) {
  if (view.me.status !== "active") return <p className="hint">Estás fuera. Ahora puedes ver a todos los jugadores.</p>;
  return (
    <div className="hider-panel">
      <div>
        <div className="eyebrow">Si te pillan, enseña este código</div>
        <div className="catch-code">{view.me.catchCode}</div>
      </div>
      <button className="btn btn-ghost btn-small" onClick={() => confirm("¿Seguro que te han pillado?") && send({ t: "surrender" })}>
        Me han pillado
      </button>
    </div>
  );
}

function EndPanel({ view, isHost, send }: { view: GameView; isHost: boolean; send: (m: ClientMsg) => void }) {
  const winners = view.players.filter((p) => view.winners.includes(p.id));
  const iWon = view.winners.includes(view.me.id);
  return (
    <div className="end-panel">
      <div className="end-title">{iWon ? "🏆 ¡Has ganado!" : "Fin de la partida"}</div>
      <p>{view.winReason}</p>
      {winners.length > 0 && <p className="muted">Ganadores: {winners.map((w) => w.name).join(", ")}</p>}
      {isHost && (
        <button className="btn btn-primary btn-block" onClick={() => send({ t: "reset" })}>
          Nueva partida
        </button>
      )}
    </div>
  );
}
