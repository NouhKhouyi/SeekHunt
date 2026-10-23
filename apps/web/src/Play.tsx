import { buildSchedule, type ClientMsg, distance, gameDeadline, type GameView, MAX_FLOOR, MIN_FLOOR, type Ping, TRUSTED_ALTITUDE_ACCURACY, zoneAt } from "@seekhunt/shared";
import { Building2, Focus, LifeBuoy, LocateFixed, Minus, Plus, Radar, ScanLine, Trophy, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CatchQr, QrFullscreen, Scanner } from "./Catch";
import { GameMap, type MapHandle, type MapPing, type MapPlayer } from "./GameMap";
import { useT } from "./i18n";
import { type MyFix, SIM_MODE, WALKING_LIMIT } from "./location";
import type { Gps } from "./Room";
import { type ConfirmRequest, fmt, GameProgress, initials, Notice, useNow } from "./ui";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  gps: Gps;
  clockOffset: number;
  ask: (r: ConfirmRequest) => void;
}

const MAP_PADDING = { top: 170, bottom: 220, left: 30, right: 30 };

type T = ReturnType<typeof useT>;

export function floorLabel(t: T, floor: number | null | undefined) {
  if (floor === null || floor === undefined) return t("floor.unset");
  if (floor === 0) return t("floor.ground");
  return floor < 0 ? t("floor.basement", { n: -floor }) : t("floor.n", { n: floor });
}

/** Height difference to the viewer, only when both phones measured altitude well enough to mean something. */
function altitudeHint(t: T, ping: Ping, me: MyFix | null) {
  if (ping.alt === undefined || me?.alt === undefined || (me.altAcc ?? Infinity) > TRUSTED_ALTITUDE_ACCURACY) return null;
  const d = Math.round(ping.alt - me.alt);
  if (Math.abs(d) < 3) return t("alt.same");
  return d > 0 ? t("alt.up", { m: d }) : t("alt.down", { m: -d });
}

export function Play({ view, send, gps, clockOffset, ask }: Props) {
  const t = useT();
  const now = useNow(clockOffset);
  const mapRef = useRef<MapHandle>(null);
  const { config, me, phase } = view;
  const fix = gps.fix;
  const isHost = me.id === view.hostId;
  const ended = phase === "ended";
  const spectating = ended || me.status !== "active";
  const building = !!config.buildingMode;

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
  const edgeWarning = spectating || me.role !== "hider" || outside || !fix ? null : fromCenter > current.radius ? t("play.edgeOut") : fromCenter > current.radius - 25 ? t("play.edge") : null;

  const players: MapPlayer[] = view.players
    .filter((p) => p.loc && p.id !== me.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.loc!,
      kind: p.sos ? "sos" : p.role === "seeker" ? "seeker" : p.visibleBecause === "outOfZone" || p.visibleBecause === "stale" ? "revealed" : "hider",
    }));
  if (fix) players.push({ id: me.id, name: t("common.you"), pos: fix, kind: "me" });
  const mySos = !!view.players.find((p) => p.id === me.id)?.sos;
  const othersSos = view.players.filter((p) => p.sos && p.id !== me.id);
  const fast = (fix?.speed ?? 0) > WALKING_LIMIT;

  const byId = new Map(view.players.map((p) => [p.id, p]));
  const pingText = (p: Ping) => [byId.get(p.playerId)?.name ?? "", building ? floorLabel(t, p.floor) : null, altitudeHint(t, p, fix)].filter(Boolean).join(", ");
  const pings: MapPing[] = view.pings.map((p) => ({ area: p.area, label: pingText(p), kind: byId.get(p.playerId)?.role ?? "hider" }));

  let headline: string;
  let clock: string | null = null;
  if (phase === "hiding") {
    headline = me.role === "seeker" ? t("head.seekerWait") : t("head.hide");
    clock = fmt(view.seekStartAt! - now);
  } else if (phase === "seeking" && zone) {
    if (zone.shrinking) headline = t("head.closing", { i: zone.index, n: config.shrinkCount });
    else if (zone.nextShrinkAt) {
      headline = zone.index === 0 ? t("head.first") : t("head.next", { i: zone.index + 1, n: config.shrinkCount });
      clock = fmt(zone.nextShrinkAt - now);
    } else {
      headline = t("head.final");
      clock = deadline ? fmt(deadline - now) : null;
    }
  } else {
    headline = t("head.ended");
  }
  if (outside) {
    headline = t("head.outside");
    clock = fmt(outSince! + config.outOfZoneGraceSeconds * 1000 - now);
  }

  const roleLabel = me.role === "seeker" ? t("role.seeker") : me.status === "active" ? t("role.hider") : me.status === "caught" ? t("status.caught") : t("status.eliminated");

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
        {!outside && <GameProgress config={config} elapsed={elapsed} />}
        {outside ? (
          // While the clock counts down to elimination, the only thing that matters is getting back in.
          <div className="hud-meta">{t("hud.outsideMeta")}</div>
        ) : (
          <div className="hud-meta">
            <span>
              <Users size={14} /> <span className="num">{alive}</span> {t("hud.inPlay")}
            </span>
            {view.nextPingAt && phase === "seeking" && (
              <span>
                <Radar size={14} /> {t("hud.radarIn")} <span className="num">{fmt(view.nextPingAt - now)}</span>
              </span>
            )}
            {building && !spectating && (
              <span>
                <Building2 size={14} /> {floorLabel(t, me.floor)}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="side-fab">
        <button className="icon-btn" aria-label={t("fab.me")} disabled={!fix} onClick={() => fix && mapRef.current?.flyTo(fix)}>
          <LocateFixed size={20} />
        </button>
        <button className="icon-btn" aria-label={t("fab.zone")} onClick={() => mapRef.current?.fit(current)}>
          <Focus size={20} />
        </button>
        {!ended && !mySos && (
          <button
            className="icon-btn sos"
            aria-label={t("fab.sos")}
            onClick={() => ask({ title: t("sos.title"), body: t("sos.body"), confirm: t("sos.confirm"), danger: true, onConfirm: () => send({ t: "sos" }) })}
          >
            <LifeBuoy size={20} />
          </button>
        )}
      </div>
      {SIM_MODE && !spectating && (
        <div className="sim-chip">
          <span className="pill">{t("sim.chip")}</span>
        </div>
      )}

      <footer className="sheet">
        <div className="grabber" />
        {mySos && (
          <Notice
            tone="danger"
            action={
              <button className="notice-action" onClick={() => send({ t: "sosClear" })}>
                {t("sos.ok")}
              </button>
            }
          >
            {t("sos.mine")}
          </Notice>
        )}
        {othersSos.map((p) => (
          <Notice
            key={p.id}
            tone="danger"
            action={
              p.loc && (
                <button className="notice-action" onClick={() => mapRef.current?.flyTo(p.loc!)}>
                  {t("common.view")}
                </button>
              )
            }
          >
            {t("sos.other", { name: p.name })}
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
                    {t("common.view")}
                  </button>
                }
              >
                {p.visibleBecause === "outOfZone" ? t("seen.outOfZone", { name: p.name }) : t("seen.stale", { name: p.name })}
                {building && ` ${floorLabel(t, p.floor)}.`}
              </Notice>
            ))}
        {gps.error && !SIM_MODE && <Notice tone="warn">{t.msg({ key: gps.error })}</Notice>}
        {fast && !spectating && <Notice tone="warn">{t("play.fast")}</Notice>}
        {edgeWarning && <Notice tone="warn">{edgeWarning}</Notice>}
        {building && view.pings.length > 0 && !ended && <RadarList pings={view.pings} label={pingText} onShow={(p) => mapRef.current?.fit(p.area)} />}
        {building && !spectating && <FloorPicker floor={me.floor} onChange={(floor) => send({ t: "floor", floor })} />}
        {ended ? (
          <Results view={view} isHost={isHost} send={send} />
        ) : me.role === "seeker" ? (
          <SeekerSheet view={view} send={send} fast={fast} />
        ) : (
          <HiderSheet view={view} send={send} ask={ask} />
        )}
        {isHost && !ended && (
          <div className="sheet-foot">
            <span className="faint small">{phase === "hiding" ? t("host.keepScreen") : t("host.you")}</span>
            <button
              className="btn btn-text danger btn-sm"
              onClick={() => ask({ title: t("end.title"), body: t("end.body"), confirm: t("end.confirm"), danger: true, onConfirm: () => send({ t: "end" }) })}
            >
              {t("host.end")}
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}

/** Building mode: everyone says which floor they are on; the radar repeats it. */
function FloorPicker({ floor, onChange }: { floor: number | null; onChange: (f: number | null) => void }) {
  const t = useT();
  const base = floor ?? 0;
  return (
    <div className="floor">
      <div className="floor-text">
        <span className="label">{t("floor.label")}</span>
        <b>{floorLabel(t, floor)}</b>
        {/* The reminder matters until the floor is set; after that it only costs map space. */}
        {floor === null && <span className="faint small">{t("floor.honor")}</span>}
      </div>
      <div className="stepper">
        <button className="icon-btn plain" aria-label={t("floor.down")} disabled={floor !== null && floor <= MIN_FLOOR} onClick={() => onChange(floor === null ? 0 : base - 1)}>
          <Minus size={18} />
        </button>
        <span className="num" aria-live="polite">
          {floor === null ? "–" : floor}
        </span>
        <button className="icon-btn plain" aria-label={t("floor.up")} disabled={floor !== null && floor >= MAX_FLOOR} onClick={() => onChange(floor === null ? 0 : base + 1)}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

/** The last radar as a readable list: in a building, the floor matters more than the dot on the map. */
function RadarList({ pings, label, onShow }: { pings: Ping[]; label: (p: Ping) => string; onShow: (p: Ping) => void }) {
  const t = useT();
  return (
    <ul className="radar-list" aria-label={t("set.pingIntervalSeconds")}>
      {pings.map((p) => (
        <li key={p.playerId}>
          <Radar size={14} />
          <span>{label(p)}</span>
          <button className="notice-action" onClick={() => onShow(p)}>
            {t("common.view")}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SeekerSheet({ view, send, fast }: { view: GameView; send: (m: ClientMsg) => void; fast: boolean }) {
  const t = useT();
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
        <span className="label">{t("seeker.waitTitle")}</span>
        <p className="muted">{t("seeker.waitBody")}</p>
      </div>
    );
  }
  return (
    <div className="result">
      <span className="label">{t("seeker.touched")}</span>
      <button className="btn btn-blaze btn-block" onClick={() => setScanning(true)} disabled={fast}>
        <ScanLine size={20} /> {t("seeker.scan")}
      </button>
      <p className="faint small">{fast ? t("seeker.fast") : t("seeker.howto")}</p>
      {scanning && <Scanner room={view.code} onCode={onCode} onClose={() => setScanning(false)} />}
    </div>
  );
}

function HiderSheet({ view, send, ask }: { view: GameView; send: (m: ClientMsg) => void; ask: (r: ConfirmRequest) => void }) {
  const t = useT();
  const [full, setFull] = useState(false);
  if (view.me.status !== "active") {
    return (
      <div className="result">
        <span className="label">{view.me.status === "caught" ? t("hider.caught") : t("hider.eliminated")}</span>
        <p className="muted">{t("hider.spectate")}</p>
      </div>
    );
  }
  const code = view.me.catchCode!;
  return (
    <div className="hider-sheet">
      <button className="qr-button" onClick={() => setFull(true)} aria-label={t("hider.enlargeQr")}>
        <CatchQr room={view.code} code={code} size={104} />
      </button>
      <div className="result">
        <span className="label">{t("hider.ifCaught")}</span>
        <div className="capture-code num" translate="no">
          {code}
        </div>
        <button
          className="btn btn-text btn-sm"
          style={{ alignSelf: "flex-start", padding: 0 }}
          onClick={() => ask({ title: t("surrender.title"), body: t("surrender.body"), confirm: t("surrender.confirm"), danger: true, onConfirm: () => send({ t: "surrender" }) })}
        >
          {t("hider.surrender")}
        </button>
      </div>
      {full && <QrFullscreen room={view.code} code={code} onClose={() => setFull(false)} />}
    </div>
  );
}

const STATUS_KEY = { active: "status.active", caught: "status.caught", eliminated: "status.eliminated" } as const;

function Results({ view, isHost, send }: { view: GameView; isHost: boolean; send: (m: ClientMsg) => void }) {
  const t = useT();
  const winners = new Set(view.winners);
  const iWon = winners.has(view.me.id);
  const names = view.players.filter((p) => winners.has(p.id)).map((p) => p.name);
  const sorted = [...view.players].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)));
  return (
    <div className="result">
      <h2 className="display row" style={{ gap: 10 }}>
        {iWon && <Trophy size={30} strokeWidth={2.5} aria-hidden />}
        {iWon ? t("results.won") : names.length ? t("results.winner", { names: names.join(", ") }) : t("results.none")}
      </h2>
      <p className="muted">{t.msg(view.winReason)}</p>
      <ul className="standings">
        {sorted.map((p) => (
          <li key={p.id}>
            <span className={`avatar ${p.role}`}>{initials(p.name)}</span>
            <span className="who">{p.name}</span>
            <span className={`badge${winners.has(p.id) ? " win" : ""}`}>{winners.has(p.id) ? t("results.badgeWin") : p.role === "seeker" ? t("role.seeker") : t(STATUS_KEY[p.status])}</span>
          </li>
        ))}
      </ul>
      {isHost ? (
        <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => send({ t: "reset" })}>
          {t("results.again")}
        </button>
      ) : (
        <p className="faint small">{t("results.waitHost")}</p>
      )}
    </div>
  );
}
