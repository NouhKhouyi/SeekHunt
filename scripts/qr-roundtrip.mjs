// Checks that a hider's QR, as rendered by the app, is decoded by the app's own scanner pipeline.
// On desktop Edge/Chrome for Windows there is no native BarcodeDetector, so this exercises the
// self-hosted zxing-wasm fallback, the same path iOS Safari takes. Needs `npm run dev` running.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: process.env.BROWSER ?? "msedge" });
const page = await browser.newPage();
await page.goto(process.env.URL ?? "http://localhost:5173/");
const result = await page.evaluate(async () => {
  const { qrSvg, parseQr, createDetector } = await import("/src/Catch.tsx");
  const svg = qrSvg("K7Q2M", "4821");
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 400;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 400, 400);
  ctx.drawImage(img, 0, 0, 400, 400);
  const native = "BarcodeDetector" in globalThis;
  const [hit] = await (await createDetector()).detect(canvas);
  return { native, raw: hit?.rawValue ?? null, parsed: hit ? parseQr(hit.rawValue, "K7Q2M") : null, otherRoom: hit ? parseQr(hit.rawValue, "ZZZZZ") : null };
});
await browser.close();
console.log(result);
const ok = result.parsed?.code === "4821" && "error" in (result.otherRoom ?? {});
console.log(ok ? "QR ROUNDTRIP OK" : "QR ROUNDTRIP FAILED");
process.exit(ok ? 0 : 1);
