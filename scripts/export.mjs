// Renders a labeled dataset from the simulator in headless Chromium.
//
//   npm run build && node scripts/export.mjs --frames 500 --preset jam --format seg --out data/jam
//
// Options
//   --frames N         total frames (default 200)
//   --interval S       simulated seconds between saved frames (default 0.5)
//   --sequences K      independent runs with different seeds, split evenly (default 2; the last one is val)
//   --preset NAME      cross | cage | packer | jam | tracker | rough | perf
//   --settings FILE    JSON from "Copy settings JSON" in the page (applied on top of the preset)
//   --set k=v,...      extra overrides, e.g. --set eggClasses=split,labelDirt=true,res=1920x1080
//   --format F         detect | obb | seg (YOLO txt layout; default seg)
//   --gpu              ask Chromium for the real GPU instead of software rendering
//   --out DIR          output folder (default data/<timestamp>)
//
// Writes  DIR/images/{train,val}/*.png, DIR/labels/{train,val}/*.txt, DIR/data.yaml,
//         DIR/json/<seq>/<frame>.json (every label shape plus egg metadata),
//         DIR/mot/<seq>/gt/gt.txt (MOTChallenge tracks, visible boxes)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes("--" + k);
const frames = Number(opt("frames", 200)), interval = Number(opt("interval", 0.5)), seqs = Math.max(1, Number(opt("sequences", 2)));
const format = opt("format", "seg"), preset = opt("preset", ""), out = path.resolve(opt("out", "data/" + new Date().toISOString().replace(/[:.]/g, "-")));
let overrides = opt("settings") ? JSON.parse(fs.readFileSync(opt("settings"), "utf8")) : {};
for (const kv of (opt("set", "") || "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  overrides[k] = v === "true" ? true : v === "false" ? false : isNaN(Number(v)) ? v : Number(v);
}
if (!["detect", "obb", "seg"].includes(format)) throw new Error("--format must be detect, obb or seg");

const gpuArgs = flag("gpu") ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=default"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ args: gpuArgs });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto("file://" + path.resolve("dist/index.html"));
await page.waitForFunction(() => window.eggsim?.ready(), null, { timeout: 180000 });
const gl = await page.evaluate(() => { const g = window.eggsim.view.renderer.getContext(); const x = g.getExtension("WEBGL_debug_renderer_info"); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown"; });
console.log("renderer:", gl);

const per = Math.ceil(frames / seqs);
let classes = [];
let n = 0;
const t0 = Date.now();
for (let q = 0; q < seqs; q++) {
  const split = seqs > 1 && q === seqs - 1 ? "val" : "train";
  const seq = `seq${String(q + 1).padStart(2, "0")}`;
  const seed = 1000 + q * 7919;
  await page.evaluate(([preset, over, seed]) => {
    const s = window.eggsim;
    const p = preset ? (({ label, ...v }) => ({ ...s.BASE, ...v, preset }))(s.PRESETS[preset]) : { ...s.S };
    s.applySettings({ ...p, ...over, seed, overlay: "off", osd: false, countLine: false, tracks: false });
  }, [preset, overrides, seed]);
  await page.waitForFunction(() => window.eggsim.ready(), null, { timeout: 180000 });
  await page.evaluate(() => window.eggsim.setPaused(true));
  const mot = [];
  for (let f = 0; f < per && n < frames; f++, n++) {
    const d = await page.evaluate((dt) => { window.eggsim.advance(dt); return window.eggsim.frameLabels(true); }, interval);
    classes = d.classes;
    const name = `${seq}_${String(f + 1).padStart(6, "0")}`;
    const W = d.width, H = d.height;
    write(path.join(out, "images", split, name + ".png"), Buffer.from(d.image.split(",")[1], "base64"));
    const lines = [];
    for (const o of d.objects) {
      if (format === "detect") {
        const [x, y, w, h] = o.bbox;
        lines.push([o.class_id, (x + w / 2) / W, (y + h / 2) / H, w / W, h / H].map(fmt).join(" "));
      } else if (format === "obb") {
        lines.push([o.class_id, ...o.obb.flatMap(([x, y]) => [x / W, y / H])].map(fmt).join(" "));
      } else {
        const poly = o.polygons[0];
        if (poly.length >= 3) lines.push([o.class_id, ...poly.flatMap(([x, y]) => [x / W, y / H])].map(fmt).join(" "));
      }
      if (o.class !== "dirt") mot.push([f + 1, o.id, ...o.bbox.map((v) => v.toFixed(1)), 1, o.class_id + 1, 1].join(","));
    }
    write(path.join(out, "labels", split, name + ".txt"), lines.join("\n") + (lines.length ? "\n" : ""));
    delete d.image;
    write(path.join(out, "json", seq, name + ".json"), JSON.stringify(d));
    if (n % 10 === 0) {
      const rate = (n + 1) / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r${n + 1}/${frames} frames  ${rate.toFixed(2)} fps  ~${Math.round((frames - n - 1) / rate)} s left   `);
    }
  }
  write(path.join(out, "mot", seq, "gt", "gt.txt"), mot.join("\n") + "\n");
  write(path.join(out, "mot", seq, "seqinfo.ini"), `[Sequence]\nname=${seq}\nframeRate=${Math.round(1 / interval)}\nseqLength=${per}\n`);
}
write(path.join(out, "data.yaml"), `path: ${out}\ntrain: images/train\nval: images/${seqs > 1 ? "val" : "train"}\nnames:\n${classes.map((c, i) => `  ${i}: ${c}`).join("\n")}\n`);
console.log(`\nWrote ${n} frames (${format}) to ${out}\nclasses: ${classes.join(", ")}`);
await browser.close();

function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(6); }
function write(f, data) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }
