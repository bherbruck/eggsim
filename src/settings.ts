export const DEFAULTS = {
  preset: "cross", seed: 7,
  // belt
  beltType: "pp", beltW: 600, speed: 10, flow: "down", beltDirt: 0.35, vibration: 0.3,
  // eggs
  rate: 30000, clump: 0.35, lateral: "uniform", align: 0.2, size: 58, sizeVar: 2.2, shadeLo: 0.5, shadeHi: 0.95,
  // motion and jams
  rollIn: 0.3, rollEase: 0.6, bounce: 0.12, bumps: 0.05, stopGo: false, stopCycle: 12,
  backup: false, release: 12000, wallPos: 1.05,
  // defects
  dirty: 0.06, cracked: 0.03, broken: 0.005, feathers: 1.5, manure: 4,
  // camera
  res: "1280x720", fps: 30, fov: 760, height: 900, distortion: 0.08, exposure: 2, gain: 1, temp: 4800,
  shadow: 6, softness: 0.5, lightAng: 135, keyLight: 1, fill: 1, contrast: 1, uneven: 0, vignette: 0.35, noise: 0.25, flicker: 0,
  // overlay
  eggClasses: "single", labelDirt: true, labelBroken: true, labelFeather: false,
  overlay: "off", labels: true, tracks: false, osd: false, countLine: false, linePos: 0.5,
};
export type Settings = typeof DEFAULTS;

// Applied before every preset so presets don't inherit each other's leftovers.
export const BASE: Partial<Settings> = {
  exposure: 2, gain: 1, temp: 4800, shadow: 6, softness: 0.5, keyLight: 1, fill: 1, contrast: 1, uneven: 0, vignette: 0.35, noise: 0.25, flicker: 0,
  vibration: 0.3, size: 58, sizeVar: 2.2, shadeLo: 0.5, shadeHi: 0.95, height: 900, distortion: 0.08,
  rollIn: 0.3, rollEase: 0.6, bounce: 0.12, bumps: 0.05, stopGo: false, stopCycle: 12,
  backup: false, release: 12000, wallPos: 1.05, cracked: 0.03,
};

export const PRESETS: Record<string, Partial<Settings> & { label: string }> = {
  cross: { label: "Cross conveyor, 600 mm", beltType: "pp", beltW: 600, speed: 10, flow: "down", rate: 30000, clump: 0.35, lateral: "uniform", align: 0.2, fov: 760, res: "1280x720", dirty: 0.06, cracked: 0.03, broken: 0.005, feathers: 1.5, manure: 4, beltDirt: 0.35 },
  cage: { label: "Cage row collection belt, 4 in", beltType: "ppold", beltW: 100, speed: 3, flow: "right", rate: 4000, clump: 0.25, lateral: "edges", align: 0.85, fov: 150, height: 400, res: "1280x720", dirty: 0.08, broken: 0.008, feathers: 3, manure: 10, beltDirt: 0.6, rollIn: 0.6 },
  packer: { label: "Packer infeed, 900 mm", beltType: "rubber", beltW: 900, speed: 18, flow: "down", rate: 90000, clump: 0.55, lateral: "uniform", align: 0, fov: 1000, height: 1300, res: "1920x1080", dirty: 0.02, broken: 0.002, feathers: 0.3, manure: 0.5, beltDirt: 0.15, shadeLo: 0, shadeHi: 0.3 },
  jam: { label: "Backup at transfer", beltType: "pp", beltW: 500, speed: 9, flow: "down", rate: 26000, clump: 0.5, lateral: "uniform", align: 0.3, fov: 640, res: "1280x720", dirty: 0.05, broken: 0.006, feathers: 1, manure: 3, beltDirt: 0.4, backup: true, release: 14000, wallPos: 0.82, bumps: 0.1 },
  tracker: { label: "Tracker torture test", beltType: "ppold", beltW: 450, speed: 9, flow: "down", rate: 34000, clump: 0.85, lateral: "edges", align: 0.3, fov: 560, res: "1280x720", dirty: 0.08, broken: 0.01, feathers: 2, manure: 6, beltDirt: 0.6, rollIn: 1, rollEase: 1, bounce: 0.3, bumps: 1, vibration: 1.6, stopGo: true, stopCycle: 5, exposure: 5, shadeLo: 0.62, shadeHi: 0.7, backup: true, release: 20000, wallPos: 1.15 },
  rough: { label: "Rough day: dirty flock, bad light", beltType: "ppold", beltW: 400, speed: 6, flow: "down", rate: 14000, clump: 0.6, lateral: "edges", align: 0.5, fov: 520, res: "1280x960", dirty: 0.25, broken: 0.03, feathers: 6, manure: 20, beltDirt: 0.9, flicker: 0.6, noise: 0.55, gain: 0.8, exposure: 1, keyLight: 2.2, fill: 0.2, contrast: 1.35, uneven: 0.6, softness: 0.1, shadow: 14 },
  perf: { label: "Perforated belt, harsh bar light", beltType: "perf", beltW: 500, speed: 8, flow: "down", rate: 18000, clump: 0.4, lateral: "uniform", align: 0.2, fov: 620, res: "1280x720", dirty: 0.08, broken: 0.004, feathers: 1, manure: 3, beltDirt: 0.3, keyLight: 1.8, fill: 0.35, contrast: 1.2, uneven: 0.35, softness: 0.2, shadow: 10 },
};

export type Control = {
  k: keyof Settings; k2?: keyof Settings; label: string; type?: "select" | "toggle" | "number" | "range2";
  min?: number; max?: number; step?: number; f?: (v: number) => string; options?: [string, string][];
};
const pct = (v: number) => Math.round(v * 100) + "%";
const pct1 = (v: number) => (v * 100).toFixed(1) + "%";

export const CONTROLS: [string, Control][] = [
  ["Belt", { k: "beltType", label: "Belt surface", type: "select", options: [["pp", "Woven PP, clean"], ["ppold", "Woven PP, aged"], ["perf", "Perforated plastic, large holes"], ["perfsmall", "Perforated plastic, small holes"], ["rubber", "Black PVC"]] }],
  ["Belt", { k: "beltW", label: "Belt width", min: 80, max: 1200, step: 10, f: (v) => v + " mm" }],
  ["Belt", { k: "speed", label: "Belt speed", min: 0, max: 40, step: 0.5, f: (v) => v.toFixed(1) + " m/min" }],
  ["Belt", { k: "flow", label: "Flow direction in image", type: "select", options: [["down", "Top to bottom"], ["up", "Bottom to top"], ["right", "Left to right"], ["left", "Right to left"]] }],
  ["Belt", { k: "beltDirt", label: "Belt stains", min: 0, max: 1, step: 0.05, f: pct }],
  ["Belt", { k: "vibration", label: "Vibration", min: 0, max: 2, step: 0.05, f: pct }],
  ["Eggs", { k: "rate", label: "Egg flow", min: 0, max: 120000, step: 200, f: (v) => v.toLocaleString() + " /h" }],
  ["Eggs", { k: "clump", label: "Clumping", min: 0, max: 1, step: 0.05, f: pct }],
  ["Eggs", { k: "lateral", label: "Arrival across belt", type: "select", options: [["uniform", "Spread evenly"], ["edges", "Both edges (rolled from cages)"], ["center", "Centered"], ["left", "One edge"]] }],
  ["Eggs", { k: "align", label: "Aligned with belt", min: 0, max: 1, step: 0.05, f: pct }],
  ["Eggs", { k: "size", label: "Mean egg length", min: 48, max: 66, step: 0.5, f: (v) => v.toFixed(1) + " mm" }],
  ["Eggs", { k: "sizeVar", label: "Length spread (σ)", min: 0, max: 5, step: 0.1, f: (v) => v.toFixed(1) + " mm" }],
  ["Eggs", { k: "shadeLo", k2: "shadeHi", label: "Shell color range", type: "range2", min: 0, max: 1, step: 0.01 }],
  ["Motion & jams", { k: "rollIn", label: "Roll-in speed", min: 0, max: 1, step: 0.05, f: pct }],
  ["Motion & jams", { k: "rollEase", label: "How freely eggs roll", min: 0, max: 1, step: 0.05, f: pct }],
  ["Motion & jams", { k: "bounce", label: "Bounciness", min: 0, max: 0.6, step: 0.01, f: (v) => v.toFixed(2) }],
  ["Motion & jams", { k: "bumps", label: "Random knocks", min: 0, max: 1, step: 0.05, f: pct }],
  ["Motion & jams", { k: "stopGo", label: "Belt stops and starts", type: "toggle" }],
  ["Motion & jams", { k: "stopCycle", label: "Run time between stops", min: 3, max: 40, step: 1, f: (v) => v + " s" }],
  ["Motion & jams", { k: "backup", label: "Backup at a gate", type: "toggle" }],
  ["Motion & jams", { k: "release", label: "Gate lets through", min: 0, max: 60000, step: 500, f: (v) => v.toLocaleString() + " /h" }],
  ["Motion & jams", { k: "wallPos", label: "Gate position", min: 0.3, max: 1.2, step: 0.01, f: pct }],
  ["Defects & debris", { k: "dirty", label: "Dirty eggs", min: 0, max: 0.5, step: 0.005, f: pct1 }],
  ["Defects & debris", { k: "cracked", label: "Cracked eggs (look only, labeled egg)", min: 0, max: 0.3, step: 0.005, f: pct1 }],
  ["Defects & debris", { k: "broken", label: "Broken eggs", min: 0, max: 0.1, step: 0.001, f: pct1 }],
  ["Defects & debris", { k: "feathers", label: "Feathers", min: 0, max: 15, step: 0.1, f: (v) => v.toFixed(1) + " /m" }],
  ["Defects & debris", { k: "manure", label: "Manure specks", min: 0, max: 40, step: 0.5, f: (v) => v.toFixed(1) + " /m" }],
  ["Camera", { k: "res", label: "Resolution", type: "select", options: [["640x480", "640 × 480"], ["1280x720", "1280 × 720"], ["1280x960", "1280 × 960"], ["1440x1080", "1440 × 1080"], ["1920x1080", "1920 × 1080"]] }],
  ["Camera", { k: "fps", label: "Frame rate", min: 2, max: 60, step: 1, f: (v) => v + " fps" }],
  ["Camera", { k: "fov", label: "Field of view across belt", min: 100, max: 1600, step: 10, f: (v) => v + " mm" }],
  ["Camera", { k: "height", label: "Camera height", min: 200, max: 2500, step: 10, f: (v) => v + " mm" }],
  ["Camera", { k: "distortion", label: "Lens distortion", min: 0, max: 0.4, step: 0.01, f: (v) => v.toFixed(2) }],
  ["Camera", { k: "exposure", label: "Exposure (motion blur)", min: 0.1, max: 20, step: 0.1, f: (v) => v.toFixed(1) + " ms" }],
  ["Camera", { k: "gain", label: "Brightness", min: 0.3, max: 2, step: 0.05, f: (v) => v.toFixed(2) + "×" }],
  ["Camera", { k: "temp", label: "Light color", min: 2700, max: 6500, step: 100, f: (v) => v + " K" }],
  ["Camera", { k: "shadow", label: "Shadow length", min: 0, max: 30, step: 0.5, f: (v) => v.toFixed(1) + " mm" }],
  ["Camera", { k: "softness", label: "Shadow softness", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "lightAng", label: "Light direction", min: 0, max: 359, step: 1, f: (v) => v + "°" }],
  ["Camera", { k: "keyLight", label: "Key light strength", min: 0.2, max: 3, step: 0.05, f: (v) => v.toFixed(2) + "×" }],
  ["Camera", { k: "fill", label: "Fill (ambient) light", min: 0, max: 2, step: 0.05, f: (v) => v.toFixed(2) + "×" }],
  ["Camera", { k: "contrast", label: "Contrast", min: 0.5, max: 1.8, step: 0.05, f: (v) => v.toFixed(2) }],
  ["Camera", { k: "uneven", label: "Uneven illumination", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "vignette", label: "Vignetting", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "noise", label: "Sensor noise", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "flicker", label: "Mains light flicker", min: 0, max: 1, step: 0.05, f: pct }],
  ["Labels", { k: "eggClasses", label: "Egg classes", type: "select", options: [["single", "One class: egg"], ["split", "Split: egg and dirty_egg"]] }],
  ["Labels", { k: "labelDirt", label: "Label dirt patches as dirt", type: "toggle" }],
  ["Labels", { k: "labelBroken", label: "Label broken eggs as broken", type: "toggle" }],
  ["Labels", { k: "labelFeather", label: "Label feathers as feather", type: "toggle" }],
  ["Labels", { k: "overlay", label: "Show labels on the feed", type: "select", options: [["off", "Off"], ["bbox", "Boxes"], ["obb", "Rotated boxes"], ["seg", "Segmentation outlines"]] }],
  ["Labels", { k: "labels", label: "Class names on the feed", type: "toggle" }],
  ["Labels", { k: "tracks", label: "Track trails on the feed", type: "toggle" }],
  ["Labels", { k: "osd", label: "Camera timestamp text", type: "toggle" }],
  ["Labels", { k: "countLine", label: "Counting line", type: "toggle" }],
  ["Labels", { k: "linePos", label: "Counting line position", min: 0.1, max: 0.9, step: 0.01, f: pct }],
  ["Simulation", { k: "seed", label: "Random seed (Restart to apply)", type: "number" }],
];

// Settings that need the camera, render targets or static geometry rebuilt.
export const CAMERA_KEYS = ["res", "fov", "flow", "height"];
export const OVERLAY_KEYS = ["osd", "overlay", "labels", "countLine", "linePos", "tracks", "seed", "eggClasses", "labelDirt", "labelBroken", "labelFeather"];

/** Class names in id order for the current label settings. */
export function classNames(S: Settings) {
  const n = ["egg"];
  if (S.eggClasses === "split") n.push("dirty_egg");
  if (S.labelDirt) n.push("dirt");
  if (S.labelBroken) n.push("broken");
  if (S.labelFeather) n.push("feather");
  return n;
}

/** Shell color scale from white (0) to dark chocolate brown (1), as HSL key points. */
export const SHADES: [number, number, number, number][] = [
  [0.0, 44, 18, 94], [0.2, 40, 30, 88], [0.4, 32, 40, 76], [0.6, 26, 42, 64], [0.8, 22, 45, 52], [1.0, 18, 45, 38],
];
export function shadeHSL(s: number): [number, number, number] {
  for (let i = 1; i < SHADES.length; i++) {
    const [s1, ...b] = SHADES[i];
    if (s <= s1 || i === SHADES.length - 1) {
      const [s0, ...a] = SHADES[i - 1], f = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)));
      return a.map((v, j) => v + (b[j] - v) * f) as [number, number, number];
    }
  }
  return [44, 18, 94];
}
