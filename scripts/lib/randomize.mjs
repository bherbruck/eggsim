// Domain randomization: draws simulator settings from ranges.
//
// A spec has two parts, both maps from setting key to a rule:
//   sequence: drawn once per sequence (a session: same belt, flock, camera install, lighting)
//   frame:    drawn again before every captured frame (exposure, sensor, small light changes)
// Rules:  [min, max]                 uniform number (integers if both ends are integers)
//         ["a", "b", ...] / [true, false]   pick one (repeat a value to weight it)
//         {of: "beltW", times: [0.8, 1.3]}  a multiple of another, already drawn setting
//         anything else                    used as is
export const DEFAULT_RANDOMIZE = {
  sequence: {
    beltType: ["pp", "pp", "ppold", "perf", "perfsmall", "rubber", "rod", "rodwhite", "wire", "modular"],
    beltTint: ["natural", "natural", "natural", "white", "blue", "gray", "tan", "green"],
    beltW: [300, 900], speed: [3, 18], beltDirt: [0, 0.9], vibration: [0, 0.6],
    rate: [6000, 60000], clump: [0, 0.85], lateral: ["uniform", "uniform", "edges", "center", "left"], align: [0, 1],
    size: [52, 64], sizeVar: [1, 3.5], shadeLo: [0, 0.85], shadeHi: [0.15, 1],
    rollIn: [0, 0.8], bumps: [0, 0.35], stopGo: [false, false, false, true],
    backup: [false, false, true], release: [8000, 30000], wallPos: [0.6, 1.15],
    dirty: [0, 0.25], cracked: [0, 0.1], broken: [0, 0.01], feathers: [0, 6], manure: [0, 15],
    rodPitch: [26, 45], rodDia: [6, 14], rodSpin: [false, false, true],
    fov: { of: "beltW", times: [0.8, 1.4] }, height: { of: "fov", times: [0.9, 2.2] }, distortion: [0, 0.2],
    lightRig: ["overhead", "overhead", "bars", "ring", "window", "dome"],
    lightCast: ["neutral", "neutral", "neutral", "green", "magenta", "blue", "amber"],
    lightAng: [0, 359], shadow: [1, 20], softness: [0, 1], lightBalance: [0.3, 1],
    keyLight: [0.6, 2], fill: [0.2, 1.6], temp: [3000, 6500], shine: [0, 0.7],
    contrast: [0.8, 1.35], uneven: [0, 0.6], vignette: [0, 0.7], flicker: [0, 0.4],
  },
  frame: {
    gain: [0.75, 1.25], noise: [0, 0.6], exposure: [0.3, 6],
  },
};

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Draws one set of values from `rules`; `base` supplies values that {of: ...} rules refer to. */
export function sample(rules = {}, rand, base = {}) {
  const out = {};
  for (const [k, rule] of Object.entries(rules)) {
    let v = rule;
    if (Array.isArray(rule)) {
      const numericRange = rule.length === 2 && rule.every((x) => typeof x === "number");
      if (numericRange) {
        const [a, b] = rule;
        v = a + (b - a) * rand();
        if (Number.isInteger(a) && Number.isInteger(b)) v = Math.round(v);
      } else v = rule[Math.floor(rand() * rule.length)];
    } else if (rule && typeof rule === "object" && "of" in rule) {
      const ref = out[rule.of] ?? base[rule.of];
      const [a, b] = rule.times;
      v = Math.round(ref * (a + (b - a) * rand()));
    }
    out[k] = v;
  }
  return out;
}

/** Accepts true (defaults), a spec object, or a path's parsed JSON; merges over the defaults when `extend` is set. */
export function resolveSpec(spec) {
  if (!spec) return null;
  if (spec === true || spec === "default") return DEFAULT_RANDOMIZE;
  if (spec.extend) return { sequence: { ...DEFAULT_RANDOMIZE.sequence, ...(spec.sequence ?? {}) }, frame: { ...DEFAULT_RANDOMIZE.frame, ...(spec.frame ?? {}) } };
  return { sequence: spec.sequence ?? {}, frame: spec.frame ?? {} };
}
