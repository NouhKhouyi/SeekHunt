import { Keyboard, ScanLine, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { useT } from "./i18n";
import { CodeInput } from "./ui";

/** What a hider's QR encodes. The room code stops a QR from another game being accepted. */
export const qrPayload = (room: string, code: string) => `SEEKHUNT:${room}:${code}`;

export function parseQr(text: string, room: string): { code: string } | { error: string } {
  const m = /^SEEKHUNT:([A-Z2-9]{5}):(\d{4})$/.exec(text.trim());
  // Errors are message keys, translated where they are shown.
  if (!m) return { error: "qr.notOurs" };
  if (m[1] !== room) return { error: "qr.otherGame" };
  return { code: m[2]! };
}

export const qrSvg = (room: string, code: string) => renderSVG(qrPayload(room, code), { border: 2, ecc: "M", whiteColor: "#ffffff", blackColor: "#121417" });

export function CatchQr({ room, code, size = 132 }: { room: string; code: string; size?: number }) {
  const t = useT();
  const svg = useMemo(() => qrSvg(room, code), [room, code]);
  return <div className="qr" style={{ width: size, height: size }} role="img" aria-label={t("qr.aria", { code })} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Full-screen QR so the seeker can scan it from arm's length, even in sunlight. */
export function QrFullscreen({ room, code, onClose }: { room: string; code: string; onClose: () => void }) {
  const t = useT();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="qr-full" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("qr.fullAria")}>
      <CatchQr room={room} code={code} size={Math.min(window.innerWidth - 48, 420)} />
      <div className="capture-code num" translate="no">{code}</div>
      <p>{t("qr.fullHint")}</p>
      <button ref={close} className="btn btn-sm" onClick={onClose}>
        {t("common.close")}
      </button>
    </div>
  );
}

type ScanState = "starting" | "scanning" | "denied" | "nocamera";

interface Detector {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<{ rawValue: string }[]>;
}

/**
 * The native BarcodeDetector exists on Android Chrome but not on iOS Safari. There we fall back to
 * the zxing-wasm ponyfill, self-hosting its WASM so scanning doesn't depend on a third-party CDN.
 * Everything here loads on demand, only when a seeker opens the scanner.
 */
export async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats()).includes("qr_code")) return new Native({ formats: ["qr_code"] });
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: ["qr_code"] });
}

/** Camera scanner: rear camera, ~8 detections per second, stops at the first valid SeekHunt QR. */
export function Scanner({ room, onCode, onClose }: { room: string; onCode: (code: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [hint, setHint] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const done = useRef(false);

  useEffect(() => {
    if (typing) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setState("nocamera");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        return setState(e instanceof DOMException && e.name === "NotFoundError" ? "nocamera" : "denied");
      }
      if (cancelled || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setState("scanning");
      const detector = await createDetector();
      const loop = async () => {
        if (cancelled || done.current || !video.current) return;
        if (video.current.readyState >= 2) {
          try {
            const [hit] = await detector.detect(video.current);
            if (hit) {
              const parsed = parseQr(hit.rawValue, room);
              if ("error" in parsed) setHint(parsed.error);
              else {
                done.current = true;
                navigator.vibrate?.(60);
                return onCode(parsed.code);
              }
            }
          } catch {
            // A frame that can't be decoded; keep going.
          }
        }
        timer = setTimeout(loop, 120);
      };
      loop();
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [room, onCode, typing]);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t("scan.aria")}>
      <header className="scanner-top">
        <span className="label">{t("scan.title")}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
          <X size={20} />
        </button>
      </header>

      {typing ? (
        <form
          className="scanner-type"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.length === 4) onCode(typed);
          }}
        >
          <h2 className="display">{t("scan.typeTitle")}</h2>
          <p className="muted">{t("scan.typeBody")}</p>
          <CodeInput length={4} numeric value={typed} onChange={setTyped} label={t("scan.codeLabel")} autoFocus />
          <button className="btn btn-blaze btn-block" disabled={typed.length !== 4}>
            {t("scan.catch")}
          </button>
          <button type="button" className="btn btn-text" onClick={() => setTyping(false)}>
            <ScanLine size={18} /> {t("scan.back")}
          </button>
        </form>
      ) : (
        <>
          <div className="scanner-view">
            <video ref={video} playsInline muted />
            <div className="scanner-frame" aria-hidden />
          </div>
          <div className="scanner-foot">
            <p>
              {state === "starting" && t("scan.starting")}
              {state === "scanning" && (hint ? t.msg({ key: hint }) : t("scan.point"))}
              {state === "denied" && t("scan.denied")}
              {state === "nocamera" && t("scan.nocamera")}
            </p>
            <button className="btn btn-soft btn-block" onClick={() => setTyping(true)}>
              <Keyboard size={18} /> {t("scan.type")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
