import { chromium } from "playwright";
import path from "node:path";
const [preset = "cage", steps = "1200"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim && document.getElementById("busy").hidden, null, { timeout: 120000 });
const out = await page.evaluate(async ([preset, steps]) => {
  const s = window.eggsim; s.setPaused(true);
  const sel = document.getElementById("preset"); sel.value = preset; sel.dispatchEvent(new Event("change"));
  await new Promise((r) => { const t = setInterval(() => { if (document.getElementById("busy").hidden) { clearInterval(t); r(); } }, 100); });
  const w = s.world; let spawned0 = w.nextId;
  const log = [];
  for (let i = 0; i < Number(steps); i++) { w.step(1 / 120); }
  return { Lcm: w.Lcm, eggs: w.eggs.length, ids: w.nextId - spawned0, counted: w.counted, sample: w.eggs.slice(0, 6).map((e) => [e.p.x.toFixed(1), e.p.y.toFixed(2), e.p.z.toFixed(1), e.lv.z.toFixed(1)]) };
}, [preset, steps]);
console.log(JSON.stringify(out));
await browser.close();
