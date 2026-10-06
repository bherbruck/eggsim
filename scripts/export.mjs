// Renders a labeled dataset from the simulator in headless Chromium.
//
//   npm run build && node scripts/export.mjs --frames 500 --preset jam --format seg --out data/jam
//
// Options
//   --frames N         total frames (default 200)
//   --interval S       simulated seconds between saved frames (default 0.5)
//   --sequences K      independent sessions with different seeds, split evenly (default 2; the last one is val)
//   --preset NAME      cross | cage | packer | jam | tracker | rough | rod | perf
//   --settings FILE    JSON from "Copy settings JSON" in the page (applied on top of the preset)
//   --profiles A,B,..  several settings JSON files; sequences cycle through them
//   --randomize [FILE] draw settings per sequence and per frame: built-in ranges, or a spec file
//                      (see scripts/lib/randomize.mjs; add "extend": true to merge with the defaults)
//   --seed N           base seed for sequences and randomization (default 1)
//   --workers N        render N sequences at once (default 1; try your CPU core count)
//   --jpg              save JPEG images instead of PNG (about 5x smaller)
//   --set k=v,...      extra overrides, e.g. --set eggClasses=split,labelMinVisible=0.3,res=1920x1080
//   --format F         detect | obb | seg (YOLO txt layout; default seg)
//   --masks            also write instance masks (red + 256 × green = instance_id)
//   --gpu              ask Chromium for the real GPU instead of software rendering
//   --out DIR          output folder (default data/<timestamp>)
//
// Writes  images/{train,val}/*.png, labels/{train,val}/*.txt, data.yaml, sessions.json,
//         json/<seq>/<frame>.json (all shapes, track_id, instance_id, visible_fraction, egg metadata),
//         mot/<seq>/gt/gt.txt (MOTChallenge tracks; last column is visible fraction), masks/ with --masks
import fs from "node:fs";
import path from "node:path";
import { launch, exportDataset } from "./lib/sim.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes("--" + k);
const settings = opt("settings") ? JSON.parse(fs.readFileSync(opt("settings"), "utf8")) : {};
for (const kv of (opt("set", "") || "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=");
  settings[k] = v === "true" ? true : v === "false" ? false : isNaN(Number(v)) ? v : Number(v);
}

const profiles = (opt("profiles", "") || "").split(",").filter(Boolean).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
let randomize = null;
if (flag("randomize")) {
  const v = opt("randomize");
  randomize = v && !v.startsWith("--") && fs.existsSync(v) ? JSON.parse(fs.readFileSync(v, "utf8")) : true;
}
const sim = await launch({ gpu: flag("gpu") });
console.log("page:", sim.url);
const t0 = Date.now();
const res = await exportDataset(sim, {
  preset: opt("preset") || undefined, settings,
  frames: Number(opt("frames", 200)), interval: Number(opt("interval", 0.5)), sequences: Number(opt("sequences", 2)),
  format: opt("format", "seg"), mask: flag("masks"), profiles, randomize,
  seed: Number(opt("seed", 1)), workers: Number(opt("workers", 1)), imageFormat: flag("jpg") ? "jpg" : "png",
  out: path.resolve(opt("out", "data/" + new Date().toISOString().replace(/[:.]/g, "-"))),
  onProgress: (i, n) => {
    if (i % 5 && i !== n) return;
    const rate = i / ((Date.now() - t0) / 1000);
    process.stdout.write(`\r${i}/${n} frames  ${rate.toFixed(2)} fps  ~${Math.round((n - i) / rate)} s left   `);
  },
});
console.log(`\nWrote ${res.frames} frames in ${res.sequences} sequences (${res.val_sequences} val) to ${res.out} in ${((Date.now() - t0) / 1000).toFixed(0)} s\nclasses: ${res.classes.join(", ")}`);
await sim.close();
