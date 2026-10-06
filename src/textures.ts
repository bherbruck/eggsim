// Procedural textures, all painted on 2D canvases. Units are millimetres unless noted.
import { mulberry32, rr, TAU, clamp, Rand } from "./rng";

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.ceil(w)); c.height = Math.max(2, Math.ceil(h));
  return c;
}

export function blob(g: CanvasRenderingContext2D, r: Rand, cx: number, cy: number, rad: number, jag: number) {
  g.beginPath();
  const n = 14, ph = r() * TAU;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const q = rad * (1 + jag * (Math.sin(t * 3 + ph) * 0.5 + (r() - 0.5)));
    const x = cx + Math.cos(t) * q, y = cy + Math.sin(t) * q;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

export type Sprite = { c: HTMLCanvasElement; wmm: number; hmm: number };
function sprite(wmm: number, hmm: number, s: number) {
  const c = canvas(wmm * s, hmm * s);
  const g = c.getContext("2d")!;
  g.setTransform(c.width / wmm, 0, 0, c.height / hmm, c.width / 2, c.height / 2);
  return { c, g, wmm, hmm };
}

// ---------------- eggs ----------------
export type EggLook = {
  seed: number; a: number; b: number; k: number; // half length, half width, pointiness (mm)
  h: number; sat: number; l: number; brown: boolean; dirty: boolean; cracked: boolean;
};

/** Egg surface radius at polar parameter t (0 = blunt pole, PI = pointy pole). */
export const eggRadius = (e: { b: number; k: number }, t: number) => e.b * Math.sin(t) * (1 + e.k * Math.cos(t));
export const eggAxial = (e: { a: number }, t: number) => -e.a * Math.cos(t);

/**
 * Paints the shell onto a lathe UV layout: x = angle around the long axis, y = position along it.
 * Spots are pre-distorted so they come out round on the curved shell.
 */
export function eggTexture(e: EggLook, H: number) {
  const W = H * 2;
  const c = canvas(W, H), g = c.getContext("2d")!;
  const r = mulberry32(e.seed);
  g.fillStyle = `hsl(${e.h},${e.sat}%,${e.l}%)`;
  g.fillRect(0, 0, W, H);
  const R = (t: number) => Math.max(0.6, eggRadius(e, t));
  const ds = (t: number) => Math.max(0.6, Math.hypot(e.a * Math.sin(t), e.b * Math.cos(t)));
  const px = (th: number, t: number) => [(th / TAU) * W, (1 - t / Math.PI) * H];
  const surfPoint = () => { for (;;) { const t = r() * Math.PI; if (r() < Math.sin(t)) return [r() * TAU, t]; } };
  const offset = (th: number, t: number, dx: number, dy: number) => [th + dx / R(t), clamp(t + dy / ds(t), 0.02, Math.PI - 0.02)];

  const spot = (th: number, t: number, rho: number, fill: string | CanvasGradient, rot = 0) => {
    const [x, y] = px(th, t);
    const rx = Math.min(W / 2, (rho * W) / (TAU * R(t))), ry = (rho * H) / (Math.PI * ds(t));
    g.fillStyle = fill;
    for (const ox of [0, -W, W]) {
      if (x + ox + rx < 0 || x + ox - rx > W) continue;
      g.beginPath(); g.ellipse(x + ox, y, rx, ry, rot, 0, TAU); g.fill();
    }
  };
  const softSpot = (th: number, t: number, rho: number, inner: string) => {
    const [x, y] = px(th, t);
    const rx = Math.min(W / 2, (rho * W) / (TAU * R(t))), ry = (rho * H) / (Math.PI * ds(t));
    for (const ox of [0, -W, W]) {
      g.save(); g.translate(x + ox, y); g.scale(rx, ry);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, inner); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
    }
  };

  // mottling
  for (let i = 0; i < 14; i++) {
    const [th, t] = surfPoint();
    softSpot(th, t, rr(r, 6, 16), r() < 0.5 ? "rgba(255,255,255,0.08)" : `hsla(${e.h},${e.sat + 10}%,${e.l - 18}%,0.12)`);
  }
  // speckles
  const nSpk = e.brown ? Math.floor(rr(r, 20, 140)) : Math.floor(rr(r, 0, 18));
  for (let i = 0; i < nSpk; i++) {
    const [th, t] = surfPoint();
    spot(th, t, rr(r, 0.2, e.brown ? 1.1 : 0.6),
      e.brown ? `hsla(${e.h - 4},${e.sat + 15}%,${e.l - 22}%,${rr(r, 0.2, 0.55)})` : `rgba(150,140,120,${rr(r, 0.1, 0.25)})`, r() * 3);
  }
  // calcium deposits
  if (r() < 0.25) for (let i = 0; i < 10; i++) { const [th, t] = surfPoint(); spot(th, t, rr(r, 0.4, 1.4), `rgba(255,252,240,${rr(r, 0.25, 0.6)})`); }
  // manure
  if (e.dirty) {
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const [th0, t0] = surfPoint();
      const rad = rr(r, 3, 11), tone = r() < 0.6 ? [62, 48, 30] : [74, 72, 44];
      for (let j = 0; j < 12; j++) {
        const [th, t] = offset(th0, t0, rr(r, -rad, rad) * 0.6, rr(r, -rad, rad) * 0.6);
        spot(th, t, rad * rr(r, 0.2, 0.6), `rgba(${tone[0]},${tone[1]},${tone[2]},${rr(r, 0.18, 0.5)})`, r() * 3);
      }
      if (r() < 0.5) spot(th0, t0, rad * 0.25, "rgba(238,236,226,0.75)");
    }
  }
  // cracks
  if (e.cracked) {
    const [th0, t0] = surfPoint();
    const arms = 2 + Math.floor(r() * 3);
    for (let i = 0; i < arms; i++) {
      let th = th0, t = t0, dir = r() * TAU;
      const pts = [px(th, t)], len = rr(r, 10, 28);
      for (let d = 0; d < len; d += 1.2) {
        dir += rr(r, -0.6, 0.6);
        [th, t] = offset(th, t, Math.cos(dir) * 1.2, Math.sin(dir) * 1.2);
        pts.push(px(((th % TAU) + TAU) % TAU, t));
      }
      for (const [col, w] of [["rgba(255,255,255,0.4)", 2.2], ["rgba(55,40,25,0.85)", 1.1]] as const) {
        g.strokeStyle = col; g.lineWidth = (w * H) / 256; g.beginPath();
        pts.forEach(([x, y], j) => (j && Math.abs(x - pts[j - 1][0]) < W / 2 ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      }
    }
  }
  return c;
}

// ---------------- belt ----------------
export const TILE_MM = 40;
function weave(u: number, v: number) {
  const p = 2.5, cu = Math.floor(u / p), cw = Math.floor(v / p);
  const over = (cu + cw) & 1, fu = u / p - cu, fv = v / p - cw;
  const t = over ? fu : fv, along = over ? fv : fu;
  const edge = 1 - 0.32 * Math.pow(Math.abs(t - 0.5) * 2, 6);
  return edge * (0.95 + 0.05 * Math.sin(along * Math.PI)) * (over ? 1 : 0.92);
}
export function beltTiles(type: string) {
  const P = 320;
  const col = canvas(P, P), bump = canvas(P, P);
  const gc = col.getContext("2d")!, gb = bump.getContext("2d")!;
  const ic = gc.createImageData(P, P), ib = gb.createImageData(P, P);
  const r = mulberry32(99);
  const base = type === "pp" ? [236, 233, 222] : type === "ppold" ? [206, 196, 168] : [44, 45, 47];
  const colNoise: number[] = []; for (let i = 0; i < P; i++) colNoise.push(r() - 0.5);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    let f: number, h: number;
    if (type === "rubber") {
      const n = (r() - 0.5);
      f = 1 + colNoise[i] * 0.12 + n * 0.14; h = 0.5 + n * 0.3;
    } else {
      let acc = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) acc += weave(((i + (sx + 0.5) / 2) / P) * TILE_MM, ((j + (sy + 0.5) / 2) / P) * TILE_MM);
      h = acc / 4;
      f = h + (r() - 0.5) * (type === "ppold" ? 0.09 : 0.05);
    }
    const o = (j * P + i) * 4;
    ic.data[o] = clamp(base[0] * f, 0, 255); ic.data[o + 1] = clamp(base[1] * f, 0, 255); ic.data[o + 2] = clamp(base[2] * f, 0, 255); ic.data[o + 3] = 255;
    ib.data[o] = ib.data[o + 1] = ib.data[o + 2] = clamp(h * 255, 0, 255); ib.data[o + 3] = 255;
  }
  gc.putImageData(ic, 0, 0); gb.putImageData(ib, 0, 0);
  return { col, bump };
}

export function steelTexture() {
  const c = canvas(256, 256), g = c.getContext("2d")!, r = mulberry32(5);
  g.fillStyle = "#a9aeb1"; g.fillRect(0, 0, 256, 256);
  // galvanized spangle
  for (let i = 0; i < 160; i++) {
    const v = (rr(r, 140, 205)) | 0;
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
    blob(g, r, rr(r, 0, 256), rr(r, 0, 256), rr(r, 6, 22), 0.9); g.fill();
  }
  return c;
}

export function stapleTexture() {
  // one clipper-lacing staple per 6.5 mm period, 8 mm tall, 8 px/mm
  const c = canvas(52, 64), g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,20,20,0.55)"; g.fillRect(0, 30, 52, 4);
  g.fillStyle = "#8f9599"; g.fillRect(14, 4, 20, 56);
  g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(14, 4, 6, 56);
  g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(30, 4, 4, 56);
  return c;
}

// ---------------- flat sprites (decals) ----------------
const S = 5; // px per mm for decals

export function stainSprite(o: { seed: number; len: number; wid: number; col: string; alpha: number }): Sprite {
  const r = mulberry32(o.seed);
  const sp = sprite(o.len + 10, o.wid + 10, 2.5), g = sp.g;
  for (let i = 0; i < 22; i++) {
    const x = rr(r, -o.len / 2, o.len / 2) * 0.85, y = rr(r, -o.wid / 2, o.wid / 2) * 0.6, rad = rr(r, 0.2, 0.55) * o.wid;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${o.col},${o.alpha})`); gr.addColorStop(1, `rgba(${o.col},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return sp;
}

export function featherSprite(o: { seed: number; len: number; down: boolean; white: boolean }): Sprite {
  const r = mulberry32(o.seed);
  const L = o.len, sp = sprite(L + 10, L * 0.7 + 10, 7), g = sp.g;
  const col = o.white ? [240, 238, 230] : [150, 105, 70];
  g.lineCap = "round";
  if (o.down) {
    for (let i = 0; i < 80; i++) {
      const t = r() * TAU, q = rr(r, 0.3, 1) * L * 0.35;
      g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${rr(r, 0.15, 0.45)})`; g.lineWidth = rr(r, 0.15, 0.4);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(t + 0.4) * q * 0.6, Math.sin(t + 0.4) * q * 0.6, Math.cos(t) * q, Math.sin(t) * q); g.stroke();
    }
    return sp;
  }
  const bend = rr(r, -0.12, 0.12) * L;
  const qx = (t: number) => -L / 2 + t * L, qy = (t: number) => bend * 4 * t * (1 - t);
  for (let i = 0; i < 100; i++) {
    const t = 0.18 + (i / 100) * 0.8, side = i % 2 ? 1 : -1;
    const w = L * 0.28 * Math.sin(Math.PI * Math.min(1, (t - 0.1) / 0.92)) * rr(r, 0.75, 1.05);
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${rr(r, 0.35, 0.7)})`; g.lineWidth = rr(r, 0.25, 0.5);
    g.beginPath(); g.moveTo(qx(t), qy(t)); g.quadraticCurveTo(qx(t) + w * 0.5, qy(t) + side * w * 0.5, qx(t) + w * 0.75, qy(t) + side * w); g.stroke();
  }
  g.strokeStyle = `rgba(${col[0] - 20},${col[1] - 20},${col[2] - 20},0.9)`; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(qx(0), qy(0)); g.quadraticCurveTo(0, bend * 2, qx(1), qy(1)); g.stroke();
  return sp;
}

export function manureSprite(o: { seed: number; size: number }): Sprite {
  const r = mulberry32(o.seed);
  const sp = sprite(o.size * 2.4, o.size * 2.4, 6), g = sp.g;
  for (let j = 0; j < 5; j++) {
    g.fillStyle = `rgba(${rr(r, 45, 70) | 0},${rr(r, 38, 55) | 0},${rr(r, 22, 32) | 0},${rr(r, 0.5, 0.9)})`;
    blob(g, r, rr(r, -1, 1) * o.size * 0.3, rr(r, -1, 1) * o.size * 0.3, o.size * rr(r, 0.35, 0.6), 0.5); g.fill();
  }
  if (r() < 0.6) { g.fillStyle = "rgba(235,232,220,0.8)"; blob(g, r, 0, 0, o.size * 0.22, 0.5); g.fill(); }
  return sp;
}

/** Albumen puddle plus shell fragments; the yolk is a separate glossy mesh. */
export function brokenSprite(o: { seed: number; h: number; sat: number; l: number }): Sprite & { yolk: [number, number, number, number] } {
  const r = mulberry32(o.seed);
  const sp = sprite(96, 84, S), g = sp.g;
  g.fillStyle = "rgba(232,228,186,0.32)"; blob(g, r, 0, 0, rr(r, 26, 36), 0.35); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 0.6; g.stroke();
  g.fillStyle = "rgba(210,205,150,0.25)"; blob(g, r, rr(r, -6, 6), rr(r, -6, 6), rr(r, 16, 24), 0.4); g.fill();
  const yolk: [number, number, number, number] = [rr(r, -8, 8), rr(r, -6, 6), rr(r, 10, 14), r() < 0.5 ? 1.5 : 1];
  // yolk smear under the dome
  g.fillStyle = "rgba(240,160,20,0.5)";
  g.beginPath(); g.ellipse(yolk[0], yolk[1], yolk[2] * yolk[3] * 1.1, yolk[2] * 1.05, 0, 0, TAU); g.fill();
  const n = 3 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const cx = rr(r, -30, 30), cy = rr(r, -26, 26), sz = rr(r, 4, 14), sides = 4 + Math.floor(r() * 3), rot = r() * TAU;
    g.beginPath();
    for (let j = 0; j < sides; j++) {
      const t = rot + (j / sides) * TAU, q = sz * rr(r, 0.5, 1);
      j ? g.lineTo(cx + Math.cos(t) * q, cy + Math.sin(t) * q) : g.moveTo(cx + Math.cos(t) * q, cy + Math.sin(t) * q);
    }
    g.closePath();
    g.fillStyle = `hsl(${o.h},${o.sat}%,${o.l}%)`; g.fill();
    g.strokeStyle = "rgba(250,248,240,0.9)"; g.lineWidth = 0.6; g.stroke();
    g.fillStyle = "rgba(0,0,0,0.12)"; g.fill();
  }
  return { ...sp, yolk };
}
