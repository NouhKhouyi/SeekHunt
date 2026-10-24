import { bearing, buildSchedule, type ClientMsg, distance, gameDeadline, type GameView, MAX_FLOOR, MIN_FLOOR, type Ping, TRUSTED_ALTITUDE_ACCURACY, zoneAt } from "@seekhunt/shared";
import { Building2, ChevronDown, Focus, LifeBuoy, LocateFixed, Minus, Navigation2, Pause, Play as PlayIcon, Plus, Radar, ScanLine, Share2, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CatchQr, QrFullscreen, Scanner } from "./Catch";
import { GameMap, type MapHandle, type MapPing, type MapPlayer } from "./GameMap";
import { type Key, useT } from "./i18n";
import { type MyFix, SIM_MODE, WALKING_LIMIT } from "./location";
import type { Gps } from "./Room";
import { shareResult } from "./share";
import { type ConfirmRequest, fmt, fmtDuration, GameProgress, initials, Notice, useNow } from "./ui";

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
  const live = useNow(clockOffset);
  // While paused every clock, the zone and the radar countdown stand still at the pause instant.
  const paused = view.pausedAt !== null && (view.phase === "hiding" || view.phase === "seeking");
  const now = paused ? view.pausedAt! : live;
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
  const pings: MapPing[] = view.pings.map((p) => ({ area: p.area, label: pingText(p), kind: byId.get(p.playerId)?.role ?? "hider", at: p.at }));

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
  if (paused) headline = t("pause.title");

  // Which way is safety: distance to the edge and a compass direction, for anyone outside the circle.
  const lost = !spectating && me.role === "hider" && !!fix && fromCenter > current.radius;
  const way = lost ? { meters: Math.max(1, Math.round(fromCenter - current.radius)), heading: bearing(fix!, current.center) } : null;

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
        shrinking={!!zone?.shrinking && !paused}
        paused={paused}
        onTap={SIM_MODE && !spectating ? gps.setSimFix : undefined}
      />
      <div className={`vignette${outside && !paused ? " on" : ""}`} />
      {!ended && <Moments view={view} now={now} paused={paused} zone={zone} alive={alive} />}

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
          way ? (
            <div className="hud-meta way">
              <Navigation2 size={18} style={{ transform: `rotate(${way.heading}deg)` }} aria-hidden />
              {t("back.dist", { m: way.meters, dir: t(`dir.${Math.round(way.heading / 45) % 8}` as Key) })}
            </div>
          ) : (
            <div className="hud-meta">{t("hud.outsideMeta")}</div>
          )
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

      <footer className={`sheet${ended ? " ended" : ""}`}>
        <div className="grabber" />
        {paused && (
          <Notice
            icon={<Pause size={18} />}
            action={
              isHost && (
                <button className="notice-action" onClick={() => send({ t: "resume" })}>
                  {t("host.resume")}
                </button>
              )
            }
          >
            <b>{t("pause.title")}.</b> {isHost ? t("pause.bodyHost") : t("pause.body")}
          </Notice>
        )}
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
        {edgeWarning && (
          <Notice tone="warn" icon={way && <Navigation2 size={18} style={{ transform: `rotate(${way.heading}deg)` }} aria-hidden />}>
            {edgeWarning}
            {way && ` ${t("back.dist", { m: way.meters, dir: t(`dir.${Math.round(way.heading / 45) % 8}` as Key) })}.`}
          </Notice>
        )}
        {building && view.pings.length > 0 && !ended && <RadarList pings={view.pings} label={pingText} onShow={(p) => mapRef.current?.fit(p.area)} />}
        {building && !spectating && <FloorPicker floor={me.floor} onChange={(floor) => send({ t: "floor", floor })} />}
        {ended ? (
          <Results view={view} isHost={isHost} send={send} />
        ) : me.role === "seeker" ? (
          <SeekerSheet view={view} send={send} fast={fast} paused={paused} />
        ) : (
          <HiderSheet view={view} send={send} ask={ask} />
        )}
        {isHost && !ended && (
          <div className="sheet-foot">
            <span className="faint small">{phase === "hiding" ? t("host.keepScreen") : t("host.you")}</span>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn btn-text btn-sm" onClick={() => send({ t: paused ? "resume" : "pause" })}>
                {paused ? <PlayIcon size={16} /> : <Pause size={16} />} {paused ? t("host.resume") : t("host.pause")}
              </button>
              <button
                className="btn btn-text danger btn-sm"
                onClick={() => ask({ title: t("end.title"), body: t("end.body"), confirm: t("end.confirm"), danger: true, onConfirm: () => send({ t: "end" }) })}
              >
                {t("host.end")}
              </button>
            </span>
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

function SeekerSheet({ view, send, fast, paused }: { view: GameView; send: (m: ClientMsg) => void; fast: boolean; paused: boolean }) {
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
      <button className="btn btn-blaze btn-block" onClick={() => setScanning(true)} disabled={fast || paused}>
        <ScanLine size={20} /> {t("seeker.scan")}
      </button>
      <p className="faint small">{paused ? t("err.paused") : fast ? t("seeker.fast") : t("seeker.howto")}</p>
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

/** What happened, in order: the start, the release, every catch and elimination, the end. */
function timeline(view: GameView, t: T) {
  const start = view.startedAt ?? 0;
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const items: { at: number; text: string; kind: "phase" | "catch" | "elim" }[] = [{ at: start, text: t("tl.start"), kind: "phase" }];
  if (view.seekStartAt !== null && view.seekStartAt < (view.endedAt ?? Infinity)) items.push({ at: view.seekStartAt, text: t("tl.release"), kind: "phase" });
  for (const p of view.players) {
    if (p.outAt == null) continue;
    const by = p.caughtBy ? names.get(p.caughtBy) : null;
    const text = p.status === "eliminated" ? t("tl.eliminated", { name: p.name }) : by ? t("tl.caught", { by, name: p.name }) : t("tl.surrendered", { name: p.name });
    items.push({ at: p.outAt, text, kind: p.status === "eliminated" ? "elim" : "catch" });
  }
  if (view.endedAt !== null) items.push({ at: view.endedAt, text: t("tl.end"), kind: "phase" });
  return items.sort((a, b) => a.at - b.at).map((i) => ({ ...i, offset: fmt(i.at - start) }));
}

function Results({ view, isHost, send }: { view: GameView; isHost: boolean; send: (m: ClientMsg) => void }) {
  const t = useT();
  const [showTimeline, setShowTimeline] = useState(false);
  const [sharing, setSharing] = useState<"idle" | "busy" | "saved">("idle");
  const winners = new Set(view.winners);
  const iWon = winners.has(view.me.id);
  const names = view.players.filter((p) => winners.has(p.id)).map((p) => p.name);
  const sorted = [...view.players].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)) || (b.outAt ?? Infinity) - (a.outAt ?? Infinity));
  const catches = view.players.filter((p) => p.caughtBy).length;
  const survivors = view.players.filter((p) => p.role === "hider" && p.status === "active").length;
  const duration = view.startedAt !== null && view.endedAt !== null ? fmtDuration(view.endedAt - view.startedAt) : "–";
  const items = useMemo(() => timeline(view, t), [view, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    setSharing("busy");
    try {
      const outcome = await shareResult(view, t.lang);
      setSharing(outcome === "saved" ? "saved" : "idle");
    } catch {
      setSharing("idle");
    }
  };

  return (
    <div className="result results">
      <h2 className="display row" style={{ gap: 10 }}>
        {iWon && <Trophy size={30} strokeWidth={2.5} aria-hidden />}
        {iWon ? t("results.won") : names.length ? t("results.winner", { names: names.join(", ") }) : t("results.none")}
      </h2>
      <p className="muted">{t.msg(view.winReason)}</p>
      <dl className="stats">
        <div>
          <dt>{t("results.duration")}</dt>
          <dd className="num">{duration}</dd>
        </div>
        <div>
          <dt>{t("results.catches")}</dt>
          <dd className="num">{catches}</dd>
        </div>
        <div>
          <dt>{t("results.survivors")}</dt>
          <dd className="num">{survivors}</dd>
        </div>
      </dl>
      <ul className="standings">
        {sorted.map((p) => (
          <li key={p.id}>
            <span className={`avatar ${p.role}`}>{initials(p.name)}</span>
            <span className="who">{p.name}</span>
            <span className={`badge${winners.has(p.id) ? " win" : ""}`}>{winners.has(p.id) ? t("results.badgeWin") : p.role === "seeker" && !p.outAt ? t("role.seeker") : t(STATUS_KEY[p.status === "active" && p.outAt ? "caught" : p.status])}</span>
          </li>
        ))}
      </ul>
      <button className="disclosure" aria-expanded={showTimeline} onClick={() => setShowTimeline(!showTimeline)}>
        {t("results.timeline")}
        <ChevronDown size={20} />
      </button>
      {showTimeline && (
        <ol className="timeline">
          {items.map((i, k) => (
            <li key={k} className={i.kind}>
              <span className="num">{i.offset}</span>
              <span>{i.text}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="results-actions">
        <button className="btn btn-soft" onClick={share} disabled={sharing === "busy"}>
          {sharing === "busy" ? <span className="spinner" /> : <Share2 size={18} />}
          {sharing === "saved" ? t("results.saved") : t("results.share")}
        </button>
        {isHost && (
          <button className="btn" onClick={() => send({ t: "reset" })}>
            {t("results.again")}
          </button>
        )}
      </div>
      {!isHost && <p className="faint small">{t("results.waitHost")}</p>}
    </div>
  );
}

/**
 * The beats of a game, played full-screen for a moment: the last seconds before the seeker is
 * released, the release itself, and each time the zone starts closing. Never blocks a tap.
 */
function Moments({ view, now, paused, zone, alive }: { view: GameView; now: number; paused: boolean; zone: ReturnType<typeof zoneAt> | null; alive: number }) {
  const t = useT();
  const [moment, setMoment] = useState<{ id: number; title: string; sub?: string; tone: "release" | "zone" } | null>(null);
  const prev = useRef({ phase: view.phase, shrinking: zone?.shrinking ?? false, index: zone?.index ?? 0 });
  const isSeeker = view.me.role === "seeker";

  useEffect(() => {
    const before = prev.current;
    const shrinking = zone?.shrinking ?? false;
    const index = zone?.index ?? 0;
    prev.current = { phase: view.phase, shrinking, index };
    if (paused) return;
    if (before.phase === "hiding" && view.phase === "seeking") {
      setMoment({ id: Date.now(), tone: "release", title: isSeeker ? t("moment.seekerOut") : t("moment.seekerOutHider"), sub: t("moment.seekerOutSub", { n: alive }) });
    } else if (view.phase === "seeking" && shrinking && (!before.shrinking || index !== before.index)) {
      const last = index === view.config.shrinkCount;
      setMoment({ id: Date.now(), tone: "zone", title: last ? t("moment.final") : t("moment.closing"), sub: t("moment.closingSub") });
    }
  }, [view.phase, zone?.shrinking, zone?.index, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!moment) return;
    const timer = setTimeout(() => setMoment(null), 2600);
    return () => clearTimeout(timer);
  }, [moment]);

  // 3, 2, 1 before the seeker sets off.
  const left = view.phase === "hiding" && view.seekStartAt !== null && !paused ? Math.ceil((view.seekStartAt - now) / 1000) : 0;
  if (left >= 1 && left <= 3) {
    return (
      <div className="moment countdown" aria-live="assertive">
        <b key={left} className="num">
          {left}
        </b>
      </div>
    );
  }
  if (!moment) return null;
  return (
    <div className={`moment ${moment.tone}`} role="status" key={moment.id}>
      <div>
        <b className="display">{moment.title}</b>
        {moment.sub && <span>{moment.sub}</span>}
      </div>
    </div>
  );
}
