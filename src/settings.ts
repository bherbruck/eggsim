export const DEFAULTS = {
  preset: "cross", seed: 7,
  // belt
  beltType: "pp", beltW: 600, speed: 10, flow: "down", beltDirt: 0.35, vibration: 0.3,
  // eggs
  rate: 30000, clump: 0.35, lateral: "uniform", align: 0.2, size: 58, sizeVar: 2.2, brown: 0.85,
  // motion and jams
  rollIn: 0.3, rollEase: 0.6, bounce: 0.12, bumps: 0.05, stopGo: false, stopCycle: 12,
  backup: false, release: 12000, wallPos: 1.05,
  // defects
  dirty: 0.06, cracked: 0.03, broken: 0.005, feathers: 1.5, manure: 4,
  // camera
  res: "1280x720", fps: 30, fov: 760, height: 900, distortion: 0.08, exposure: 2, gain: 1, temp: 4800,
  shadow: 6, softness: 0.5, lightAng: 135, vignette: 0.35, noise: 0.25, flicker: 0,
  // overlay
  osd: true, boxes: false, labels: true, countLine: true, linePos: 0.5, tracks: false,
};
export type Settings = typeof DEFAULTS;

// Applied before every preset so presets don't inherit each other's leftovers.
export const BASE: Partial<Settings> = {
  exposure: 2, gain: 1, temp: 4800, shadow: 6, softness: 0.5, vignette: 0.35, noise: 0.25, flicker: 0,
  vibration: 0.3, size: 58, sizeVar: 2.2, brown: 0.85, height: 900, distortion: 0.08,
  rollIn: 0.3, rollEase: 0.6, bounce: 0.12, bumps: 0.05, stopGo: false, stopCycle: 12,
  backup: false, release: 12000, wallPos: 1.05,
};

export const PRESETS: Record<string, Partial<Settings> & { label: string }> = {
  cross: { label: "Cross conveyor, 600 mm", beltType: "pp", beltW: 600, speed: 10, flow: "down", rate: 30000, clump: 0.35, lateral: "uniform", align: 0.2, fov: 760, res: "1280x720", dirty: 0.06, cracked: 0.03, broken: 0.005, feathers: 1.5, manure: 4, beltDirt: 0.35 },
  cage: { label: "Cage row collection belt, 4 in", beltType: "ppold", beltW: 100, speed: 3, flow: "right", rate: 4000, clump: 0.25, lateral: "edges", align: 0.85, fov: 150, height: 400, res: "1280x720", dirty: 0.08, cracked: 0.04, broken: 0.008, feathers: 3, manure: 10, beltDirt: 0.6, rollIn: 0.6 },
  packer: { label: "Packer infeed, 900 mm", beltType: "rubber", beltW: 900, speed: 18, flow: "down", rate: 90000, clump: 0.55, lateral: "uniform", align: 0, fov: 1000, height: 1300, res: "1920x1080", dirty: 0.02, cracked: 0.02, broken: 0.002, feathers: 0.3, manure: 0.5, beltDirt: 0.15, brown: 0.3 },
  jam: { label: "Backup at transfer", beltType: "pp", beltW: 500, speed: 9, flow: "down", rate: 26000, clump: 0.5, lateral: "uniform", align: 0.3, fov: 640, res: "1280x720", dirty: 0.05, cracked: 0.04, broken: 0.006, feathers: 1, manure: 3, beltDirt: 0.4, backup: true, release: 14000, wallPos: 0.82, bumps: 0.1 },
  tracker: { label: "Tracker torture test", beltType: "ppold", beltW: 450, speed: 8, flow: "down", rate: 20000, clump: 0.75, lateral: "edges", align: 0.4, fov: 580, res: "1280x720", dirty: 0.08, cracked: 0.05, broken: 0.01, feathers: 2, manure: 6, beltDirt: 0.6, rollIn: 0.9, rollEase: 0.9, bounce: 0.25, bumps: 0.5, stopGo: true, stopCycle: 8, exposure: 4 },
  rough: { label: "Rough day: dirty flock, bad light", beltType: "ppold", beltW: 400, speed: 6, flow: "down", rate: 14000, clump: 0.6, lateral: "edges", align: 0.5, fov: 520, res: "1280x960", dirty: 0.25, cracked: 0.1, broken: 0.03, feathers: 6, manure: 20, beltDirt: 0.9, flicker: 0.6, noise: 0.55, gain: 0.8, exposure: 1 },
};

export type Control = {
  k: keyof Settings; label: string; type?: "select" | "toggle" | "number";
  min?: number; max?: number; step?: number; f?: (v: number) => string; options?: [string, string][];
};
const pct = (v: number) => Math.round(v * 100) + "%";
const pct1 = (v: number) => (v * 100).toFixed(1) + "%";

export const CONTROLS: [string, Control][] = [
  ["Belt", { k: "beltType", label: "Belt surface", type: "select", options: [["pp", "Woven PP, clean"], ["ppold", "Woven PP, aged"], ["rubber", "Black PVC"]] }],
  ["Belt", { k: "beltW", label: "Belt width", min: 80, max: 1200, step: 10, f: (v) => v + " mm" }],
  ["Belt", { k: "speed", label: "Belt speed", min: 0, max: 40, step: 0.5, f: (v) => v.toFixed(1) + " m/min" }],
  ["Belt", { k: "flow", label: "Flow direction in image", type: "select", options: [["down", "Top to bottom"], ["up", "Bottom to top"], ["right", "Left to right"], ["left", "Right to left"]] }],
  ["Belt", { k: "beltDirt", label: "Belt stains", min: 0, max: 1, step: 0.05, f: pct }],
  ["Belt", { k: "vibration", label: "Vibration", min: 0, max: 1, step: 0.05, f: pct }],
  ["Eggs", { k: "rate", label: "Egg flow", min: 0, max: 120000, step: 200, f: (v) => v.toLocaleString() + " /h" }],
  ["Eggs", { k: "clump", label: "Clumping", min: 0, max: 1, step: 0.05, f: pct }],
  ["Eggs", { k: "lateral", label: "Arrival across belt", type: "select", options: [["uniform", "Spread evenly"], ["edges", "Both edges (rolled from cages)"], ["center", "Centered"], ["left", "One edge"]] }],
  ["Eggs", { k: "align", label: "Aligned with belt", min: 0, max: 1, step: 0.05, f: pct }],
  ["Eggs", { k: "size", label: "Mean egg length", min: 48, max: 66, step: 0.5, f: (v) => v.toFixed(1) + " mm" }],
  ["Eggs", { k: "sizeVar", label: "Length spread (σ)", min: 0, max: 5, step: 0.1, f: (v) => v.toFixed(1) + " mm" }],
  ["Eggs", { k: "brown", label: "Brown eggs", min: 0, max: 1, step: 0.05, f: pct }],
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
  ["Defects & debris", { k: "cracked", label: "Cracked eggs", min: 0, max: 0.3, step: 0.005, f: pct1 }],
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
  ["Camera", { k: "vignette", label: "Vignetting", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "noise", label: "Sensor noise", min: 0, max: 1, step: 0.05, f: pct }],
  ["Camera", { k: "flicker", label: "Mains light flicker", min: 0, max: 1, step: 0.05, f: pct }],
  ["Overlay", { k: "osd", label: "Camera timestamp text", type: "toggle" }],
  ["Overlay", { k: "countLine", label: "Counting line", type: "toggle" }],
  ["Overlay", { k: "linePos", label: "Line position", min: 0.1, max: 0.9, step: 0.01, f: pct }],
  ["Overlay", { k: "boxes", label: "Ground-truth boxes", type: "toggle" }],
  ["Overlay", { k: "labels", label: "Box labels", type: "toggle" }],
  ["Overlay", { k: "tracks", label: "Ground-truth tracks", type: "toggle" }],
  ["Simulation", { k: "seed", label: "Random seed (Restart to apply)", type: "number" }],
];

// Settings that need the camera, render targets or static geometry rebuilt.
export const CAMERA_KEYS = ["res", "fov", "flow", "height"];
export const OVERLAY_KEYS = ["osd", "boxes", "labels", "countLine", "linePos", "tracks", "seed"];
