import { buildSchedule, type ClientMsg, distance, gameDeadline, type GameView, zoneAt } from "@seekhunt/shared";
import { Focus, LifeBuoy, LocateFixed, Radar, ScanLine, Trophy, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CatchQr, QrFullscreen, Scanner } from "./Catch";
import { GameMap, type MapHandle, type MapPing, type MapPlayer } from "./GameMap";
import { SIM_MODE, WALKING_LIMIT } from "./location";
import type { Gps } from "./Room";
import { type ConfirmRequest, fmt, initials, Notice, Timeline, useNow } from "./ui";

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
      kind: p.sos ? "sos" : p.role === "seeker" ? "seeker" : p.visibleBecause === "outOfZone" || p.visibleBecause === "stale" ? "revealed" : "hider",
    }));
  if (fix) players.push({ id: me.id, name: "Tú", pos: fix, kind: "me" });
  const mySos = !!view.players.find((p) => p.id === me.id)?.sos;
  const othersSos = view.players.filter((p) => p.sos && p.id !== me.id);
  const fast = (fix?.speed ?? 0) > WALKING_LIMIT;

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
        {outside ? (
          // While the clock counts down to elimination, the only thing that matters is getting back in.
          <div className="hud-meta">Vuelve dentro del círculo o quedarás eliminado.</div>
        ) : (
          <div className="hud-meta">
            <span>
              <Users size={14} /> <span className="num">{alive}</span> en juego
            </span>
            {view.nextPingAt && phase === "seeking" && (
              <span>
                <Radar size={14} /> Radar en <span className="num">{fmt(view.nextPingAt - now)}</span>
              </span>
            )}
          </div>
        )}
      </header>

      <div className="side-fab">
        <button className="icon-btn" aria-label="Centrar en mi posición" disabled={!fix} onClick={() => fix && mapRef.current?.flyTo(fix)}>
          <LocateFixed size={20} />
        </button>
        <button className="icon-btn" aria-label="Ver toda la zona" onClick={() => mapRef.current?.fit(current)}>
          <Focus size={20} />
        </button>
        {!ended && !mySos && (
          <button
            className="icon-btn sos"
            aria-label="Pedir ayuda (SOS)"
            onClick={() => ask({ title: "¿Pedir ayuda?", body: "Todos los jugadores verán tu posición exacta y recibirán un aviso. Úsalo si te has hecho daño o te sientes en peligro. Si es una emergencia, llama al\u00a0112.", confirm: "Enviar SOS", danger: true, onConfirm: () => send({ t: "sos" }) })}
          >
            <LifeBuoy size={20} />
          </button>
        )}
      </div>
      {SIM_MODE && !spectating && (
        <div className="sim-chip">
          <span className="pill">Simulación: toca el mapa para moverte</span>
        </div>
      )}

      <footer className="sheet">
        <div className="grabber" />
        {mySos && (
          <Notice
            tone="danger"
            action={
              <button className="notice-action" onClick={() => send({ t: "sosClear" })}>
                Estoy bien
              </button>
            }
          >
            Has pedido ayuda. Todos ven tu posición.
          </Notice>
        )}
        {othersSos.map((p) => (
          <Notice
            key={p.id}
            tone="danger"
            action={
              p.loc && (
                <button className="notice-action" onClick={() => mapRef.current?.flyTo(p.loc!)}>
                  Ver
                </button>
              )
            }
          >
            {p.name} necesita ayuda.
          </Notice>
        ))}
        {me.role === "seeker" &&
          !ended &&
          view.players
            .filter((p) => p.loc && (p.visibleBecause === "outOfZone" || p.visibleBecause === "stale") && !p.sos)
            .map((p) => (
              <Notice
                key={p.id}
                tone="warn"
                action={
                  <button className="notice-action" onClick={() => mapRef.current?.flyTo(p.loc!)}>
                    Ver
                  </button>
                }
              >
                {p.visibleBecause === "outOfZone" ? `${p.name} está fuera de la zona.` : `${p.name} ha perdido la señal. Ves su última posición.`}
              </Notice>
            ))}
        {gps.error && !SIM_MODE && <Notice tone="warn">{gps.error}</Notice>}
        {fast && !spectating && <Notice tone="warn">Vas a más de 25&nbsp;km/h. En SeekHunt se juega a pie: nada de bici, patinete ni coche.</Notice>}
        {edgeWarning && <Notice tone="warn">{edgeWarning}</Notice>}
        {ended ? (
          <Results view={view} isHost={isHost} send={send} />
        ) : me.role === "seeker" ? (
          <SeekerSheet view={view} send={send} fast={fast} />
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

function SeekerSheet({ view, send, fast }: { view: GameView; send: (m: ClientMsg) => void; fast: boolean }) {
  const [scanning, setScanning] = useState(false);
  const onCode = useCallback(
    (code: string) => {
      send({ t: "catch", code });
      setScanning(false);
    },
    [send],
  );
  if (view.phase === "hiding") {
    return (
      <div className="result">
        <span className="label">Quédate en la salida</span>
        <p className="muted">Los escondidos están buscando sitio. Cuando el reloj llegue a cero, empieza la caza.</p>
      </div>
    );
  }
  return (
    <div className="result">
      <span className="label">¿Has tocado a alguien?</span>
      <button className="btn btn-blaze btn-block" onClick={() => setScanning(true)} disabled={fast}>
        <ScanLine size={20} /> Escanear su QR para pillar
      </button>
      <p className="faint small">{fast ? "Vas demasiado rápido. Solo se puede pillar a pie." : "Escanea el QR de su pantalla o escribe sus 4 cifras. Tenéis que estar juntos."}</p>
      {scanning && <Scanner room={view.code} onCode={onCode} onClose={() => setScanning(false)} />}
    </div>
  );
}

function HiderSheet({ view, send, ask }: { view: GameView; send: (m: ClientMsg) => void; ask: (r: ConfirmRequest) => void }) {
  const [full, setFull] = useState(false);
  if (view.me.status !== "active") {
    return (
      <div className="result">
        <span className="label">{view.me.status === "caught" ? "Te han pillado" : "Eliminado por salir de la zona"}</span>
        <p className="muted">Sigue la partida desde aquí: ahora ves a todos los jugadores.</p>
      </div>
    );
  }
  const code = view.me.catchCode!;
  return (
    <div className="hider-sheet">
      <button className="qr-button" onClick={() => setFull(true)} aria-label="Ampliar código QR">
        <CatchQr room={view.code} code={code} size={104} />
      </button>
      <div className="result">
        <span className="label">Si te pillan</span>
        <div className="capture-code num" translate="no">{code}</div>
        <button
          className="btn btn-text btn-sm"
          style={{ alignSelf: "flex-start", padding: 0 }}
          onClick={() => ask({ title: "¿Te han pillado?", body: "Quedarás fuera de la partida. Úsalo solo si el cazador no puede escanear tu QR.", confirm: "Sí, me han pillado", danger: true, onConfirm: () => send({ t: "surrender" }) })}
        >
          Me han pillado
        </button>
      </div>
      {full && <QrFullscreen room={view.code} code={code} onClose={() => setFull(false)} />}
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
      <h2 className="display row" style={{ gap: 10 }}>
        {iWon && <Trophy size={30} strokeWidth={2.5} aria-hidden />}
        {iWon ? "Has ganado" : names.length ? `Gana ${names.join(", ")}` : "Sin ganador"}
      </h2>
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
