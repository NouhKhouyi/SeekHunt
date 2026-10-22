// Renders the home hero map (light + dark) from OpenFreeMap with labels removed, as WebP.
// Needs `npm run dev` running. Output: apps/web/public/hero-{light,dark}.webp
import { chromium } from "playwright-core";
import sharp from "sharp";

const base = process.env.URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.BROWSER ?? "msedge", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [variant, style] of [["light", "positron"], ["dark", "dark"]]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1750 } });
  await page.goto(`${base}/tools/hero.html?style=${style}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  const png = await page.locator("#m").screenshot();
  const out = `apps/web/public/hero-${variant}.webp`;
  await sharp(png).webp({ quality: 72, effort: 6 }).toFile(out);
  const { size } = await sharp(out).metadata().then(async () => ({ size: (await import("node:fs")).statSync(out).size }));
  console.log(`${out}: ${Math.round(size / 1024)} KB`);
  await page.close();
}
await browser.close();
