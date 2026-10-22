import { AlertTriangle, Bell, CircleDot, Crosshair, Flag, LifeBuoy, Radar, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const TOAST_ICON = { info: UserPlus, zone: CircleDot, ping: Radar, catch: Crosshair, elim: AlertTriangle, warn: Bell, end: Flag, sos: LifeBuoy };

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind];
        return (
          <div key={t.id} className={`toast ${t.kind === "info" ? "" : "blaze"}`}>
            <Icon size={18} strokeWidth={2.25} />
            {t.text}
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
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="conn" style={{ top: "50%", bottom: "auto" }}>
      <span className="pill">
        <span className="spinner" /> Cargando…
      </span>
    </div>
  );
}

/** Whole game at a glance: head start, each shrink (darker as the zone tightens), final hold. */
export function Timeline({ config, elapsed }: { config: { hideSeconds: number; shrinkCount: number; shrinkIntervalSeconds: number; finalHoldSeconds: number }; elapsed?: number }) {
  const segs: { kind: "hide" | "shrink" | "hold"; s: number; k?: number }[] = [
    { kind: "hide" as const, s: config.hideSeconds },
    ...Array.from({ length: config.shrinkCount }, (_, i) => ({ kind: "shrink" as const, s: config.shrinkIntervalSeconds, k: 0.25 + (0.75 * (i + 1)) / config.shrinkCount })),
    { kind: "hold" as const, s: config.finalHoldSeconds },
  ].filter((x) => x.s > 0);
  let acc = 0;
  return (
    <div className="timeline" aria-hidden>
      {segs.map((seg, i) => {
        const start = acc;
        acc += seg.s;
        const done = elapsed === undefined ? 0 : Math.min(1, Math.max(0, (elapsed - start) / seg.s));
        return (
          <i key={i} className={seg.kind} style={{ flex: seg.s, ["--k" as string]: seg.k }}>
            {done > 0 && <span className="done" style={{ width: `${done * 100}%` }} />}
          </i>
        );
      })}
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
