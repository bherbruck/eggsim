import { chromium } from "playwright";
import path from "node:path";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim?.ready(), null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const s = window.eggsim; s.setPaused(true); const { label, ...v } = s.PRESETS.perf; s.applySettings({ ...s.BASE, ...v }); return null;
  const d = s.frameLabels();
  return d.objects.slice(0, 5).map((o) => {
    const area = (p) => Math.abs(p.reduce((a, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return a + x * v - u * y; }, 0) / 2);
    return { id: o.id, bbox: o.bbox, obbArea: area(o.obb).toFixed(0), bboxArea: o.bbox[2] * o.bbox[3], polyN: o.polygons[0].length, polyArea: area(o.polygons[0]).toFixed(0), px: o.area, obb: o.obb };
  });
});
await page.waitForFunction(() => window.eggsim.ready());
const r2 = await page.evaluate(() => {
  const s = window.eggsim; s.setPaused(true); s.advance(1);
  return s.frameLabels().objects.filter((o) => !o.truncated).filter(o => o.id === 28 || o.id === 30).map((o) => {
    // PCA from the outline polygon's area moments
    const P = o.polygons[0]; let A = 0, cx = 0, cy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < P.length; i++) { const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length], c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; sxx += (x0 * x0 + x0 * x1 + x1 * x1) * c; syy += (y0 * y0 + y0 * y1 + y1 * y1) * c; sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c; }
    A /= 2; cx /= 6 * A; cy /= 6 * A; sxx = sxx / 12 - A * cx * cx; syy = syy / 12 - A * cy * cy; sxy = sxy / 24 - A * cx * cy;
    const polyAng = 0.5 * Math.atan2(2 * sxy, sxx - syy) * 180 / Math.PI;
    const [p0, p1] = o.obb; const obbAng = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
    const ux = Math.cos(obbAng * Math.PI / 180), uy = Math.sin(obbAng * Math.PI / 180);
    const ext = (pts) => { let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const [x, y] of pts) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); } return [(a1 - a0).toFixed(1), (b1 - b0).toFixed(1)]; };
    return { polyExt: ext(P), obbExt: ext(o.obb), id: o.id, polyAng: polyAng.toFixed(1), obbAng: obbAng.toFixed(1), c: [cx.toFixed(0), cy.toFixed(0)], obbc: [(o.obb[0][0] + o.obb[2][0]) / 2, (o.obb[0][1] + o.obb[2][1]) / 2].map(v => v.toFixed(0)) };
  });
});
console.log(r2.map(o => JSON.stringify(o)).join("\n"));
await browser.close();
