import RAPIER from "@dimforge/rapier3d-compat";
import { DEFAULTS, BASE, PRESETS, CONTROLS, CAMERA_KEYS, OVERLAY_KEYS, Settings, SHADES, classNames } from "./settings";
import { World, MM } from "./world";
import { View } from "./view";

const $ = (s: string) => document.querySelector(s) as HTMLElement;

const S: Settings = { ...DEFAULTS };
try { const saved = JSON.parse(localStorage.getItem("eggbelt3d.settings") || "null"); if (saved) Object.assign(S, saved); } catch {}
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = window.setTimeout(() => { try { localStorage.setItem("eggbelt3d.settings", JSON.stringify(S)); } catch {} }, 300); };

await RAPIER.init();
const world = new World(S);
const view = new View($("#cv") as HTMLCanvasElement, world);

function reconfigure() {
  view.configure(S);
  world.buildStatics();
}

// ---------------- controls ----------------
const inputs: Record<string, { el: HTMLInputElement | HTMLSelectElement; c: (typeof CONTROLS)[number][1] }> = {};
function buildControls() {
  const root = $("#controls"), groups: Record<string, HTMLElement> = {};
  const ps = $("#preset") as HTMLSelectElement;
  fillPresets();
  ps.addEventListener("change", () => {
    const v = ps.value;
    if (v in PRESETS) { const { label, ...vals } = PRESETS[v]; applySettings({ ...BASE, ...vals, preset: v }); }
    else if (v.startsWith("profile:")) { const p = loadProfiles()[v.slice(8)]; if (p) applySettings({ ...p, preset: v }); }
  });
  for (const [grp, c] of CONTROLS) {
    if (!groups[grp]) {
      const d = document.createElement("details"); d.open = grp !== "Simulation";
      d.innerHTML = `<summary>${grp}</summary><div class="rows"></div>`;
      root.appendChild(d); groups[grp] = d.querySelector(".rows")!;
    }
    const row = document.createElement("div"), id = "c-" + c.k;
    row.className = "ctl" + (c.type === "toggle" ? " toggle" : "");
    row.innerHTML = `<label for="${id}">${c.label}</label>` + (c.f || c.type === "range2" ? `<output id="${id}-o"></output>` : "");
    if (c.type === "range2") {
      buildDual(row, c);
      groups[grp].appendChild(row);
      continue;
    }
    let el: HTMLInputElement | HTMLSelectElement;
    if (c.type === "select") {
      el = document.createElement("select");
      for (const [v, t] of c.options!) (el as HTMLSelectElement).add(new Option(t, v));
    } else {
      el = document.createElement("input");
      if (c.type === "toggle") el.type = "checkbox";
      else if (c.type === "number") { el.type = "number"; el.min = "1"; el.step = "1"; }
      else { el.type = "range"; el.min = String(c.min); el.max = String(c.max); el.step = String(c.step); }
    }
    el.id = id;
    row.appendChild(el); groups[grp].appendChild(row);
    inputs[c.k] = { el, c };
    const evt = c.type === "select" || c.type === "toggle" || c.type === "number" ? "change" : "input";
    el.addEventListener(evt, () => {
      const val = c.type === "toggle" ? (el as HTMLInputElement).checked : c.type === "select" ? el.value : Number(el.value);
      (S as any)[c.k] = val;
      if (c.f) $(`#${id}-o`).textContent = c.f(val as number);
      if (!OVERLAY_KEYS.includes(c.k)) markCustom();
      if (CAMERA_KEYS.includes(c.k)) reconfigure();
      else if (c.k === "beltW") world.buildStatics();
      world.applyMaterialSettings();
      if (paused) view.render(S, world.simTime);
      save();
    });
  }
  syncControls();
}
function markCustom() { S.preset = "custom"; ($("#preset") as HTMLSelectElement).value = "custom"; $("#prof-del").hidden = true; }

const SHADE_NAMES: [number, string][] = [[0.1, "white"], [0.3, "cream"], [0.5, "tinted"], [0.7, "brown"], [0.9, "dark brown"], [1.01, "chocolate"]];
const shadeName = (v: number) => SHADE_NAMES.find(([t]) => v < t)![1];
const duals: (() => void)[] = [];
/** Two-handle slider over the shell color scale. */
function buildDual(row: HTMLElement, c: (typeof CONTROLS)[number][1]) {
  const k1 = c.k, k2 = c.k2!;
  const box = document.createElement("div"); box.className = "dual";
  const grad = SHADES.map(([s, h, sa, l]) => `hsl(${h},${sa}%,${l}%) ${s * 100}%`).join(",");
  box.innerHTML = `<div class="track" style="background:linear-gradient(to right,${grad})"></div><div class="sel"></div>`;
  const mk = (id: string, label: string) => {
    const el = document.createElement("input");
    el.type = "range"; el.id = id; el.min = String(c.min); el.max = String(c.max); el.step = String(c.step);
    el.setAttribute("aria-label", label); box.appendChild(el); return el;
  };
  const lo = mk("c-" + k1, "Lightest shell color"), hi = mk("c-" + k2, "Darkest shell color");
  row.querySelector("label")!.setAttribute("for", lo.id);
  row.appendChild(box);
  const out = row.querySelector("output") as HTMLOutputElement;
  const sel = box.querySelector(".sel") as HTMLElement;
  const show = () => {
    const a = Math.min((S as any)[k1], (S as any)[k2]), b = Math.max((S as any)[k1], (S as any)[k2]);
    lo.value = String((S as any)[k1]); hi.value = String((S as any)[k2]);
    sel.style.left = `calc(8px + (100% - 16px) * ${a} - 4px)`; sel.style.width = `calc((100% - 16px) * ${b - a} + 8px)`;
    out.textContent = shadeName(a) === shadeName(b) ? shadeName(a) : `${shadeName(a)} to ${shadeName(b)}`;
  };
  for (const [el, k] of [[lo, k1], [hi, k2]] as const) {
    el.addEventListener("input", () => { (S as any)[k] = Number(el.value); show(); markCustom(); save(); });
  }
  duals.push(show);
}

// ---------------- profiles ----------------
const PROF_KEY = "eggbelt3d.profiles";
function loadProfiles(): Record<string, Partial<Settings>> { try { return JSON.parse(localStorage.getItem(PROF_KEY) || "{}"); } catch { return {}; } }
function storeProfiles(p: Record<string, Partial<Settings>>) { try { localStorage.setItem(PROF_KEY, JSON.stringify(p)); return true; } catch { return false; } }
function fillPresets() {
  const ps = $("#preset") as HTMLSelectElement;
  ps.innerHTML = "";
  const g1 = document.createElement("optgroup"); g1.label = "Presets";
  for (const [k, p] of Object.entries(PRESETS)) g1.appendChild(new Option(p.label, k));
  ps.appendChild(g1);
  const profs = Object.keys(loadProfiles());
  if (profs.length) {
    const g2 = document.createElement("optgroup"); g2.label = "Saved profiles";
    for (const n of profs) g2.appendChild(new Option(n, "profile:" + n));
    ps.appendChild(g2);
  }
  ps.appendChild(new Option("Custom", "custom"));
  ps.value = S.preset;
  if (ps.value !== S.preset) ps.value = "custom";
  $("#prof-del").hidden = !S.preset.startsWith("profile:");
}
function applySettings(vals: Partial<Settings>) {
  Object.assign(S, { ...DEFAULTS, ...vals });
  fillPresets(); syncControls(); view.configure(S); restart(); save();
}
function settingsJSON() { const { preset, ...rest } = S; return rest; }
$("#prof-save").addEventListener("click", () => {
  const inp = $("#prof-name") as HTMLInputElement, name = inp.value.trim();
  if (!name) { toast("Type a profile name first."); inp.focus(); return; }
  const p = loadProfiles(); p[name] = settingsJSON();
  if (!storeProfiles(p)) { toast("This browser is blocking storage. Use Copy settings JSON instead."); return; }
  S.preset = "profile:" + name; inp.value = ""; fillPresets(); save();
  toast(`Saved profile "${name}"`);
});
$("#prof-del").addEventListener("click", () => {
  const name = S.preset.slice(8), p = loadProfiles(); delete p[name]; storeProfiles(p);
  S.preset = "custom"; fillPresets(); save(); toast(`Deleted profile "${name}"`);
});
$("#prof-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(JSON.stringify(settingsJSON(), null, 2)).then(
    () => toast("Settings JSON copied. Pass it to the export script with --settings."),
    () => toast("The clipboard is blocked here. Open the page in its own tab and try again."),
  );
});
$("#prof-paste-open").addEventListener("click", () => { $("#paste").hidden = !$("#paste").hidden; });
$("#prof-load").addEventListener("click", () => {
  try {
    const v = JSON.parse(($("#prof-json") as HTMLTextAreaElement).value);
    applySettings({ ...v, preset: "custom" }); $("#paste").hidden = true; toast("Settings applied");
  } catch { toast("That isn't valid JSON. Paste the whole block copied with Copy settings JSON."); }
});

function syncControls() {
  duals.forEach((f) => f());
  for (const { el, c } of Object.values(inputs)) {
    if (c.type === "toggle") (el as HTMLInputElement).checked = !!(S as any)[c.k];
    else el.value = String((S as any)[c.k]);
    if (c.f) $(`#c-${c.k}-o`).textContent = c.f(Number((S as any)[c.k]));
  }
}

// ---------------- stats ----------------
function updateStats() {
  $("#st-count").textContent = world.counted.toLocaleString();
  const span = Math.min(60, world.simTime - world.rateT0);
  const rate = span > 2 ? (world.countTimes.length / span) * 3600 : 0;
  $("#st-rate").innerHTML = `${Math.round(rate).toLocaleString()} <small>eggs/h</small>`;
  let inFrame = 0, area = 0, rolling = 0, stacked = 0;
  for (const e of world.eggs) {
    if (e.p.z > -e.a && e.p.z < world.Lcm + e.a) {
      inFrame++; area += Math.PI * e.a * e.b;
      if (e.av.length() > 1.5) rolling++;
      if (e.p.y > e.b * 1.5) stacked++;
    }
  }
  $("#st-frame").innerHTML = `${inFrame} <small>${rolling} rolling · ${stacked} on top</small>`;
  const beltArea = Math.min(S.beltW, S.fov) * MM * world.Lcm;
  $("#st-cover").textContent = ((area / beltArea) * 100).toFixed(1) + "%";
  $("#st-scale").innerHTML = `${view.scale.toFixed(2)} <small>px/mm · egg ≈ ${Math.round(S.size * view.scale)} px</small>`;
  $("#st-def").textContent = `${world.tally.dirty} / ${world.tally.broken}`;
}

// ---------------- loop ----------------
let paused = false, ready = false, last = performance.now(), acc = 0, frameAcc = 0, statT = 0;
const DT = 1 / 120;
let restartToken = 0;
function restart() {
  $("#busy").hidden = false;
  ready = false;
  const token = ++restartToken;
  requestAnimationFrame(() => setTimeout(() => {
    if (token !== restartToken) return; // a newer restart is queued
    world.restart();
    sessionId = newId(); frameIndex = 0;
    ready = true;
    view.render(S, world.simTime);
    updateStats();
    $("#busy").hidden = true;
    last = performance.now(); acc = 0;
  }, 0));
}
function tick(now: number) {
  requestAnimationFrame(tick); // schedule first so one bad frame can't stop playback
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (!ready) return;
  if (!paused) {
    acc += dtReal; frameAcc += dtReal;
    let n = 0;
    while (acc >= DT && n < 10) { world.step(DT); acc -= DT; n++; }
    if (n === 10) acc = 0;
    const fdt = 1 / S.fps;
    if (frameAcc >= fdt) { frameAcc %= fdt; view.render(S, world.simTime); }
  }
  statT += dtReal;
  if (statT > 0.25) { statT = 0; updateStats(); }
}
function setPaused(p: boolean) { paused = p; $("#play").textContent = p ? "Play" : "Pause"; }
function stepFrame() {
  if (!ready) return;
  setPaused(true);
  const n = Math.round(1 / S.fps / DT) || 1;
  for (let i = 0; i < n; i++) world.step(DT);
  view.render(S, world.simTime); updateStats();
}

let toastT = 0;
function toast(msg: string) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => (t.hidden = true), 2400); }
// ---------------- capture (shared by the Copy button, the API, the export script and the MCP server) ----------------
let sessionId = newId(), frameIndex = 0;
function newId() { return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36); }

type CaptureOpts = {
  image?: boolean; labels?: boolean; mask?: boolean; ids?: boolean;
  shapes?: ("bbox" | "obb" | "polygon")[]; meta?: boolean;
  /** Preview options for the returned image only; labels stay in full-resolution pixels. */
  imageScale?: number; imageFormat?: "png" | "jpeg";
};
/**
 * The current camera frame and its ground truth. Labels cover visible pixels only; objects below the
 * size/visibility thresholds are left out, and `visible_fraction` says how much of each egg shows.
 * With `ids`, each object has a `track_id` that stays the same for the whole session and an
 * `instance_id` (1..N in this frame) that matches the value in the instance mask.
 */
function capture(o: CaptureOpts = {}) {
  const { image = false, labels = true, mask = false, ids = true, shapes = ["bbox", "obb", "polygon"], meta = true, imageScale = 1, imageFormat = "png" } = o;
  const L = labels || mask ? view.computeLabels(S) : [];
  const eggs = new Map(world.eggs.map((e) => [e.id, e]));
  const inst = new Map<number, number>();
  L.forEach((l) => { if (l.class !== "dirt") inst.set(l.id, inst.size + 1); });
  const out: any = {
    session_id: sessionId, frame_index: frameIndex, sim_time_s: +world.simTime.toFixed(4),
    width: view.W, height: view.H, px_per_mm_belt_plane: +view.scale.toFixed(4), classes: classNames(S),
  };
  if (image) {
    const src = view.renderer.domElement;
    if (imageScale === 1 && imageFormat === "png") out.image = src.toDataURL("image/png");
    else {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(src.width * imageScale)); c.height = Math.max(1, Math.round(src.height * imageScale));
      const g = c.getContext("2d")!; g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
      out.image = c.toDataURL(`image/${imageFormat}`, 0.9);
    }
  }
  if (labels) {
    out.objects = L.map((l) => {
      const e = l.class !== "dirt" ? eggs.get(l.id) : undefined;
      const obj: any = { class: l.class, class_id: l.class_id };
      if (ids) {
        if (l.class === "dirt") { obj.track_id = l.id; obj.parent_track_id = l.parent; obj.parent_instance_id = inst.get(l.parent!) ?? null; }
        else { obj.track_id = l.id; obj.instance_id = inst.get(l.id); }
        obj.global_track_id = `${sessionId}:${l.id}`;
      }
      if (shapes.includes("bbox")) obj.bbox_xywh = l.bbox;
      if (shapes.includes("obb")) obj.obb_xy = l.obb;
      if (shapes.includes("polygon")) obj.polygons = l.polygons;
      obj.area_px = l.area; obj.truncated = l.truncated;
      if (l.visible_fraction !== undefined) obj.visible_fraction = l.visible_fraction;
      if (meta && e) Object.assign(obj, {
        length_mm: +(e.a * 20).toFixed(1), width_mm: +(e.b * 20).toFixed(1), dirty: e.look.dirty, cracked: e.look.cracked,
        velocity_mm_s: [+(e.lv.x * 10).toFixed(1), +(e.lv.z * 10).toFixed(1)], rolling: e.av.length() > 1.5, on_top_of_another: e.p.y > e.b * 1.5,
      });
      return obj;
    });
  }
  if (mask) out.instance_mask = instanceMask(inst);
  return out;
}
/** PNG where red + 256 × green is the instance id (0 = background). Dirt patches are not in the mask. */
function instanceMask(inst: Map<number, number>) {
  const { W, H, buf } = view.labeler;
  const by16 = new Map<number, number>(); inst.forEach((v, k) => by16.set(k & 0xffff, v));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!, img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) {
      const o = (src + x) * 4, id = buf[o] | (buf[o + 1] << 8), v = id ? by16.get(id) ?? 0 : 0, d = (y * W + x) * 4;
      img.data[d] = v & 255; img.data[d + 1] = v >> 8; img.data[d + 2] = 0; img.data[d + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
const frameLabels = (withImage = false) => capture({ image: withImage });

$("#play").addEventListener("click", () => setPaused(!paused));
$("#step").addEventListener("click", stepFrame);
$("#restart").addEventListener("click", restart);
$("#copy").addEventListener("click", () => {
  const data = frameLabels();
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
    () => toast(`Copied labels for ${data.objects.length} objects in frame ${data.frame}`),
    () => toast("The clipboard is blocked here. Open the page in its own browser tab and try again."),
  );
});
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).closest?.("input, select, textarea")) return;
  if (ev.code === "Space") { ev.preventDefault(); setPaused(!paused); }
  else if (ev.key === ".") stepFrame();
});

// For automated checks and dataset scripts.
const waitReady = () => new Promise<void>((res) => { const t = () => (ready ? res() : setTimeout(t, 25)); t(); });
const advance = (seconds: number) => {
  const n = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < n; i++) world.step(DT);
  frameIndex++;
  view.render(S, world.simTime);
};
/** Stable programmatic API (version 1) for agents, the export script and the MCP server. */
const api = {
  version: 1,
  presets: () => Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
  /** Every setting with its range or options. */
  schema: () => CONTROLS.map(([group, c]) => ({ group, key: c.k, ...(c.k2 ? { key2: c.k2 } : {}), label: c.label, type: c.type ?? "range", min: c.min, max: c.max, step: c.step, options: c.options?.map(([v]) => v) })),
  settings: () => ({ ...S }),
  /** Starts a new session (new session_id, track ids restart) from an optional preset plus overrides. */
  async startSession(opts: { preset?: string; settings?: Partial<Settings>; seed?: number } = {}) {
    let base: Partial<Settings> = { ...S };
    if (opts.preset) {
      if (!(opts.preset in PRESETS)) throw new Error(`Unknown preset "${opts.preset}". Use one of: ${Object.keys(PRESETS).join(", ")}`);
      const { label, ...v } = PRESETS[opts.preset]; base = { ...BASE, ...v, preset: opts.preset };
    }
    applySettings({ ...base, ...(opts.settings ?? {}), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) });
    await waitReady();
    setPaused(true);
    return { session_id: sessionId, classes: classNames(S), width: view.W, height: view.H, settings: { ...S } };
  },
  /** Changes settings without restarting (camera, lighting, labels, flow rate...). */
  set(vals: Partial<Settings>) {
    const cam = Object.keys(vals).some((k) => CAMERA_KEYS.includes(k) && (vals as any)[k] !== (S as any)[k]);
    Object.assign(S, vals); syncControls();
    if (cam) reconfigure();
    world.applyMaterialSettings(); save();
    return { classes: classNames(S) };
  },
  /** Advances simulated time and renders the next camera frame. */
  step(seconds = 1 / 30) { advance(seconds); return { session_id: sessionId, frame_index: frameIndex, sim_time_s: +world.simTime.toFixed(4) }; },
  capture,
};
(window as any).eggsim = {
  api, S, world, view, setPaused, frameLabels, reconfigure, restart, applySettings, PRESETS, BASE,
  ready: () => ready,
  /** Advance `seconds` of simulation, then render one camera frame. */
  advance,
  step: (n = 1) => { for (let i = 0; i < n; i++) world.step(DT); view.render(S, world.simTime); },
};

buildControls();
view.configure(S);
restart();
requestAnimationFrame(tick);
