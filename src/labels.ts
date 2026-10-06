// Ground-truth labels from an ID render: every labeled object is drawn in a flat colour that encodes
// its id (and a dirt bit), lens-distorted like the real image, then read back and turned into
// boxes, rotated boxes and polygons. Labels therefore cover only what is actually visible.
import * as THREE from "three";
import type { Settings } from "./settings";
import { classNames } from "./settings";
import type { World } from "./world";

export type Pt = [number, number];
export type Label = {
  id: number; class: string; class_id: number; parent?: number;
  bbox: [number, number, number, number]; obb: Pt[]; polygons: Pt[][]; area: number; truncated: boolean;
};

const ID_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ID_FS = `uniform vec3 idc; uniform sampler2D dirt; uniform sampler2D map; uniform float hasDirt, useAlpha; varying vec2 vUv;
void main(){
  if (useAlpha > 0.5 && texture2D(map, vUv).a < 0.3) discard;
  float d = hasDirt > 0.5 ? texture2D(dirt, vUv).r : 0.0;
  gl_FragColor = vec4(idc.rg, d > 0.3 ? 1.0 : 0.0, 1.0);
}`;
const DIST_FS = `uniform sampler2D tex; uniform float aspect, k; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0); float r2 = dot(p, p); float rc2 = 0.25 * (aspect * aspect + 1.0);
  vec2 s = p * (1.0 + k * r2) / (1.0 + k * rc2) / vec2(aspect, 1.0) + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = texture2D(tex, s);
}`;

const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
const blankTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blankTex.needsUpdate = true;

function idMaterial(mesh: THREE.Mesh, id: number) {
  let m = mesh.userData.idMat as THREE.ShaderMaterial | undefined;
  if (!m) {
    const src = mesh.material as any;
    m = new THREE.ShaderMaterial({
      uniforms: {
        idc: { value: new THREE.Vector3() }, dirt: { value: mesh.userData.dirt ?? blankTex }, hasDirt: { value: mesh.userData.dirt ? 1 : 0 },
        map: { value: src.map ?? blankTex }, useAlpha: { value: src.transparent || src.alphaTest > 0 ? 1 : 0 },
      },
      vertexShader: ID_VS, fragmentShader: ID_FS, side: THREE.DoubleSide,
    });
    mesh.userData.idMat = m;
  }
  m.uniforms.idc.value.set((id & 255) / 255, ((id >> 8) & 255) / 255, 0);
  return m;
}

export class Labeler {
  rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  rtDist = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  distMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, aspect: { value: 1 }, k: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: DIST_FS, depthTest: false });
  distScene = new THREE.Scene(); quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  buf = new Uint8Array(16);
  W = 4; H = 4;
  constructor() { this.distScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.distMat)); }

  resize(W: number, H: number) {
    this.W = W; this.H = H;
    this.rt.setSize(W, H); this.rtDist.setSize(W, H);
    this.buf = new Uint8Array(W * H * 4);
    this.distMat.uniforms.aspect.value = W / H;
  }

  /** Renders the ID image of the world at its current pose. */
  render(renderer: THREE.WebGLRenderer, world: World, cam: THREE.Camera, S: Settings) {
    const saved: [THREE.Mesh, THREE.Material | THREE.Material[], boolean][] = [];
    world.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      saved.push([o, o.material, o.visible]);
      const kind = o.userData.kind as string | undefined, oid = o.userData.oid as number | undefined;
      const labeled = kind === "egg" || (kind === "broken" && S.labelBroken) || (kind === "feather" && S.labelFeather);
      if (kind === "stain" || kind === "splice" || kind === "manure") o.visible = false;
      else if (labeled && oid) o.material = idMaterial(o, oid);
      else o.material = black;
    });
    const bg = world.scene.background, env = world.scene.environment, auto = renderer.shadowMap.autoUpdate;
    world.scene.background = null; world.scene.environment = null; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(world.scene, cam);
    for (const [o, m, v] of saved) { o.material = m; o.visible = v; }
    world.scene.background = bg; world.scene.environment = env; renderer.shadowMap.autoUpdate = auto;
    this.distMat.uniforms.tex.value = this.rt.texture;
    this.distMat.uniforms.k.value = S.distortion;
    renderer.setRenderTarget(this.rtDist); renderer.render(this.distScene, this.quadCam);
    renderer.readRenderTargetPixels(this.rtDist, 0, 0, this.W, this.H, this.buf);
    renderer.setRenderTarget(null);
  }

  /** Turns the last ID image into labels. */
  extract(world: World, S: Settings): Label[] {
    const { W, H, buf } = this, N = W * H;
    const names = classNames(S);
    const ids = new Uint16Array(N), dirt = new Uint8Array(N);
    const minX = new Int32Array(65536).fill(1e9), minY = new Int32Array(65536).fill(1e9), maxX = new Int32Array(65536).fill(-1), maxY = new Int32Array(65536).fill(-1), cnt = new Int32Array(65536);
    const used: number[] = [];
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        const o = (src + x) * 4, id = buf[o] | (buf[o + 1] << 8);
        if (!id) continue;
        const i = y * W + x;
        ids[i] = id; dirt[i] = buf[o + 2] > 127 ? 1 : 0;
        if (!cnt[id]) used.push(id);
        cnt[id]++;
        if (x < minX[id]) minX[id] = x; if (x > maxX[id]) maxX[id] = x;
        if (y < minY[id]) minY[id] = y; if (y > maxY[id]) maxY[id] = y;
      }
    }
    const byId = new Map<number, any>();
    for (const e of world.eggs) byId.set(e.id & 0xffff, e);
    for (const f of world.flats) byId.set(f.id & 0xffff, f);
    const out: Label[] = [];
    for (const id of used) {
      const obj = byId.get(id);
      if (!obj || cnt[id] < 12) continue;
      let cls: string;
      if (obj.kind === "egg") cls = S.eggClasses === "split" && obj.look.dirty ? "dirty_egg" : "egg";
      else cls = obj.kind;
      const cid = names.indexOf(cls);
      if (cid < 0) continue;
      const bx = minX[id], by = minY[id], bw = maxX[id] - bx + 1, bh = maxY[id] - by + 1;
      const mask = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (ids[(by + y) * W + bx + x] === id) mask[y * bw + x] = 1;
      const lab = shapeOf(mask, bw, bh, bx, by, 8);
      if (!lab) continue;
      out.push({ id: obj.id, class: cls, class_id: cid, ...lab, truncated: bx <= 0 || by <= 0 || bx + bw >= W || by + bh >= H });
      // dirt patches on this egg, one label per visible patch
      if (S.labelDirt && obj.kind === "egg" && obj.look.dirty) {
        const dmask = new Uint8Array(bw * bh);
        let any = false;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (by + y) * W + bx + x; if (ids[i] === id && dirt[i]) { dmask[y * bw + x] = 1; any = true; } }
        if (!any) continue;
        components(dmask, bw, bh).forEach((comp, k) => {
          if (comp.length < 6) return;
          const m2 = new Uint8Array(bw * bh); for (const i of comp) m2[i] = 1;
          const dl = shapeOf(m2, bw, bh, bx, by, 4);
          if (dl) out.push({ id: obj.id * 100 + k + 1, parent: obj.id, class: "dirt", class_id: names.indexOf("dirt"), ...dl, truncated: false });
        });
      }
    }
    return out;
  }
}

// ---------------- mask geometry ----------------
const DIRS: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function components(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h), comps: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [], stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; comp.push(i);
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** Moore-neighbour boundary trace of the component containing `start` (its first pixel in raster order). */
function trace(mask: Uint8Array, w: number, h: number, start: number): Pt[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let cx = start % w, cy = (start / w) | 0;
  const sx = cx, sy = cy, pts: Pt[] = [[cx, cy]];
  let back = 4; // we arrived from the west
  for (let it = 0; it < 4 * w * h + 8; it++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8, nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (!at(nx, ny)) continue;
      const pd = (d + 7) % 8, px = cx + DIRS[pd][0], py = cy + DIRS[pd][1];
      back = DIRS.findIndex(([dx, dy]) => dx === px - nx && dy === py - ny);
      cx = nx; cy = ny; moved = true;
      break;
    }
    if (!moved || (cx === sx && cy === sy)) break;
    pts.push([cx, cy]);
  }
  return pts;
}

function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Rotated box aligned with the mask's principal axis (second moments). For egg-like ellipses the
 * minimum-area rectangle is nearly the same area at every angle, so it picks orientation by pixel noise.
 */
function principalRect(mask: Uint8Array, w: number, h: number, ox: number, oy: number, pts: Pt[]): Pt[] {
  let n = 0, mx = 0, my = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { n++; mx += x; my += y; }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { const dx = x - mx, dy = y - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, y] of pts) { const a = x * ux + y * uy, b = -x * uy + y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => [a * ux - b * uy, a * uy + b * ux] as Pt);
}

/** bbox, rotated box and outline polygons of a binary mask cropped at (ox, oy). Pixel edges, not centres. */
function shapeOf(mask: Uint8Array, w: number, h: number, ox: number, oy: number, minArea: number) {
  const comps = components(mask, w, h).filter((c) => c.length >= Math.min(minArea, 3)).sort((a, b) => b.length - a.length);
  const area = comps.reduce((s, c) => s + c.length, 0);
  if (area < minArea) return null;
  const polygons: Pt[][] = [], all: Pt[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const comp of comps) {
    if (comp.length < minArea && polygons.length) continue;
    const m = new Uint8Array(w * h); let first = Infinity;
    for (const i of comp) { m[i] = 1; if (i < first) first = i; }
    const b = trace(m, w, h, first);
    // pixel centres -> slightly expanded outline so a box drawn from it covers whole pixels
    const poly = simplify(b, 0.7).map(([x, y]) => [x + ox + 0.5, y + oy + 0.5] as Pt);
    polygons.push(poly);
    for (const [x, y] of b) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) all.push([x + ox + dx, y + oy + dy]);
      x0 = Math.min(x0, x + ox); y0 = Math.min(y0, y + oy); x1 = Math.max(x1, x + ox + 1); y1 = Math.max(y1, y + oy + 1);
    }
  }
  const obb = principalRect(mask, w, h, ox, oy, hull(all)).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)] as Pt);
  return { bbox: [x0, y0, x1 - x0, y1 - y0] as [number, number, number, number], obb, polygons, area };
}
