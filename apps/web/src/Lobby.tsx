import type { ClientMsg, GameConfig, GameView } from "@seekhunt/shared";
import { GameMap, type MapPlayer } from "./GameMap";
import type { MyFix } from "./location";
import { SIM_MODE } from "./location";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  fix: MyFix | null;
}

type NumKey = { [K in keyof GameConfig]: GameConfig[K] extends number ? K : never }[keyof GameConfig];

const MIN = 60;
const OPTIONS: { key: NumKey; label: string; values: [number, string][] }[] = [
  { key: "hideSeconds", label: "Tiempo para esconderse", values: [[MIN, "1 min"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [10 * MIN, "10 min"], [15 * MIN, "15 min"]] },
  { key: "shrinkCount", label: "Cierres de zona", values: [[3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]] },
  { key: "shrinkIntervalSeconds", label: "Cada cuánto se cierra", values: [[2 * MIN, "2 min"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [8 * MIN, "8 min"], [10 * MIN, "10 min"]] },
  { key: "shrinkDurationSeconds", label: "Duración del cierre", values: [[0, "Instantáneo"], [30, "30 s"], [60, "1 min"], [2 * MIN, "2 min"]] },
  { key: "finalRadius", label: "Radio final", values: [[30, "30 m"], [60, "60 m"], [100, "100 m"], [200, "200 m"]] },
  { key: "finalHoldSeconds", label: "Tiempo extra al final", values: [[0, "Nada"], [3 * MIN, "3 min"], [5 * MIN, "5 min"], [10 * MIN, "10 min"]] },
  { key: "outOfZoneGraceSeconds", label: "Margen fuera de zona", values: [[15, "15 s"], [30, "30 s"], [45, "45 s"], [90, "90 s"]] },
  { key: "pingIntervalSeconds", label: "Radar", values: [[0, "Desactivado"], [2 * MIN, "Cada 2 min"], [3 * MIN, "Cada 3 min"], [5 * MIN, "Cada 5 min"]] },
  { key: "pingFuzzMeters", label: "Precisión del radar", values: [[30, "±30 m"], [80, "±80 m"], [150, "±150 m"], [300, "±300 m"]] },
];

export function Lobby({ view, send, fix }: Props) {
  const isHost = view.me.id === view.hostId;
  const cfg = view.config;
  const setConfig = (c: Partial<GameConfig>) => send({ t: "config", config: c });
  const seekers = view.players.filter((p) => p.role === "seeker").length;
  const hiders = view.players.length - seekers;
  const shareUrl = `${location.origin}${location.pathname}${SIM_MODE ? "?sim" : ""}#${view.code}`;

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "SeekHunt", text: `Únete a mi partida: ${view.code}`, url: shareUrl });
      else await navigator.clipboard.writeText(shareUrl);
    } catch {
      // User dismissed the share sheet.
    }
  };

  const mapPlayers: MapPlayer[] = view.players
    .filter((p) => p.loc)
    .map((p) => ({ id: p.id, name: p.name, pos: p.loc!, kind: p.id === view.me.id ? "me" : p.role }));
  if (fix && !mapPlayers.some((p) => p.kind === "me")) mapPlayers.push({ id: view.me.id, name: "Tú", pos: fix, kind: "me" });

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div>
          <div className="eyebrow">Código de sala</div>
          <div className="room-code">{view.code}</div>
        </div>
        <button className="btn" onClick={share}>
          Invitar
        </button>
      </header>

      <section className="card map-card">
        <GameMap zone={cfg.zone} focus={cfg.zone} players={mapPlayers} onTap={isHost ? (p) => setConfig({ zone: { center: p, radius: cfg.zone.radius } }) : undefined} />
        {isHost ? (
          <div className="map-tools">
            <p className="hint">Toca el mapa para mover el centro de la zona.</p>
            <label className="field">
              <span>Radio inicial: {Math.round(cfg.zone.radius)} m</span>
              <input
                type="range"
                min={100}
                max={5000}
                step={50}
                value={cfg.zone.radius}
                onChange={(e) => setConfig({ zone: { center: cfg.zone.center, radius: Number(e.target.value) } })}
              />
            </label>
            <button className="btn btn-small" disabled={!fix} onClick={() => fix && setConfig({ zone: { center: fix, radius: cfg.zone.radius } })}>
              Centrar en mi ubicación
            </button>
          </div>
        ) : (
          <p className="hint">El anfitrión está eligiendo la zona de juego.</p>
        )}
      </section>

      <section className="card">
        <h2>
          Jugadores <span className="muted">({seekers} cazador{seekers === 1 ? "" : "es"}, {hiders} escondido{hiders === 1 ? "" : "s"})</span>
        </h2>
        <ul className="players">
          {view.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <span className={`dot dot-${p.role}`} />
              <span className="pname">
                {p.name}
                {p.id === view.hostId && <span className="tag">anfitrión</span>}
                {p.id === view.me.id && <span className="tag">tú</span>}
              </span>
              {isHost ? (
                <>
                  <button className="btn btn-small" onClick={() => send({ t: "setRole", playerId: p.id, role: p.role === "seeker" ? "hider" : "seeker" })}>
                    {p.role === "seeker" ? "Cazador" : "Escondido"}
                  </button>
                  {p.id !== view.me.id && (
                    <button className="btn btn-small btn-ghost" aria-label={`Expulsar a ${p.name}`} onClick={() => send({ t: "kick", playerId: p.id })}>
                      ✕
                    </button>
                  )}
                </>
              ) : (
                <span className="muted">{p.role === "seeker" ? "Cazador" : "Escondido"}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Reglas</h2>
        <div className="grid">
          {OPTIONS.map((o) => (
            <label key={o.key} className="field">
              <span>{o.label}</span>
              <select disabled={!isHost} value={cfg[o.key]} onChange={(e) => setConfig({ [o.key]: Number(e.target.value) })}>
                {!o.values.some(([v]) => v === cfg[o.key]) && <option value={cfg[o.key]}>{cfg[o.key]}</option>}
                {o.values.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" disabled={!isHost} checked={cfg.lastSurvivorWins} onChange={(e) => setConfig({ lastSurvivorWins: e.target.checked })} />
          Gana el último superviviente
        </label>
        <label className="check">
          <input type="checkbox" disabled={!isHost} checked={cfg.caughtBecomeSeekers} onChange={(e) => setConfig({ caughtBecomeSeekers: e.target.checked })} />
          Modo infección: los pillados se vuelven cazadores
        </label>
      </section>

      <footer className="sticky-foot">
        {isHost ? (
          <button className="btn btn-primary btn-block" disabled={seekers === 0 || hiders === 0} onClick={() => send({ t: "start" })}>
            Empezar partida
          </button>
        ) : (
          <p className="hint center">Esperando a que el anfitrión empiece…</p>
        )}
      </footer>
    </main>
  );
}
