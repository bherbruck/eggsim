// Measures how lively the eggs are: mean speed relative to the belt, spin, and frame-to-frame jitter.
import { chromium } from "playwright";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim?.ready(), null, { timeout: 120000 });
for (const preset of process.argv.slice(2)) {
  await page.evaluate((p) => { const s = window.eggsim; s.setPaused(true); const { label, ...v } = s.PRESETS[p]; s.applySettings({ ...s.BASE, ...v }); }, preset);
  await page.waitForFunction(() => window.eggsim.ready());
  const r = await page.evaluate(() => {
    const s = window.eggsim, w = s.world; s.setPaused(true);
    let rel = 0, spin = 0, lat = 0, n = 0, stacked = 0;
    for (let k = 0; k < 120; k++) {
      for (let i = 0; i < 4; i++) w.step(1 / 120);
      for (const e of w.eggs) if (e.p.z > 0 && e.p.z < w.Lcm) {
        rel += Math.hypot(e.lv.x, e.lv.z - w.vBelt); spin += e.av.length(); lat += Math.abs(e.lv.x); n++;
        if (e.p.y > e.b * 1.5) stacked++;
      }
    }
    return { relSpeed_mm_s: (rel / n * 10).toFixed(0), lateral_mm_s: (lat / n * 10).toFixed(0), spin_rad_s: (spin / n).toFixed(2), stacked_pct: (stacked / n * 100).toFixed(1), eggsInView: (n / 120).toFixed(0) };
  });
  console.log(preset.padEnd(8), JSON.stringify(r));
}
await browser.close();
