import type { ClientMsg, GameConfig, GameView, Role } from "@seekhunt/shared";
import { Check, ChevronDown, ChevronLeft, LocateFixed, Share2, X } from "lucide-react";
import { useRef, useState } from "react";
import { GameMap, type MapHandle, type MapPlayer } from "./GameMap";
import { SIM_MODE } from "./location";
import type { Gps } from "./Room";
import { initials, Notice, Segmented, Switch, Timeline } from "./ui";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  gps: Gps;
  onLeave: () => void;
}

const MIN = 60;
type Timing = Pick<GameConfig, "hideSeconds" | "shrinkCount" | "shrinkIntervalSeconds" | "shrinkDurationSeconds" | "finalRadius" | "finalHoldSeconds" | "pingIntervalSeconds">;
const PRESETS: { id: string; label: string; timing: Timing }[] = [
  { id: "quick", label: "Rápida", timing: { hideSeconds: 3 * MIN, shrinkCount: 4, shrinkIntervalSeconds: 3 * MIN, shrinkDurationSeconds: 30, finalRadius: 40, finalHoldSeconds: 3 * MIN, pingIntervalSeconds: 2 * MIN } },
  { id: "classic", label: "Clásica", timing: { hideSeconds: 5 * MIN, shrinkCount: 5, shrinkIntervalSeconds: 5 * MIN, shrinkDurationSeconds: MIN, finalRadius: 60, finalHoldSeconds: 5 * MIN, pingIntervalSeconds: 3 * MIN } },
  { id: "long", label: "Larga", timing: { hideSeconds: 10 * MIN, shrinkCount: 6, shrinkIntervalSeconds: 8 * MIN, shrinkDurationSeconds: 2 * MIN, finalRadius: 100, finalHoldSeconds: 10 * MIN, pingIntervalSeconds: 5 * MIN } },
];

type NumKey = { [K in keyof GameConfig]: GameConfig[K] extends number ? K : never }[keyof GameConfig];
const ADVANCED: { key: NumKey; label: string; hint?: string; values: [number, string][] }[] = [
  { key: "hideSeconds", label: "Tiempo para esconderse", values: [[MIN, "1 min"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [10 * MIN, "10 min"], [15 * MIN, "15 min"]] },
  { key: "shrinkCount", label: "Número de cierres", values: [[3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]] },
  { key: "shrinkIntervalSeconds", label: "Tiempo entre cierres", values: [[2 * MIN, "2 min"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [8 * MIN, "8 min"], [10 * MIN, "10 min"]] },
  { key: "shrinkDurationSeconds", label: "Duración de cada cierre", values: [[0, "Instantáneo"], [30, "30 s"], [MIN, "1 min"], [2 * MIN, "2 min"]] },
  { key: "finalRadius", label: "Radio de la zona final", values: [[30, "30 m"], [40, "40 m"], [60, "60 m"], [100, "100 m"], [200, "200 m"]] },
  { key: "finalHoldSeconds", label: "Tiempo en la zona final", values: [[0, "Ninguno"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [10 * MIN, "10 min"]] },
  { key: "outOfZoneGraceSeconds", label: "Margen fuera de la zona", hint: "Después, eliminado", values: [[15, "15 s"], [30, "30 s"], [45, "45 s"], [90, "90 s"]] },
  { key: "pingIntervalSeconds", label: "Radar", hint: "Revela posiciones aproximadas", values: [[0, "Desactivado"], [2 * MIN, "Cada 2 min"], [3 * MIN, "Cada 3 min"], [5 * MIN, "Cada 5 min"]] },
  { key: "pingFuzzMeters", label: "Precisión del radar", values: [[30, "± 30 m"], [80, "± 80 m"], [150, "± 150 m"], [300, "± 300 m"]] },
];

const totalMinutes = (c: GameConfig) => Math.round((c.hideSeconds + c.shrinkCount * c.shrinkIntervalSeconds + c.shrinkDurationSeconds + c.finalHoldSeconds) / 60);
const fmtKm2 = (r: number) => (Math.PI * r * r) / 1e6;

export function Lobby({ view, send, gps, onLeave }: Props) {
  const isHost = view.me.id === view.hostId;
  const cfg = view.config;
  const setConfig = (c: Partial<GameConfig>) => send({ t: "config", config: c });
  const [advanced, setAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [radius, setRadius] = useState<number | null>(null);
  const mapRef = useRef<MapHandle>(null);

  const seekers = view.players.filter((p) => p.role === "seeker").length;
  const hiders = view.players.length - seekers;
  const preset = PRESETS.find((p) => (Object.keys(p.timing) as (keyof Timing)[]).every((k) => cfg[k] === p.timing[k]))?.id ?? null;
  const shownRadius = radius ?? cfg.zone.radius;
  const area = fmtKm2(shownRadius);

  const share = async () => {
    const url = `${location.origin}${location.pathname}${SIM_MODE ? "?sim" : ""}#${view.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "SeekHunt", text: `Únete a mi partida de SeekHunt con el código ${view.code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  const locate = async () => {
    setLocError(null);
    setLocating(true);
    try {
      const fix = await gps.requestFix();
      if (isHost) setConfig({ zone: { center: fix, radius: cfg.zone.radius } });
      mapRef.current?.flyTo(fix);
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "No se pudo obtener tu ubicación.");
    } finally {
      setLocating(false);
    }
  };

  const mapPlayers: MapPlayer[] = view.players
    .filter((p) => p.loc && p.id !== view.me.id)
    .map((p) => ({ id: p.id, name: p.name, pos: p.loc!, kind: p.role }));
  if (gps.fix) mapPlayers.push({ id: view.me.id, name: "Tú", pos: gps.fix, kind: "me" });

  return (
    <main className="lobby">
      <div className="lobby-map">
        <GameMap
          ref={mapRef}
          zone={{ center: cfg.zone.center, radius: shownRadius }}
          focus={cfg.zone}
          refitKey={cfg.zone.radius}
          attribution="bottom-left"
          padding={{ top: 80, bottom: 60, left: 30, right: 30 }}
          players={mapPlayers}
          onTap={isHost ? (p) => setConfig({ zone: { center: p, radius: cfg.zone.radius } }) : SIM_MODE ? gps.setSimFix : undefined}
        />
        <div className="map-top">
          <button className="icon-btn" onClick={onLeave} aria-label="Salir de la sala">
            <ChevronLeft size={22} />
          </button>
          <button className="room-chip" onClick={share} aria-label={`Compartir código ${view.code}`}>
            <span className="num" translate="no">{view.code}</span>
            <span className="chip-icon">{copied ? <Check size={18} /> : <Share2 size={18} />}</span>
          </button>
        </div>
        {isHost && (
          <div className="map-hint">
            <span className="pill">Toca el mapa para mover el centro</span>
          </div>
        )}
        <div className="map-fab">
          <button className="icon-btn" onClick={locate} aria-label={isHost ? "Centrar la zona en mi ubicación" : "Ver mi ubicación"} disabled={locating}>
            {locating ? <span className="spinner" /> : <LocateFixed size={20} />}
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="grabber" />
        <header className="panel-head">
          <span className="label">Sala {view.code}</span>
          <h1 className="display">{isHost ? "Prepara la partida" : "Esperando al anfitrión"}</h1>
        </header>

        {(locError || gps.error) && (
          <div style={{ paddingBottom: 16 }}>
            <Notice tone="warn">{locError ?? gps.error}</Notice>
          </div>
        )}

        <div className="block">
          <div className="block-head">
            <h2>Zona de juego</h2>
            <span className="faint small num">{area < 1 ? `${(area * 100).toFixed(0)} ha` : `${area.toFixed(2).replace(".", ",")} km²`}</span>
          </div>
          <div className="row spread">
            <div className="big-value num">
              {Math.round(shownRadius)}
              <small>m de radio</small>
            </div>
          </div>
          {isHost && (
            <input
              id="radius"
              type="range"
              aria-label="Radio inicial"
              min={100}
              max={3000}
              step={50}
              value={shownRadius}
              onChange={(e) => setRadius(Number(e.target.value))}
              onPointerUp={() => radius !== null && (setConfig({ zone: { center: cfg.zone.center, radius } }), setRadius(null))}
              onKeyUp={() => radius !== null && (setConfig({ zone: { center: cfg.zone.center, radius } }), setRadius(null))}
            />
          )}
        </div>

        <div className="block">
          <div className="block-head">
            <h2>Jugadores</h2>
            <span className="faint small">
              {seekers} cazador{seekers === 1 ? "" : "es"} · {hiders} escondido{hiders === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="players">
            {view.players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "offline"}>
                <span className={`avatar ${p.role}`}>{initials(p.name)}</span>
                <span className="who">
                  <b>
                    {p.name}
                    {p.id === view.me.id && <span className="faint"> (tú)</span>}
                  </b>
                  <span>
                    <i className="dot-online" />
                    {p.id === view.hostId ? "Anfitrión" : p.connected ? "Conectado" : "Desconectado"}
                  </span>
                </span>
                {isHost ? (
                  <>
                    <Segmented<Role>
                      small
                      label={`Rol de ${p.name}`}
                      value={p.role}
                      onChange={(role) => send({ t: "setRole", playerId: p.id, role })}
                      options={[
                        { value: "seeker", label: "Caza" },
                        { value: "hider", label: "Se esconde" },
                      ]}
                    />
                    {p.id !== view.me.id && (
                      <button className="icon-btn plain" aria-label={`Expulsar a ${p.name}`} onClick={() => send({ t: "kick", playerId: p.id })}>
                        <X size={18} />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="badge">{p.role === "seeker" ? "Caza" : "Se esconde"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="block">
          <div className="block-head">
            <h2>Ritmo</h2>
            <span className="faint small num">≈ {totalMinutes(cfg)} min</span>
          </div>
          {isHost && (
            <Segmented
              label="Ritmo de la partida"
              value={preset}
              onChange={(id) => setConfig(PRESETS.find((p) => p.id === id)!.timing)}
              options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            />
          )}
          <Timeline config={cfg} />
          <div className="timeline-legend num">
            <span>{Math.round(cfg.hideSeconds / 60)}′ escondite</span>
            <span>
              {cfg.shrinkCount} cierres × {Math.round(cfg.shrinkIntervalSeconds / 60)}′
            </span>
            <span>{Math.round(cfg.zone.radius)} → {Math.round(cfg.finalRadius)} m</span>
          </div>
        </div>

        <div className="block">
          <button className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            Reglas
            <ChevronDown size={20} />
          </button>
          {advanced && (
            <ul className="settings">
              <li>
                <label htmlFor="opt-last">
                  Gana el último superviviente
                  <span className="hint">Si no, ganan todos los que aguanten</span>
                </label>
                <Switch id="opt-last" disabled={!isHost} checked={cfg.lastSurvivorWins} onChange={(v) => setConfig({ lastSurvivorWins: v })} />
              </li>
              <li>
                <label htmlFor="opt-infect">
                  Modo infección
                  <span className="hint">Quien es pillado pasa a cazar</span>
                </label>
                <Switch id="opt-infect" disabled={!isHost} checked={cfg.caughtBecomeSeekers} onChange={(v) => setConfig({ caughtBecomeSeekers: v })} />
              </li>
              {ADVANCED.map((o) => (
                <li key={o.key}>
                  <label htmlFor={`opt-${o.key}`}>
                    {o.label}
                    {o.hint && <span className="hint">{o.hint}</span>}
                  </label>
                  <select id={`opt-${o.key}`} disabled={!isHost} value={cfg[o.key]} onChange={(e) => setConfig({ [o.key]: Number(e.target.value) })}>
                    {!o.values.some(([v]) => v === cfg[o.key]) && <option value={cfg[o.key]}>{cfg[o.key]}</option>}
                    {o.values.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="cta-bar">
        {isHost ? (
          <button className="btn" disabled={seekers === 0 || hiders === 0} onClick={() => send({ t: "start" })}>
            <span>{hiders === 0 ? "Falta al menos un escondido" : seekers === 0 ? "Falta un cazador" : "Empezar partida"}</span>
            <span className="num">{view.players.length} jugadores</span>
          </button>
        ) : (
          <div className="waiting">
            <span className="spinner" /> El anfitrión empezará la partida
          </div>
        )}
      </footer>
    </main>
  );
}
