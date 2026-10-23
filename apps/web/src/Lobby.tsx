import { type ClientMsg, DEFAULT_CONFIG, distance, effectiveFinalRadius, type GameConfig, type GameView, MAX_ZONE_RADIUS, MIN_ZONE_RADIUS, type Role } from "@seekhunt/shared";
import { Check, ChevronDown, ChevronLeft, LocateFixed, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GameMap, type MapHandle, type MapPlayer } from "./GameMap";
import { type Key, locale, useT } from "./i18n";
import { SIM_MODE } from "./location";
import type { Gps } from "./Room";
import { gamePlan, initials, LangToggle, Notice, Segmented, Switch, ZoneSchedule } from "./ui";

interface Props {
  view: GameView;
  send: (m: ClientMsg) => void;
  gps: Gps;
  onLeave: () => void;
}

const MIN = 60;
type Timing = Pick<GameConfig, "hideSeconds" | "shrinkCount" | "shrinkIntervalSeconds" | "shrinkDurationSeconds" | "finalRadius" | "finalHoldSeconds" | "pingIntervalSeconds">;
const PRESETS: { id: "quick" | "classic" | "long"; timing: Timing }[] = [
  { id: "quick", timing: { hideSeconds: 3 * MIN, shrinkCount: 4, shrinkIntervalSeconds: 3 * MIN, shrinkDurationSeconds: 30, finalRadius: 40, finalHoldSeconds: 3 * MIN, pingIntervalSeconds: 2 * MIN } },
  { id: "classic", timing: { hideSeconds: 5 * MIN, shrinkCount: 5, shrinkIntervalSeconds: 5 * MIN, shrinkDurationSeconds: MIN, finalRadius: 60, finalHoldSeconds: 5 * MIN, pingIntervalSeconds: 3 * MIN } },
  { id: "long", timing: { hideSeconds: 10 * MIN, shrinkCount: 6, shrinkIntervalSeconds: 8 * MIN, shrinkDurationSeconds: 2 * MIN, finalRadius: 100, finalHoldSeconds: 10 * MIN, pingIntervalSeconds: 5 * MIN } },
];

type NumKey = { [K in keyof GameConfig]: GameConfig[K] extends number ? K : never }[keyof GameConfig];
/** Option labels: plain text, or a message key with params so they follow the language. */
type Label = string | [Key, Record<string, number>?];
const mins = (n: number): Label => `${n} min`;
const ADVANCED: { key: NumKey; hint?: Key; values: [number, Label][] }[] = [
  { key: "hideSeconds", values: [[MIN, mins(1)], [3 * MIN, mins(3)], [5 * MIN, mins(5)], [10 * MIN, mins(10)], [15 * MIN, mins(15)]] },
  { key: "shrinkCount", values: [[3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]] },
  { key: "shrinkIntervalSeconds", values: [[2 * MIN, mins(2)], [3 * MIN, mins(3)], [5 * MIN, mins(5)], [8 * MIN, mins(8)], [10 * MIN, mins(10)]] },
  { key: "shrinkDurationSeconds", values: [[0, ["opt.instant"]], [30, "30 s"], [MIN, mins(1)], [2 * MIN, mins(2)]] },
  { key: "finalRadius", values: [[10, "10 m"], [20, "20 m"], [30, "30 m"], [40, "40 m"], [60, "60 m"], [100, "100 m"], [200, "200 m"]] },
  { key: "finalHoldSeconds", values: [[0, ["opt.none"]], [3 * MIN, mins(3)], [5 * MIN, mins(5)], [10 * MIN, mins(10)]] },
  { key: "outOfZoneGraceSeconds", hint: "set.outOfZoneGraceSeconds.hint", values: [[15, "15 s"], [30, "30 s"], [45, "45 s"], [90, "90 s"]] },
  { key: "pingIntervalSeconds", hint: "set.pingIntervalSeconds.hint", values: [[0, ["opt.off"]], [MIN, ["opt.every", { n: 1 }]], [2 * MIN, ["opt.every", { n: 2 }]], [3 * MIN, ["opt.every", { n: 3 }]], [5 * MIN, ["opt.every", { n: 5 }]]] },
  // 0 = exact: the circle is only the GPS error. Below ~10 m outdoors there is nothing left to gain.
  { key: "pingFuzzMeters", hint: "set.pingFuzzMeters.hint", values: [[0, ["opt.exact"]], [10, "± 10 m"], [25, "± 25 m"], [50, "± 50 m"], [80, "± 80 m"], [150, "± 150 m"], [300, "± 300 m"]] },
];

const fmtKm2 = (r: number) => (Math.PI * r * r) / 1e6;
const fmt = (n: number, digits: number, min = 0) => n.toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: min });
/** m² for a courtyard, hectares for a park, km² for a neighbourhood. */
const fmtArea = (km2: number) => (km2 < 0.01 ? `${fmt(km2 * 1e6, 0)} m²` : km2 < 1 ? `${fmt(km2 * 100, 1)} ha` : `${fmt(km2, 2, 2)} km²`);

// The slider is logarithmic: a step near 30 m matters as much as one near 3 km.
const SLIDER_MAX = 5000;
const toSlider = (r: number) => (1000 * Math.log(Math.min(SLIDER_MAX, Math.max(MIN_ZONE_RADIUS, r)) / MIN_ZONE_RADIUS)) / Math.log(SLIDER_MAX / MIN_ZONE_RADIUS);
const fromSlider = (s: number) => {
  const r = MIN_ZONE_RADIUS * Math.pow(SLIDER_MAX / MIN_ZONE_RADIUS, s / 1000);
  const step = r < 100 ? 5 : r < 1000 ? 10 : 50;
  return Math.round(r / step) * step;
};
const QUICK_RADII = [50, 100, 250, 500, 1000];

/** Exact metres, a quick pick, or the slider: all three edit the same radius. */
function RadiusControl({ value, onPreview, onCommit }: { value: number; onPreview: (r: number) => void; onCommit: (r: number) => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(Math.round(value));
  const commitText = () => {
    if (text === null) return;
    const r = Math.round(Number(text.replace(",", ".")));
    setText(null);
    if (Number.isFinite(r) && r > 0) onCommit(Math.min(MAX_ZONE_RADIUS, Math.max(MIN_ZONE_RADIUS, r)));
  };
  return (
    <>
      <label className="big-value num radius-input">
        <input
          id="radius-exact"
          inputMode="numeric"
          aria-label={t("lobby.radiusExact")}
          value={shown}
          style={{ width: `${Math.max(2, shown.length) + 0.3}ch` }}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          onFocus={(e) => e.target.select()}
          onBlur={commitText}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <small>{t("lobby.radiusUnit")}</small>
      </label>
      <div className="chips" role="group" aria-label={t("lobby.radiusQuick")}>
        {QUICK_RADII.map((r) => (
          <button key={r} type="button" className="chip" aria-pressed={Math.round(value) === r} onClick={() => onCommit(r)}>
            {r >= 1000 ? `${r / 1000} km` : `${r} m`}
          </button>
        ))}
      </div>
      <input
        id="radius"
        type="range"
        aria-label={t("lobby.radiusSlider")}
        aria-valuetext={t("lobby.radiusValue", { m: Math.round(value) })}
        min={0}
        max={1000}
        step={1}
        value={toSlider(value)}
        onChange={(e) => onPreview(fromSlider(Number(e.target.value)))}
        onPointerUp={(e) => onCommit(fromSlider(Number((e.target as HTMLInputElement).value)))}
        onKeyUp={(e) => onCommit(fromSlider(Number((e.target as HTMLInputElement).value)))}
      />
    </>
  );
}

export function Lobby({ view, send, gps, onLeave }: Props) {
  const t = useT();
  const label = (l: Label) => (typeof l === "string" ? l : t(l[0], l[1]));
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
      if (navigator.share) await navigator.share({ title: "SeekHunt", text: t("lobby.shareText", { code: view.code }), url });
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
      // The host is placing the zone, so show all of it; everyone else just wants to find themselves.
      if (isHost) mapRef.current?.fit({ center: fix, radius: cfg.zone.radius });
      else mapRef.current?.flyTo(fix);
    } catch (e) {
      setLocError(e instanceof Error && e.message.startsWith("gps.") ? e.message : "gps.unavailable");
    } finally {
      setLocating(false);
    }
  };

  // A new room starts with the zone at a placeholder spot. As soon as the host's GPS answers, put the
  // zone where they actually are, unless they have already placed it themselves.
  const autoCentered = useRef(false);
  const fix = gps.fix;
  const zoneUntouched = cfg.zone.center.lat === DEFAULT_CONFIG.zone.center.lat && cfg.zone.center.lng === DEFAULT_CONFIG.zone.center.lng;
  useEffect(() => {
    if (!isHost || !fix || !zoneUntouched || autoCentered.current || SIM_MODE) return;
    autoCentered.current = true;
    send({ t: "config", config: { zone: { center: { lat: fix.lat, lng: fix.lng }, radius: cfg.zone.radius } } });
    mapRef.current?.fit({ center: fix, radius: cfg.zone.radius });
  }, [isHost, fix, zoneUntouched, cfg.zone.radius, send]);

  // Far from the play area: say so, instead of leaving the player looking at an empty map.
  const kmAway = fix ? (distance(fix, cfg.zone.center) - cfg.zone.radius) / 1000 : 0;

  const mapPlayers: MapPlayer[] = view.players
    .filter((p) => p.loc && p.id !== view.me.id)
    .map((p) => ({ id: p.id, name: p.name, pos: p.loc!, kind: p.role }));
  if (gps.fix) mapPlayers.push({ id: view.me.id, name: t("common.you"), pos: gps.fix, kind: "me" });

  const gpsProblem = locError ?? gps.error;

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
          <button className="icon-btn" onClick={onLeave} aria-label={t("lobby.leave")}>
            <ChevronLeft size={22} />
          </button>
          <button className="room-chip" onClick={share} aria-label={t("lobby.share", { code: view.code })}>
            <span className="num" translate="no">
              {view.code}
            </span>
            <span className="chip-icon">{copied ? <Check size={18} /> : <Share2 size={18} />}</span>
          </button>
        </div>
        {isHost && (
          <div className="map-hint">
            <span className="pill">{t("lobby.tapHint")}</span>
          </div>
        )}
        <div className="map-fab">
          <button className="icon-btn" onClick={locate} aria-label={isHost ? t("lobby.centerOnMe") : t("lobby.showMe")} disabled={locating}>
            {locating ? <span className="spinner" /> : <LocateFixed size={20} />}
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="grabber" />
        <header className="panel-head row spread">
          <h1 className="display">{isHost ? t("lobby.titleHost") : t("lobby.titleGuest")}</h1>
          <LangToggle />
        </header>

        {gpsProblem && (
          <div style={{ paddingBottom: 16 }}>
            <Notice tone="warn">{t.msg({ key: gpsProblem })}</Notice>
          </div>
        )}
        {!gpsProblem && kmAway > 1 && !(isHost && zoneUntouched) && (
          <div style={{ paddingBottom: 16 }}>
            <Notice
              tone="warn"
              action={
                isHost ? (
                  <button className="notice-action" onClick={locate}>
                    {t("lobby.moveHere")}
                  </button>
                ) : (
                  <button className="notice-action" onClick={() => fix && mapRef.current?.flyTo(fix)}>
                    {t("common.view")}
                  </button>
                )
              }
            >
              {t("lobby.farAway", { km: fmt(kmAway, 0) })}
            </Notice>
          </div>
        )}

        <div className="block">
          <div className="block-head">
            <h2>{t("lobby.zone")}</h2>
            <span className="faint small num">{fmtArea(area)}</span>
          </div>
          {isHost ? (
            <RadiusControl value={shownRadius} onPreview={setRadius} onCommit={(r) => (setRadius(null), setConfig({ zone: { center: cfg.zone.center, radius: r } }))} />
          ) : (
            <div className="big-value num">
              {Math.round(shownRadius)}
              <small>{t("lobby.radiusUnit")}</small>
            </div>
          )}
        </div>

        <div className="block">
          <div className="block-head">
            <h2>{t("lobby.players")}</h2>
            <span className="faint small">{t("lobby.counts", { s: seekers, h: hiders })}</span>
          </div>
          <ul className="players">
            {view.players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "offline"}>
                <span className={`avatar ${p.role}`}>{initials(p.name)}</span>
                <span className="who">
                  <b>
                    {p.name}
                    {p.id === view.me.id && <span className="faint">{t("lobby.youSuffix")}</span>}
                  </b>
                  <span>
                    <i className="dot-online" />
                    {p.id === view.hostId ? t("lobby.host") : p.connected ? t("lobby.online") : t("lobby.offline")}
                  </span>
                </span>
                {isHost ? (
                  <>
                    <Segmented<Role>
                      small
                      label={t("lobby.roleOf", { name: p.name })}
                      value={p.role}
                      onChange={(role) => send({ t: "setRole", playerId: p.id, role })}
                      options={[
                        { value: "seeker", label: t("role.seekShort") },
                        { value: "hider", label: t("role.hideShort") },
                      ]}
                    />
                    {p.id !== view.me.id && (
                      <button className="icon-btn plain" aria-label={t("lobby.kick", { name: p.name })} onClick={() => send({ t: "kick", playerId: p.id })}>
                        <X size={18} />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="badge">{p.role === "seeker" ? t("role.seekShort") : t("role.hideShort")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="block">
          <div className="block-head">
            <h2>{t("lobby.pace")}</h2>
            <span className="faint small num">{Math.round(gamePlan(cfg).end / 60)}&nbsp;min</span>
          </div>
          {isHost && (
            <Segmented
              label={t("lobby.paceLabel")}
              value={preset}
              onChange={(id) => setConfig(PRESETS.find((p) => p.id === id)!.timing)}
              options={PRESETS.map((p) => ({ value: p.id, label: t(`preset.${p.id}`) }))}
            />
          )}
          <ZoneSchedule config={{ ...cfg, zone: { ...cfg.zone, radius: shownRadius } }} />
        </div>

        <div className="block">
          <button className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            {t("lobby.rules")}
            <ChevronDown size={20} />
          </button>
          {advanced && (
            <ul className="settings">
              <li>
                <label htmlFor="opt-last">
                  {t("rule.lastSurvivor")}
                  <span className="hint">{t("rule.lastSurvivorHint")}</span>
                </label>
                <Switch id="opt-last" disabled={!isHost} checked={cfg.lastSurvivorWins} onChange={(v) => setConfig({ lastSurvivorWins: v })} />
              </li>
              <li>
                <label htmlFor="opt-infect">
                  {t("rule.infection")}
                  <span className="hint">{t("rule.infectionHint")}</span>
                </label>
                <Switch id="opt-infect" disabled={!isHost} checked={cfg.caughtBecomeSeekers} onChange={(v) => setConfig({ caughtBecomeSeekers: v })} />
              </li>
              <li>
                <label htmlFor="opt-building">
                  {t("rule.building")}
                  <span className="hint">{t("rule.buildingHint")}</span>
                </label>
                <Switch id="opt-building" disabled={!isHost} checked={!!cfg.buildingMode} onChange={(v) => setConfig({ buildingMode: v })} />
              </li>
              {ADVANCED.map((o) => (
                <li key={o.key}>
                  <label htmlFor={`opt-${o.key}`}>
                    {t(`set.${o.key}` as Key)}
                    {o.key === "finalRadius" && effectiveFinalRadius(cfg) < cfg.finalRadius ? (
                      <span className="hint">{t("set.finalAdjusted", { m: Math.round(effectiveFinalRadius(cfg)) })}</span>
                    ) : (
                      o.hint && <span className="hint">{t(o.hint)}</span>
                    )}
                  </label>
                  <select id={`opt-${o.key}`} disabled={!isHost} value={cfg[o.key]} onChange={(e) => setConfig({ [o.key]: Number(e.target.value) })}>
                    {!o.values.some(([v]) => v === cfg[o.key]) && <option value={cfg[o.key]}>{cfg[o.key]}</option>}
                    {o.values.map(([v, l]) => (
                      <option key={v} value={v}>
                        {label(l)}
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
            <span>{hiders === 0 ? t("lobby.needHider") : seekers === 0 ? t("lobby.needSeeker") : t("lobby.start")}</span>
            <span className="num">{t("lobby.playerCount", { n: view.players.length })}</span>
          </button>
        ) : (
          <div className="waiting">
            <span className="spinner" /> {t("lobby.waiting")}
          </div>
        )}
      </footer>
    </main>
  );
}
