import { useEffect, useState } from "react";
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

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Banner({ tone, children }: { tone: "danger" | "warn" | "info"; children: React.ReactNode }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}
