// Drives the simulator in headless Chromium. Shared by the export CLI and the MCP server.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpec, sample, mulberry32 } from "./randomize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIVE = "https://bherbruck.github.io/eggsim/";

/** Local build if there is one, otherwise the published GitHub Pages copy. EGGSIM_URL overrides. */
export function defaultUrl() {
  if (process.env.EGGSIM_URL) return process.env.EGGSIM_URL;
  const local = path.join(ROOT, "dist/index.html");
  return fs.existsSync(local) ? "file://" + local : LIVE;
}

export async function launch({ gpu = !!process.env.EGGSIM_GPU, url = defaultUrl() } = {}) {
  const args = gpu ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=default"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const browser = await chromium.launch({ args });
  return {
    browser, url,
    async session(opts = {}) { return Session.open(browser, url, opts); },
    close: () => browser.close(),
  };
}

const dataUrlToBuffer = (d) => Buffer.from(d.slice(d.indexOf(",") + 1), "base64");

export class Session {
  static async open(browser, url, opts) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.eggsim?.api && window.eggsim.ready(), null, { timeout: 180000 });
    const s = new Session(page, errors);
    s.info = await page.evaluate((o) => window.eggsim.api.startSession(o), opts);
    s.renderer = await page.evaluate(() => {
      const g = window.eggsim.view.renderer.getContext(), x = g.getExtension("WEBGL_debug_renderer_info");
      return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    return s;
  }
  constructor(page, errors) { this.page = page; this.errors = errors; }
  get id() { return this.info.session_id; }
  presets() { return this.page.evaluate(() => window.eggsim.api.presets()); }
  schema() { return this.page.evaluate(() => window.eggsim.api.schema()); }
  settings() { return this.page.evaluate(() => window.eggsim.api.settings()); }
  set(vals) { return this.page.evaluate((v) => window.eggsim.api.set(v), vals); }
  async restart(opts) { this.info = await this.page.evaluate((o) => window.eggsim.api.startSession(o), opts); return this.info; }
  step(seconds) { return this.page.evaluate((t) => window.eggsim.api.step(t), seconds); }
  /** capture() from the page, with image and mask decoded to PNG Buffers. */
  async capture(opts = {}) {
    const f = await this.page.evaluate((o) => window.eggsim.api.capture(o), opts);
    if (f.image) f.image = dataUrlToBuffer(f.image);
    if (f.instance_mask) f.instance_mask = dataUrlToBuffer(f.instance_mask);
    return f;
  }
  close() { return this.page.close(); }
}

// ---------------- dataset writers ----------------
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(6));
export function write(f, data) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }

/** YOLO label lines for one frame: detect (bbox), obb (4 corners) or seg (largest visible polygon). */
export function yoloLines(frame, format) {
  const { width: W, height: H } = frame, lines = [];
  for (const o of frame.objects) {
    if (format === "detect") {
      const [x, y, w, h] = o.bbox_xywh;
      lines.push([o.class_id, (x + w / 2) / W, (y + h / 2) / H, w / W, h / H].map(fmt).join(" "));
    } else if (format === "obb") {
      // corners of a box around an edge-truncated egg can poke past the frame; YOLO loaders want 0..1
      const c01 = (v) => Math.min(1, Math.max(0, v));
      lines.push([o.class_id, ...o.obb_xy.flatMap(([x, y]) => [c01(x / W), c01(y / H)])].map(fmt).join(" "));
    } else {
      const poly = o.polygons[0];
      if (poly?.length >= 3) lines.push([o.class_id, ...poly.flatMap(([x, y]) => [x / W, y / H])].map(fmt).join(" "));
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/** MOTChallenge gt line per tracked object (dirt patches excluded). */
export function motLines(frame, frameNo) {
  return frame.objects.filter((o) => o.class !== "dirt").map((o) => {
    const [x, y, w, h] = o.bbox_xywh;
    return [frameNo, o.track_id, x, y, w, h, 1, o.class_id + 1, (o.visible_fraction ?? 1).toFixed(3)].join(",");
  });
}

/**
 * Renders a full dataset. Each sequence is its own session (own seed, session_id and, with `randomize`,
 * its own randomly drawn settings). About 15% of sequences become the val split when there is more than one.
 * `workers` sequences render at once in separate pages.
 */
export async function exportDataset(sim, {
  preset, settings = {}, frames = 200, interval = 0.5, sequences = 2, format = "seg", out, mask = false,
  randomize = null, profiles = [], seed = 1, workers = 1, imageFormat = "png", onProgress,
} = {}) {
  if (!["detect", "obb", "seg"].includes(format)) throw new Error("format must be detect, obb or seg");
  if (!["png", "jpg"].includes(imageFormat)) throw new Error("imageFormat must be png or jpg");
  const spec = resolveSpec(randomize);
  sequences = Math.max(1, sequences);
  const per = Math.ceil(frames / sequences);
  const nVal = sequences > 1 ? Math.max(1, Math.round(sequences * 0.15)) : 0;
  const ext = imageFormat === "jpg" ? ".jpg" : ".png";
  let done = 0, classes = [];
  const sessions = new Array(sequences);
  let next = 0;
  const runOne = async (q) => {
    const split = q >= sequences - nVal ? "val" : "train";
    const seq = `seq${String(q + 1).padStart(String(sequences).length + 1, "0")}`;
    const rand = mulberry32(seed * 1000003 + q * 7919);
    // sequences cycle through the given profiles; randomization is drawn on top of the profile
    const pi = profiles.length ? q % profiles.length : null, prof = pi === null ? {} : profiles[pi];
    const drawn = spec ? sample(spec.sequence, rand, { ...settings, ...prof }) : {};
    const count = Math.min(per, frames - q * per);
    if (count <= 0) return;
    const s = await sim.session({ preset, seed: seed * 1000 + q, settings: { ...settings, ...prof, ...drawn, overlay: "off", osd: false, countLine: false, tracks: false } });
    sessions[q] = { seq, session_id: s.id, split, frames: count, profile: pi, randomized: drawn };
    const mot = [];
    for (let f = 0; f < count; f++) {
      if (spec && Object.keys(spec.frame).length) await s.set(sample(spec.frame, rand, s.info.settings));
      await s.step(interval);
      const fr = await s.capture({ image: true, mask, ids: true, imageFormat: imageFormat === "jpg" ? "jpeg" : "png" });
      classes = fr.classes;
      const name = `${seq}_${String(f + 1).padStart(6, "0")}`;
      write(path.join(out, "images", split, name + ext), fr.image);
      write(path.join(out, "labels", split, name + ".txt"), yoloLines(fr, format));
      if (fr.instance_mask) write(path.join(out, "masks", split, name + ".png"), fr.instance_mask);
      delete fr.image; delete fr.instance_mask;
      write(path.join(out, "json", seq, name + ".json"), JSON.stringify(fr));
      mot.push(...motLines(fr, f + 1));
      onProgress?.(++done, frames);
    }
    write(path.join(out, "mot", seq, "gt", "gt.txt"), mot.join("\n") + "\n");
    write(path.join(out, "mot", seq, "seqinfo.ini"), `[Sequence]\nname=${seq}\nframeRate=${Math.round(1 / interval)}\nseqLength=${count}\nimExt=${ext}\nsessionId=${s.id}\n`);
    await s.close();
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, async () => {
    while (next < sequences) await runOne(next++);
  }));
  write(path.join(out, "data.yaml"), `path: ${out}\ntrain: images/train\nval: images/${nVal ? "val" : "train"}\nnames:\n${classes.map((c, i) => `  ${i}: ${c}`).join("\n")}\n`);
  write(path.join(out, "sessions.json"), JSON.stringify({ format, interval, preset, base_settings: settings, profiles, randomize: spec, sessions: sessions.filter(Boolean) }, null, 2));
  return { frames: done, out, classes, sequences: sessions.filter(Boolean).length, val_sequences: nVal };
}
