// Accessibility audit (axe-core) of every screen, against a running `npm run dev`.
// Usage: node scripts/a11y.mjs   (uses the locally installed Microsoft Edge)
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright-core";

const URL = process.env.URL ?? "http://localhost:5173/?sim";
const browser = await chromium.launch({ channel: process.env.BROWSER ?? "msedge" });
const newPage = async (scheme = "light") => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  // The selectors below use the Spanish labels, so pin the language.
  await ctx.addInitScript((l) => (localStorage.setItem("seekhunt:consent:v1", "yes"), localStorage.setItem("seekhunt:lang", l)), "es");
  return ctx.newPage();
};

let failures = 0;
async function audit(page, name) {
  // The map canvas and its third-party attribution are excluded: not our markup.
  const { violations } = await new AxeBuilder({ page }).exclude(".maplibregl-canvas-container").exclude(".maplibregl-ctrl").analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  failures += serious.length;
  console.log(`\n${name}: ${violations.length} violations (${serious.length} serious/critical)`);
  for (const v of violations) console.log(`  [${v.impact}] ${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const scheme of ["light", "dark"]) {
  const host = await newPage(scheme);
  await host.goto(URL);
  await host.waitForTimeout(800);
  await audit(host, `[${scheme}] Home`);
  await host.fill("#name", "Nouh");
  await host.click("text=Crear partida");
  await host.waitForSelector(".room-chip");
  const code = (await host.textContent(".room-chip .num")).trim();
  const guest = await newPage(scheme);
  await guest.goto(URL);
  await guest.fill("#name", "Ana");
  await guest.fill('input[aria-label="Código de sala"]', code);
  await guest.click('button[aria-label="Unirse"]');
  await guest.waitForSelector(".room-chip");
  await host.waitForTimeout(1500);
  await host.click("text=Reglas");
  await audit(host, `[${scheme}] Lobby (host)`);
  await audit(guest, `[${scheme}] Lobby (guest)`);
  await host.click("text=Empezar partida");
  await host.waitForSelector(".hud");
  await guest.waitForSelector(".hud");
  await host.waitForTimeout(1500);
  await audit(host, `[${scheme}] Play (seeker)`);
  await audit(guest, `[${scheme}] Play (hider)`);
  await host.context().close();
  await guest.context().close();
}
await browser.close();
console.log(failures ? `\n${failures} serious/critical issues` : "\nNo serious or critical issues");
process.exit(failures ? 1 : 0);
