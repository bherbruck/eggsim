// Usage: node scripts/shot.mjs out.png [preset] [settleSteps] [jsonOverrides]
import { chromium } from "playwright";
import path from "node:path";
const [out = "shot.png", preset = "", steps = "240", over = "{}"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim && document.getElementById("busy").hidden, null, { timeout: 120000 });
await page.evaluate(async ([preset, steps, over]) => {
  const s = window.eggsim;
  s.setPaused(true);
  if (preset) { const sel = document.getElementById("preset"); sel.value = preset; sel.dispatchEvent(new Event("change")); await new Promise((r) => { const t = setInterval(() => { if (document.getElementById("busy").hidden) { clearInterval(t); r(); } }, 100); }); }
  Object.assign(s.S, JSON.parse(over)); s.reconfigure(); s.world.applyMaterialSettings();
  s.step(Number(steps));
}, [preset, steps, over]);
await page.locator("#cv").screenshot({ path: out });
console.log(logs.filter((l) => !l.includes("GPU stall")).slice(0, 15).join("\n"));
await browser.close();
