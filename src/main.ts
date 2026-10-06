import RAPIER from "@dimforge/rapier3d-compat";
import { DEFAULTS, BASE, PRESETS, CONTROLS, CAMERA_KEYS, OVERLAY_KEYS, Settings } from "./settings";
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
  for (const [k, p] of Object.entries(PRESETS)) ps.add(new Option(p.label, k));
  ps.add(new Option("Custom", "custom"));
  ps.addEventListener("change", () => {
    if (!(ps.value in PRESETS)) return;
    const { label, ...vals } = PRESETS[ps.value];
    Object.assign(S, BASE, vals, { preset: ps.value });
    syncControls(); view.configure(S); restart(); save();
  });
  for (const [grp, c] of CONTROLS) {
    if (!groups[grp]) {
      const d = document.createElement("details"); d.open = grp !== "Simulation";
      d.innerHTML = `<summary>${grp}</summary><div class="rows"></div>`;
      root.appendChild(d); groups[grp] = d.querySelector(".rows")!;
    }
    const row = document.createElement("div"), id = "c-" + c.k;
    row.className = "ctl" + (c.type === "toggle" ? " toggle" : "");
    row.innerHTML = `<label for="${id}">${c.label}</label>` + (c.f ? `<output id="${id}-o"></output>` : "");
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
      if (!OVERLAY_KEYS.includes(c.k)) { S.preset = "custom"; ps.value = "custom"; }
      if (CAMERA_KEYS.includes(c.k)) reconfigure();
      else if (c.k === "beltW") world.buildStatics();
      world.applyMaterialSettings();
      if (paused) view.render(S, world.simTime);
      save();
    });
  }
  syncControls();
}
function syncControls() {
  for (const { el, c } of Object.values(inputs)) {
    if (c.type === "toggle") (el as HTMLInputElement).checked = !!(S as any)[c.k];
    else el.value = String((S as any)[c.k]);
    if (c.f) $(`#c-${c.k}-o`).textContent = c.f(Number((S as any)[c.k]));
  }
  ($("#preset") as HTMLSelectElement).value = S.preset in PRESETS ? S.preset : "custom";
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
  $("#st-def").textContent = `${world.tally.dirty} / ${world.tally.cracked} / ${world.tally.broken}`;
}

// ---------------- loop ----------------
let paused = false, last = performance.now(), acc = 0, frameAcc = 0, statT = 0;
const DT = 1 / 120;
function restart() {
  $("#busy").hidden = false;
  requestAnimationFrame(() => setTimeout(() => {
    world.restart();
    view.render(S, world.simTime);
    updateStats();
    $("#busy").hidden = true;
    last = performance.now(); acc = 0;
  }, 0));
}
function tick(now: number) {
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
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
  requestAnimationFrame(tick);
}
function setPaused(p: boolean) { paused = p; $("#play").textContent = p ? "Play" : "Pause"; }
function stepFrame() {
  setPaused(true);
  const n = Math.round(1 / S.fps / DT) || 1;
  for (let i = 0; i < n; i++) world.step(DT);
  view.render(S, world.simTime); updateStats();
}

let toastT = 0;
function toast(msg: string) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => (t.hidden = true), 2400); }
function frameLabels() {
  return {
    frame: view.frameNo, width: view.W, height: view.H, px_per_mm_belt_plane: +view.scale.toFixed(4), flow: S.flow,
    objects: view.labeled().map(([o, b]) => ({
      id: o.id, class: o.cls, bbox_xywh: b.map((v) => +v.toFixed(1)),
      ...(o.kind === "egg"
        ? {
            length_mm: +(o.a * 20).toFixed(1), width_mm: +(o.b * 20).toFixed(1), color: o.look.brown ? "brown" : "white",
            dirty: o.look.dirty, cracked: o.look.cracked,
            velocity_mm_s: [+(o.lv.x * 10).toFixed(1), +(o.lv.z * 10).toFixed(1)],
            rolling: o.av.length() > 1.5, on_top_of_another: o.p.y > o.b * 1.5,
          }
        : {}),
    })),
  };
}

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
(window as any).eggsim = { S, world, view, step: (n = 1) => { for (let i = 0; i < n; i++) world.step(DT); view.render(S, world.simTime); }, setPaused, frameLabels, reconfigure, restart };

buildControls();
view.configure(S);
restart();
requestAnimationFrame(tick);
