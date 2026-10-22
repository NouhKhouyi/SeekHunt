import { buildSchedule, type ClientMsg, distance, gameDeadline, type GameView, zoneAt } from "@seekhunt/shared";
import { Focus, LocateFixed, Radar, Trophy, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GameMap, type MapHandle, type MapPing, type MapPlayer } from "./GameMap";
import { SIM_MODE } from "./location";
import type { Gps } from "./Room";
import { CodeInput, type ConfirmRequest, fmt, initials, Notice, Timeline, useNow } from "./ui";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  gps: Gps;
  clockOffset: number;
  ask: (r: ConfirmRequest) => void;
}

const MAP_PADDING = { top: 170, bottom: 220, left: 30, right: 30 };

export function Play({ view, send, gps, clockOffset, ask }: Props) {
  const now = useNow(clockOffset);
  const mapRef = useRef<MapHandle>(null);
  const { config, me, phase } = view;
  const fix = gps.fix;
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
  const elapsed = view.startedAt !== null ? ((ended ? view.endedAt ?? now : now) - view.startedAt) / 1000 : 0;

  const alive = view.players.filter((p) => p.role === "hider" && p.status === "active").length;
  const outSince = view.players.find((p) => p.id === me.id)?.outOfZoneSince ?? null;
  const outside = !spectating && me.role === "hider" && outSince !== null;
  const fromCenter = fix ? distance(fix, current.center) : 0;
  // Local early warning before the server confirms (it checks every few seconds, with GPS slack).
  const edgeWarning = spectating || me.role !== "hider" || outside || !fix ? null : fromCenter > current.radius ? "Estás saliendo de la zona. Vuelve dentro." : fromCenter > current.radius - 25 ? "Estás en el borde de la zona." : null;

  const players: MapPlayer[] = view.players
    .filter((p) => p.loc && p.id !== me.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.loc!,
      kind: p.role === "seeker" ? "seeker" : p.visibleBecause === "outOfZone" || p.visibleBecause === "stale" ? "revealed" : "hider",
    }));
  if (fix) players.push({ id: me.id, name: "Tú", pos: fix, kind: "me" });

  const byId = new Map(view.players.map((p) => [p.id, p]));
  const pings: MapPing[] = view.pings.map((p) => ({ area: p.area, label: byId.get(p.playerId)?.name ?? "", kind: byId.get(p.playerId)?.role ?? "hider" }));

  let headline: string;
  let clock: string | null = null;
  if (phase === "hiding") {
    headline = me.role === "seeker" ? "Salida del cazador" : "Tiempo para esconderte";
    clock = fmt(view.seekStartAt! - now);
  } else if (phase === "seeking" && zone) {
    if (zone.shrinking) headline = `Cerrando zona ${zone.index} de ${config.shrinkCount}`;
    else if (zone.nextShrinkAt) {
      headline = zone.index === 0 ? "Primer cierre" : `Cierre ${zone.index + 1} de ${config.shrinkCount}`;
      clock = fmt(zone.nextShrinkAt - now);
    } else {
      headline = "Zona final";
      clock = deadline ? fmt(deadline - now) : null;
    }
  } else {
    headline = "Partida terminada";
  }
  if (outside) {
    headline = "Fuera de la zona";
    clock = fmt(outSince! + config.outOfZoneGraceSeconds * 1000 - now);
  }

  const roleLabel = me.role === "seeker" ? "Cazador" : me.status === "active" ? "Escondido" : me.status === "caught" ? "Pillado" : "Eliminado";

  return (
    <main className="play">
      <GameMap
        ref={mapRef}
        zone={current}
        nextZone={zone?.next ?? null}
        pings={pings}
        players={players}
        focus={config.zone}
        padding={MAP_PADDING}
        attribution="top-right"
        onTap={SIM_MODE && !spectating ? gps.setSimFix : undefined}
      />
      <div className={`vignette${outside ? " on" : ""}`} />

      <header className={`hud${outside ? " alert" : ""}`}>
        <div className="hud-main">
          <div className="hud-phase">
            <span className={`label role ${me.role}`}>
              <i />
              {roleLabel}
            </span>
            <b>{headline}</b>
          </div>
          {clock && <div className="hud-clock num">{clock}</div>}
        </div>
        {!outside && <Timeline config={config} elapsed={elapsed} />}
        <div className="hud-meta">
          <span>
            <Users size={14} /> <span className="num">{alive}</span> en juego
          </span>
          {view.nextPingAt && phase === "seeking" && (
            <span>
              <Radar size={14} /> Radar en <span className="num">{fmt(view.nextPingAt - now)}</span>
            </span>
          )}
          {outside && <span>Vuelve dentro o quedarás eliminado</span>}
        </div>
      </header>

      <div className="side-fab">
        <button className="icon-btn" aria-label="Centrar en mi posición" disabled={!fix} onClick={() => fix && mapRef.current?.flyTo(fix)}>
          <LocateFixed size={20} />
        </button>
        <button className="icon-btn" aria-label="Ver toda la zona" onClick={() => mapRef.current?.fit(current)}>
          <Focus size={20} />
        </button>
      </div>
      {SIM_MODE && !spectating && (
        <div className="sim-chip">
          <span className="pill">Simulación · toca para moverte</span>
        </div>
      )}

      <footer className="sheet">
        <div className="grabber" />
        {gps.error && !SIM_MODE && <Notice tone="warn">{gps.error}</Notice>}
        {edgeWarning && <Notice tone="warn">{edgeWarning}</Notice>}
        {ended ? (
          <Results view={view} isHost={isHost} send={send} />
        ) : me.role === "seeker" ? (
          <SeekerSheet view={view} send={send} />
        ) : (
          <HiderSheet view={view} send={send} ask={ask} />
        )}
        {isHost && !ended && (
          <div className="sheet-foot">
            <span className="faint small">{phase === "hiding" ? "Mantén la pantalla encendida durante la partida" : "Eres el anfitrión"}</span>
            <button
              className="btn btn-text danger btn-sm"
              onClick={() => ask({ title: "¿Terminar la partida?", body: "Se acabará para todos los jugadores y nadie ganará.", confirm: "Terminar partida", danger: true, onConfirm: () => send({ t: "end" }) })}
            >
              Terminar
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}

function SeekerSheet({ view, send }: { view: GameView; send: (m: ClientMsg) => void }) {
  const [code, setCode] = useState("");
  if (view.phase === "hiding") {
    return (
      <div className="result">
        <span className="label">Quédate en la salida</span>
        <p className="muted">Los escondidos están buscando sitio. Cuando el reloj llegue a cero, empieza la caza.</p>
      </div>
    );
  }
  return (
    <form
      className="result"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length !== 4) return;
        send({ t: "catch", code });
        setCode("");
      }}
    >
      <span className="label">¿Has pillado a alguien?</span>
      <div className="catch-row">
        <CodeInput length={4} numeric value={code} onChange={setCode} label="Código de captura" />
        <button className="btn btn-blaze" disabled={code.length !== 4}>
          Pillar
        </button>
      </div>
      <p className="faint small">Pídele su código de 4 cifras. Aparece en su pantalla.</p>
    </form>
  );
}

function HiderSheet({ view, send, ask }: { view: GameView; send: (m: ClientMsg) => void; ask: (r: ConfirmRequest) => void }) {
  if (view.me.status !== "active") {
    return (
      <div className="result">
        <span className="label">{view.me.status === "caught" ? "Te han pillado" : "Eliminado por salir de la zona"}</span>
        <p className="muted">Sigue la partida desde aquí: ahora ves a todos los jugadores.</p>
      </div>
    );
  }
  return (
    <div className="row spread" style={{ alignItems: "flex-end" }}>
      <div className="result">
        <span className="label">Tu código de captura</span>
        <div className="capture-code num">{view.me.catchCode}</div>
        <p className="faint small">Enséñalo solo si el cazador te toca.</p>
      </div>
      <button
        className="btn btn-soft btn-sm"
        onClick={() => ask({ title: "¿Te han pillado?", body: "Quedarás fuera de la partida. Úsalo si el cazador no puede introducir tu código.", confirm: "Sí, me han pillado", danger: true, onConfirm: () => send({ t: "surrender" }) })}
      >
        Me han pillado
      </button>
    </div>
  );
}

const STATUS_LABEL = { active: "En juego", caught: "Pillado", eliminated: "Eliminado" };

function Results({ view, isHost, send }: { view: GameView; isHost: boolean; send: (m: ClientMsg) => void }) {
  const winners = new Set(view.winners);
  const iWon = winners.has(view.me.id);
  const names = view.players.filter((p) => winners.has(p.id)).map((p) => p.name);
  const sorted = [...view.players].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)));
  return (
    <div className="result">
      <span className="label row" style={{ gap: 6 }}>
        <Trophy size={14} /> Resultado
      </span>
      <h2 className="display">{iWon ? "Has ganado" : names.length ? `Gana ${names.join(", ")}` : "Sin ganador"}</h2>
      <p className="muted">{view.winReason}</p>
      <ul className="standings">
        {sorted.map((p) => (
          <li key={p.id}>
            <span className={`avatar ${p.role}`}>{initials(p.name)}</span>
            <span className="who">{p.name}</span>
            <span className={`badge${winners.has(p.id) ? " win" : ""}`}>{winners.has(p.id) ? "Gana" : p.role === "seeker" ? "Cazador" : STATUS_LABEL[p.status]}</span>
          </li>
        ))}
      </ul>
      {isHost ? (
        <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => send({ t: "reset" })}>
          Jugar otra vez
        </button>
      ) : (
        <p className="faint small">El anfitrión puede empezar otra ronda.</p>
      )}
    </div>
  );
}
