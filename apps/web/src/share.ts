import { buildSchedule, type Circle, type GameView } from "@seekhunt/shared";
import { translate, translateMsg } from "./i18n";
import { fmtDuration, initials } from "./ui";

/**
 * The end-of-game card: the real zones of this game drawn from largest to last, where everybody
 * finished, who won and how long it took. 1080×1350 is what feeds and chats crop least.
 */
const W = 1080;
const H = 1350;
const BLAZE = "#ff6a2c";
const INK = "#f1f2f4";
const INK_2 = "#a9aeb7";
const INK_3 = "#6c727c";
const BG = "#0c0d0f";
const FONT = "'Archivo Variable', 'Archivo', system-ui, sans-serif";

type Ctx = CanvasRenderingContext2D & { fontStretch?: string };

function setFont(g: Ctx, weight: number, size: number, condensed = false) {
  g.font = `${weight} ${size}px ${FONT}`;
  // Condensed Archivo is the game's voice for headlines and numbers, where canvas supports widths.
  if ("fontStretch" in g) g.fontStretch = condensed ? "condensed" : "normal";
}

/** Fits a headline to `max` width by stepping the size down. */
function fitText(g: Ctx, text: string, weight: number, size: number, max: number) {
  let s = size;
  do {
    setFont(g, weight, s, true);
    if (g.measureText(text).width <= max) break;
    s -= 4;
  } while (s > 40);
  return s;
}

export async function renderResultCard(view: GameView, lang: "es" | "en"): Promise<Blob> {
  const t = (key: string, params?: Record<string, string | number>) => translate(key, params, lang);
  await Promise.allSettled([document.fonts.load(`800 120px ${FONT}`), document.fonts.load(`600 36px ${FONT}`)]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d") as Ctx;
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);

  // ── The zones, projected around the first circle ──
  const first = view.config.zone;
  const zones: Circle[] = view.seekStartAt !== null ? buildSchedule(view.config, view.seed, view.seekStartAt).map((s) => s.circle) : [first];
  const box = { x: 170, y: 190, size: 740 };
  const scale = box.size / 2 / first.radius;
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  const kmPerDegLat = 111_320;
  const project = (lat: number, lng: number) => ({
    x: cx + (lng - first.center.lng) * kmPerDegLat * Math.cos((first.center.lat * Math.PI) / 180) * scale,
    y: cy - (lat - first.center.lat) * kmPerDegLat * scale,
  });

  // Hazard stripes outside the first zone, like on the map.
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(cx, cy, box.size / 2, 0, Math.PI * 2, true);
  g.clip("evenodd");
  g.strokeStyle = "rgba(255,106,44,0.13)";
  g.lineWidth = 6;
  for (let o = -H; o < W + H; o += 34) {
    g.beginPath();
    g.moveTo(o, H);
    g.lineTo(o + H, 0);
    g.stroke();
  }
  g.restore();
  // The stripes fade out behind the brand and the result, which need a quiet background.
  /** Paints from `from` (opaque background) to `to` (transparent), top to bottom or bottom to top. */
  const fade = (from: number, to: number) => {
    const grad = g.createLinearGradient(0, from, 0, to);
    grad.addColorStop(0, BG);
    grad.addColorStop(1, "rgba(12,13,15,0)");
    g.fillStyle = grad;
    g.fillRect(0, Math.min(from, to), W, Math.abs(to - from));
  };
  g.fillStyle = BG;
  g.fillRect(0, 0, W, 130);
  fade(130, 190);
  fade(H - 320, H - 380);
  g.fillStyle = BG;
  g.fillRect(0, H - 320, W, 320);

  zones.forEach((z, i) => {
    const c = project(z.center.lat, z.center.lng);
    const r = z.radius * scale;
    const last = i === zones.length - 1;
    g.beginPath();
    g.arc(c.x, c.y, Math.max(r, 6), 0, Math.PI * 2);
    if (last && zones.length > 1) {
      g.fillStyle = "rgba(255,106,44,0.22)";
      g.fill();
    }
    g.lineWidth = i === 0 ? 7 : last ? 5 : 2.5;
    g.strokeStyle = i === 0 || last ? BLAZE : "rgba(241,242,244,0.32)";
    g.setLineDash(i === 0 || last ? [] : [14, 12]);
    g.stroke();
    g.setLineDash([]);
  });

  // Where everyone finished (everything is visible once a game ends).
  const winners = new Set(view.winners);
  for (const p of view.players) {
    if (!p.loc) continue;
    const at = project(p.loc.lat, p.loc.lng);
    const inside = Math.hypot(at.x - cx, at.y - cy) < box.size / 2 + 40;
    if (!inside) continue;
    const win = winners.has(p.id);
    const r = win ? 30 : 22;
    g.beginPath();
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
    g.fillStyle = win ? BLAZE : p.role === "seeker" ? "#2a2d33" : INK;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = BG;
    g.stroke();
    setFont(g, 800, win ? 24 : 18);
    g.fillStyle = win ? BG : p.role === "seeker" ? INK : BG;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(p.name), at.x, at.y + 1);
  }
  g.textAlign = "left";
  g.textBaseline = "alphabetic";

  // ── Brand ──
  const logoX = 90;
  const logoY = 96;
  g.beginPath();
  g.arc(logoX + 22, logoY, 20, 0, Math.PI * 2);
  g.lineWidth = 5;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.arc(logoX + 28, logoY - 6, 8, 0, Math.PI * 2);
  g.fillStyle = BLAZE;
  g.fill();
  setFont(g, 800, 40, true);
  g.fillStyle = INK;
  g.fillText("SEEKHUNT", logoX + 58, logoY + 14);
  setFont(g, 500, 26);
  g.fillStyle = INK_3;
  g.textAlign = "right";
  g.fillText(t("card.tagline"), W - 90, logoY + 10);
  g.textAlign = "left";

  // ── Result ──
  const names = view.players.filter((p) => winners.has(p.id)).map((p) => p.name);
  const seekersWon = names.length > 0 && view.players.filter((p) => winners.has(p.id)).every((p) => p.role === "seeker");
  const headline = (seekersWon ? t("card.seekersWin") : names.length ? t("card.winner", { names: names.join(", ") }) : t("card.none")).toUpperCase();
  fitText(g, headline, 800, 132, W - 180);
  g.fillStyle = INK;
  g.fillText(headline, 90, 1218 - 92);
  setFont(g, 500, 30);
  g.fillStyle = INK_2;
  g.fillText(translateMsg(view.winReason, lang), 92, 1218 - 40);

  // ── Numbers ──
  const catches = view.players.filter((p) => p.caughtBy).length;
  const duration = view.startedAt !== null && view.endedAt !== null ? fmtDuration(view.endedAt - view.startedAt) : "–";
  const stats: [string, string][] = [
    [t("results.duration"), duration],
    [t("results.catches"), String(catches)],
    [t("lobby.players"), String(view.players.length)],
  ];
  g.fillStyle = "rgba(241,242,244,0.12)";
  g.fillRect(90, 1218, W - 180, 2);
  stats.forEach(([label, value], i) => {
    const x = 90 + i * ((W - 180) / 3);
    setFont(g, 800, 54, true);
    g.fillStyle = INK;
    g.fillText(value, x, 1290);
    setFont(g, 600, 24);
    g.fillStyle = INK_3;
    g.fillText(label.toUpperCase(), x, 1322);
  });

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

/** Shares the card through the phone's share sheet, or downloads it where sharing files isn't possible. */
export async function shareResult(view: GameView, lang: "es" | "en"): Promise<"shared" | "saved" | "cancelled"> {
  const blob = await renderResultCard(view, lang);
  const file = new File([blob], `seekhunt-${view.code.toLowerCase()}.png`, { type: "image/png" });
  const text = translate("results.shareText", {}, lang);
  const url = location.origin;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${text} ${url}` });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return "saved";
}
