// Renders the link-preview image (apps/web/public/og.png) and the GitHub social preview
// (docs/assets/social-preview.png) from apps/web/tools/og.html. Needs `npm run dev` running.
import { chromium } from "playwright-core";

const base = process.env.URL ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: process.env.BROWSER ?? "msedge" });
for (const [w, h, out] of [
  [1200, 630, "apps/web/public/og.png"],
  [1280, 640, "docs/assets/social-preview.png"],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/tools/og.html?w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.locator("#card").screenshot({ path: out });
  console.log(out);
  await page.close();
}
await browser.close();
