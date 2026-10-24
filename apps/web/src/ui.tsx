import { AlertTriangle, Bell, CircleDot, Crosshair, Flag, LifeBuoy, Radar, UserPlus } from "lucide-react";
import { effectiveFinalRadius, type GameConfig } from "@seekhunt/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Lang, locale, setLang, useT } from "./i18n";
import type { Toast } from "./net";

/** Server-synchronised clock that re-renders every `ms`. */
export function useNow(offset: number, ms = 500) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(t);
  }, [offset, ms]);
  return now;
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** A game length for people: "47 min", "1 h 05 min", or seconds for very short rounds. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const m = Math.round(total / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const TOAST_ICON = { info: UserPlus, zone: CircleDot, ping: Radar, catch: Crosshair, elim: AlertTriangle, warn: Bell, end: Flag, sos: LifeBuoy };

export function Toasts({ toasts }: { toasts: Toast[] }) {
  const t = useT();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.kind];
        return (
          <div key={toast.id} className={`toast ${toast.kind === "info" ? "" : "blaze"}`}>
            <Icon size={18} strokeWidth={2.25} />
            {t.msg(toast.msg)}
          </div>
        );
      })}
    </div>
  );
}

export function Notice({ tone = "neutral", icon, children, action }: { tone?: "neutral" | "danger" | "warn"; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {icon}
      <div>{children}</div>
      {action}
    </div>
  );
}

/** One real input under N visual cells: keeps native keyboards, paste and one-time-code autofill working. */
export function CodeInput({ length, value, onChange, numeric, label, autoFocus }: { length: number; value: string; onChange: (v: string) => void; numeric?: boolean; label: string; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  const clean = (v: string) => (numeric ? v.replace(/\D/g, "") : v.toUpperCase().replace(/[^A-Z0-9]/g, "")).slice(0, length);
  return (
    <div className={`code${focused ? " focused" : ""}`} translate="no">
      {Array.from({ length }, (_, i) => (
        <div key={i} className={`code-cell num${value[i] ? " filled" : ""}${i === Math.min(value.length, length - 1) ? " active" : ""}`} aria-hidden>
          {value[i] ?? ""}
        </div>
      ))}
      <input
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        inputMode={numeric ? "numeric" : "text"}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(clean(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, small, label, disabled }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; small?: boolean; label: string; disabled?: boolean }) {
  return (
    <div className={`seg${small ? " sm" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** In-app confirmation sheet; native confirm() looks out of place and is blocked in some webviews. */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!request) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);
  if (!request) return null;
  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="dlg-title">{request.title}</h3>
        <p className="muted">{request.body}</p>
        <div className="actions">
          <button
            ref={ref}
            className={`btn btn-block ${request.danger ? "btn-danger" : ""}`}
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
          >
            {request.confirm}
          </button>
          <button className="btn btn-soft btn-block" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  const t = useT();
  return (
    <div className="conn" style={{ top: "50%", bottom: "auto" }}>
      <span className="pill">
        <span className="spinner" /> {t("app.loading")}
      </span>
    </div>
  );
}

/** When each zone starts (seconds from the game start), its radius, and when the game ends. */
export function gamePlan(config: GameConfig) {
  const r0 = config.zone.radius;
  const rf = effectiveFinalRadius(config);
  const n = config.shrinkCount;
  const zones = Array.from({ length: n + 1 }, (_, k) => ({
    at: config.hideSeconds + k * config.shrinkIntervalSeconds,
    radius: n === 0 ? r0 : r0 * Math.pow(rf / r0, k / n),
  }));
  const end = config.hideSeconds + n * config.shrinkIntervalSeconds + (n > 0 ? config.shrinkDurationSeconds : 0) + config.finalHoldSeconds;
  return { zones, end: Math.max(end, 1) };
}

const minutes = (s: number) => `${Math.round(s / 60)}′`;
const meters = (m: number) => `${m >= 1000 ? (m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) + " km" : Math.round(m) + " m"}`;

/**
 * The pace of a game drawn as what actually happens: a line through time with one circle per zone,
 * each sized by its real radius and marked with the minute it begins.
 */
export function ZoneSchedule({ config }: { config: GameConfig }) {
  const t = useT();
  const { zones, end } = gamePlan(config);
  const r0 = config.zone.radius;
  const x = (t: number) => `${(t / end) * 100}%`;
  // Minute labels only where there is room for them; the first and last are always shown.
  const roomy = zones.length < 2 || config.shrinkIntervalSeconds / end > 0.085;
  return (
    <div className="sched" role="img" aria-label={t("sched.aria", { hide: minutes(config.hideSeconds), n: config.shrinkCount, every: minutes(config.shrinkIntervalSeconds), from: meters(r0), to: meters(zones.at(-1)!.radius) })}>
      <div className="sched-plot">
        <span className="sched-line hide" style={{ left: 0, width: x(config.hideSeconds) }} />
        <span className="sched-line" style={{ left: x(config.hideSeconds), right: 0 }} />
        {zones.map((z, i) => {
          const d = 7 + 21 * Math.sqrt(z.radius / r0);
          return <i key={i} className={i === zones.length - 1 ? "last" : undefined} style={{ left: x(z.at), width: d, height: d }} />;
        })}
        <b className="sched-end" style={{ left: "100%" }} />
      </div>
      <div className="sched-ticks num">
        {config.hideSeconds > 0 && <span style={{ left: 0 }}>0′</span>}
        {zones.map((z, i) => (roomy || i === 0 || i === zones.length - 1 ? <span key={i} style={{ left: x(z.at) }}>{minutes(z.at)}</span> : null))}
        <span style={{ left: "100%" }}>{minutes(end)}</span>
      </div>
      <div className="sched-legend">
        <span>{config.hideSeconds > 0 ? t("sched.hide", { m: Math.round(config.hideSeconds / 60) }) : t("sched.noHide")}</span>
        <span className="num">
          {meters(r0)} → {meters(zones.at(-1)!.radius)}
        </span>
      </div>
    </div>
  );
}

/** In-game: a thin progress track with a dot per shrink; passed dots fill in. */
export function GameProgress({ config, elapsed }: { config: GameConfig; elapsed: number }) {
  const { zones, end } = gamePlan(config);
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / end) * 100))}%`;
  return (
    <div className="progress" aria-hidden>
      <span className="progress-fill" style={{ width: pct(elapsed) }} />
      {zones.slice(1).map((z, i) => (
        <i key={i} className={elapsed >= z.at ? "passed" : undefined} style={{ left: pct(z.at) }} />
      ))}
    </div>
  );
}

/** ES / EN switch. The choice is per device and remembered. */
export function LangToggle() {
  const t = useT();
  const options: { value: Lang; label: string }[] = [
    { value: "es", label: "ES" },
    { value: "en", label: "EN" },
  ];
  return (
    <div className="lang" role="group" aria-label={t("lang.label")}>
      {options.map((o) => (
        <button key={o.value} type="button" lang={o.value} aria-pressed={t.lang === o.value} onClick={() => setLang(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      {/* The play area, and the last zone left inside it. */}
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="19.5" cy="12.5" r="5" fill="var(--blaze)" />
    </svg>
  );
}
