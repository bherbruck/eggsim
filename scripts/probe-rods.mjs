// Checks that eggs nest between rods (centre lower than if resting on a flat surface at rod-top height)
// and that spinning rods turn them.
import { chromium } from "playwright";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim?.ready(), null, { timeout: 120000 });
for (const spin of [false, true]) {
  await page.evaluate((spin) => { const s = window.eggsim; s.setPaused(true); const { label, ...v } = s.PRESETS.rod; s.applySettings({ ...s.BASE, ...v, rodSpin: spin }); }, spin);
  await page.waitForFunction(() => window.eggsim.ready());
  const r = await page.evaluate(() => {
    const w = window.eggsim.world; let sink = 0, spinv = 0, n = 0, lying = 0;
    for (let k = 0; k < 60; k++) { for (let i = 0; i < 4; i++) w.step(1 / 120);
      for (const e of w.eggs) if (e.p.z > 0 && e.p.z < w.Lcm) {
        sink += (w.surfY() + e.b - e.p.y) * 10; spinv += e.av.length(); n++;
      } }
    return { eggs: (n / 60).toFixed(0), nestedDepth_mm: (sink / n).toFixed(1), spin_rad_s: (spinv / n).toFixed(2), expectedDepth_mm: "~5 for a 44 mm wide egg on 10 mm rods at 32 mm" };
  });
  console.log(spin ? "spinning rods" : "fixed rods   ", JSON.stringify(r));
}
await browser.close();
