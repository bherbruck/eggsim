// Camera, multi-sample motion blur, sensor post-processing and burned-in overlays.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Settings } from "./settings";
import { World, MM, Egg, Flat } from "./world";
import { clamp, TAU } from "./rng";

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ACC_FS = `uniform sampler2D tex; uniform float w; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb * w, 1.0); }`;

const POST_FS = `
uniform sampler2D tex; uniform vec2 res; uniform float aspect, k, gain, vignette, noise, flick, bands, phase, beat, seed;
uniform vec3 wb; varying vec2 vUv;
vec2 distort(vec2 uv){
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0); float r2 = dot(p, p); float rc2 = 0.25 * (aspect * aspect + 1.0);
  vec2 q = p * (1.0 + k * r2) / (1.0 + k * rc2); return q / vec2(aspect, 1.0) + 0.5;
}
vec3 neutral(vec3 c){
  const float sc = 0.76; const float desat = 0.15;
  float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
  float peak = max(c.r, max(c.g, c.b)); if (peak < sc) return c;
  const float d = 1.0 - sc; float np = 1.0 - d * d / (peak + d - sc); c *= np / peak;
  float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0); return mix(c, vec3(np), g);
}
vec3 toSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423) + seed); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main(){
  vec2 s = distort(vUv);
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 ca = (s - 0.5) * k * 0.012;
  vec3 c = vec3(texture2D(tex, s + ca).r, texture2D(tex, s).g, texture2D(tex, s - ca).b);
  c *= wb * gain;
  float row = 1.0 - vUv.y;
  c *= 1.0 - flick * (0.5 + 0.5 * sin(6.2831853 * bands * row + phase)) - beat;
  c = neutral(max(c, 0.0));
  float rr = length((vUv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
  c *= 1.0 - vignette * 0.75 * smoothstep(0.35, 1.0, rr);
  vec3 o = toSRGB(c);
  float n = (hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.0) + hash(gl_FragCoord.xy + 41.0) - 1.5);
  float lum = dot(o, vec3(0.299, 0.587, 0.114));
  o += n * noise * (0.035 + 0.09 * sqrt(lum)) * max(1.0, gain);
  gl_FragColor = vec4(o, 1.0);
}`;

const CLS_COL: Record<string, string> = { egg: "#4ade80", dirty: "#fbbf24", cracked: "#fb923c", broken: "#f43f5e", feather: "#38bdf8" };

function tempMul(k: number) {
  const t = (k - 2700) / (6500 - 2700);
  const warm = [1, 0.8, 0.6], neutral = [1, 0.98, 0.95], cool = [0.87, 0.93, 1];
  const [a, b, f] = t < 0.55 ? [warm, neutral, t / 0.55] : [neutral, cool, (t - 0.55) / 0.45];
  return a.map((v, i) => v + (b[i] - v) * f);
}

export class View {
  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  cam = new THREE.PerspectiveCamera(30, 16 / 9, 1, 1000);
  W = 1280; H = 720; scale = 1; // px per mm on the belt plane
  rtSub!: THREE.WebGLRenderTarget; rtAcc!: THREE.WebGLRenderTarget;
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  accMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, w: { value: 1 } }, vertexShader: QUAD_VS, fragmentShader: ACC_FS, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false });
  postMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, res: { value: new THREE.Vector2() }, aspect: { value: 1 }, k: { value: 0 }, gain: { value: 1 }, vignette: { value: 0 }, noise: { value: 0 }, flick: { value: 0 }, bands: { value: 3 }, phase: { value: 0 }, beat: { value: 0 }, seed: { value: 0 }, wb: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: QUAD_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
  });
  accScene = new THREE.Scene(); postScene = new THREE.Scene();
  ctx: CanvasRenderingContext2D;
  flickPhase = 0;
  frameNo = 0;

  constructor(public display: HTMLCanvasElement, public world: World) {
    this.ctx = display.getContext("2d")!;
    const r = this.renderer;
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    const quad = new THREE.PlaneGeometry(2, 2);
    this.accScene.add(new THREE.Mesh(quad, this.accMat));
    this.postScene.add(new THREE.Mesh(quad, this.postMat));
    const pm = new THREE.PMREMGenerator(r);
    world.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    world.scene.environmentIntensity = 0.32;
  }

  configure(S: Settings) {
    const [w, h] = S.res.split("x").map(Number);
    this.W = w; this.H = h;
    this.display.width = w; this.display.height = h;
    this.renderer.setSize(w, h, false);
    this.rtSub?.dispose(); this.rtAcc?.dispose();
    this.rtSub = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.rtAcc = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    const vertical = S.flow === "down" || S.flow === "up";
    const across = vertical ? w : h, along = vertical ? h : w;
    this.scale = across / S.fov;
    const Lcm = (along / this.scale) * MM;
    this.world.Lcm = Lcm;
    this.world.texSize = this.scale > 3 ? 256 : 128;
    const hcm = S.height * MM;
    const imgHcm = (h / this.scale) * MM;
    const c = this.cam;
    c.aspect = w / h; c.fov = (2 * Math.atan(imgHcm / 2 / hcm) * 180) / Math.PI;
    c.near = Math.max(1, hcm * 0.2); c.far = hcm + 200;
    c.position.set(0, hcm, Lcm / 2);
    c.up.set(...({ down: [0, 0, -1], up: [0, 0, 1], right: [1, 0, 0], left: [-1, 0, 0] } as any)[S.flow] as [number, number, number]);
    c.lookAt(0, 0, Lcm / 2);
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    const u = this.postMat.uniforms;
    u.res.value.set(w, h); u.aspect.value = w / h;
  }

  private updateLight(S: Settings) {
    const l = this.world.light, Lcm = this.world.Lcm;
    const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0);
    const down = new THREE.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 1).negate();
    const la = (S.lightAng * Math.PI) / 180;
    const hdir = right.multiplyScalar(Math.cos(la)).add(down.multiplyScalar(Math.sin(la))).setY(0).normalize();
    const tilt = Math.atan(S.shadow / 44);
    l.target.position.set(0, 0, Lcm / 2);
    l.position.copy(l.target.position).addScaledVector(hdir, Math.sin(tilt) * 300).add(new THREE.Vector3(0, Math.cos(tilt) * 300, 0));
    l.intensity = 1.05;
    const ext = Math.max(S.fov * MM, Lcm) * 0.62 + 12;
    const sc = l.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 50; sc.far = 600;
    sc.updateProjectionMatrix();
    l.shadow.radius = 1 + S.softness * 9;
  }

  render(S: Settings, simTime: number) {
    this.frameNo++;
    const w = this.world, r = this.renderer;
    this.updateLight(S);
    // sub-frames needed so nothing moves more than ~1.5 px between them
    let maxV = w.vBelt;
    for (const e of w.eggs) maxV = Math.max(maxV, e.lv.length() + e.av.length() * e.a);
    const exp = S.exposure / 1000;
    const blurPx = maxV * exp * this.scale * 10;
    const N = clamp(Math.ceil(blurPx / 1.5), 1, 8);
    r.setRenderTarget(this.rtAcc); r.setClearColor(0x000000, 1); r.clear();
    this.accMat.uniforms.w.value = 1 / N;
    this.accMat.uniforms.tex.value = this.rtSub.texture;
    for (let i = 0; i < N; i++) {
      const tau = N === 1 ? 0 : exp * (1 - i / (N - 1));
      w.pose(tau);
      r.setRenderTarget(this.rtSub); r.autoClear = true;
      r.render(w.scene, this.cam);
      r.setRenderTarget(this.rtAcc); r.autoClear = false;
      r.render(this.accScene, this.quadCam);
    }
    r.autoClear = true;
    // sensor and lens
    const u = this.postMat.uniforms;
    u.tex.value = this.rtAcc.texture;
    u.k.value = S.distortion; u.gain.value = S.gain; u.vignette.value = S.vignette; u.noise.value = S.noise;
    const wb = tempMul(S.temp); u.wb.value.set(wb[0], wb[1], wb[2]);
    // 120 Hz light flicker read out by a rolling shutter; exposures past one period average it away
    u.flick.value = S.flicker * 0.55 * clamp(1 - S.exposure / 8.33, 0, 1);
    this.flickPhase += TAU * (0.31 + 0.07 * Math.sin(simTime * 0.7));
    u.phase.value = this.flickPhase; u.bands.value = 120 * (0.85 / S.fps);
    u.beat.value = S.flicker * 0.12 * (0.5 + 0.5 * Math.sin(simTime * 2.3));
    u.seed.value = Math.random();
    r.setRenderTarget(null);
    r.render(this.postScene, this.quadCam);
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(r.domElement, 0, 0);
    this.drawOverlays(S);
  }

  // ---------------- projection helpers ----------------
  private tmp = new THREE.Vector3();
  /** World point -> output pixel, including lens distortion. */
  toPx(p: THREE.Vector3): [number, number] {
    const v = this.tmp.copy(p).project(this.cam);
    const sx = v.x * 0.5 + 0.5, sy = v.y * 0.5 + 0.5;
    const k = this.postMat.uniforms.k.value, asp = this.W / this.H;
    let ox = sx, oy = sy;
    if (k > 0) {
      const px = (sx - 0.5) * asp, py = sy - 0.5, rc2 = 0.25 * (asp * asp + 1);
      let qx = px, qy = py;
      for (let i = 0; i < 10; i++) { const f = (1 + k * rc2) / (1 + k * (qx * qx + qy * qy)); qx = px * f; qy = py * f; }
      ox = qx / asp + 0.5; oy = qy + 0.5;
    }
    return [ox * this.W, (1 - oy) * this.H];
  }
  boxOf(o: Egg | Flat): [number, number, number, number] | null {
    const pts = this.world.outline(o, []);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { const [x, y] = this.toPx(p); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.W, x1); y1 = Math.min(this.H, y1);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }
  labeled() {
    const out: [Egg | Flat, [number, number, number, number]][] = [];
    for (const o of this.world.eggs) { const b = this.boxOf(o); if (b) out.push([o, b]); }
    for (const o of this.world.flats) if (o.kind !== "manure") { const b = this.boxOf(o); if (b) out.push([o, b]); }
    return out;
  }

  private drawOverlays(S: Settings) {
    const g = this.ctx, W = this.W, H = this.H, w = this.world;
    const u = Math.max(1, H / 720);
    const mono = (px: number, wt = 500) => `${wt} ${px * u}px "IBM Plex Mono", ui-monospace, monospace`;
    if (S.tracks) {
      g.lineWidth = 1.5 * u; g.lineJoin = "round";
      for (const e of w.eggs) {
        if (e.trail.length < 6) continue;
        g.strokeStyle = CLS_COL[e.cls]; g.globalAlpha = 0.75; g.beginPath();
        for (let i = 0; i < e.trail.length; i += 3) {
          const [x, y] = this.toPx(this.tmp2.set(e.trail[i], e.trail[i + 1], e.trail[i + 2]));
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        const [x, y] = this.toPx(this.tmp2.copy(e.p)); g.lineTo(x, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (S.boxes) {
      g.lineWidth = 1.5 * u; g.font = mono(11); g.textBaseline = "bottom";
      for (const [o, b] of this.labeled()) {
        const col = CLS_COL[o.cls]; g.strokeStyle = col; g.strokeRect(b[0] + 0.5, b[1] + 0.5, b[2], b[3]);
        if (S.labels) {
          const t = `${o.cls} ${o.id}`, tw = g.measureText(t).width + 6 * u;
          g.fillStyle = col; g.fillRect(b[0], b[1] - 14 * u, tw, 14 * u);
          g.fillStyle = "#0b0d0e"; g.fillText(t, b[0] + 3 * u, b[1] - 2 * u);
        }
      }
    }
    if (S.countLine) {
      const z = w.Lcm * S.linePos, hw = (S.beltW * MM) / 2;
      g.strokeStyle = "rgba(255,196,40,0.95)"; g.lineWidth = 2 * u; g.setLineDash([10 * u, 6 * u]);
      g.beginPath();
      for (let i = 0; i <= 16; i++) { const [x, y] = this.toPx(this.tmp2.set(-hw + (2 * hw * i) / 16, 0, z)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.setLineDash([]);
      const [ax, ay] = this.toPx(this.tmp2.set(-hw, 0, z)), [bx, by] = this.toPx(this.tmp2.set(hw, 0, z));
      const tx = clamp(Math.min(ax, bx) + 8 * u, 8 * u, W - 150 * u), ty = clamp(Math.min(ay, by) - 8 * u, 40 * u, H - 30 * u);
      g.font = mono(15, 600); g.textBaseline = "bottom";
      const t = `COUNT ${w.counted}`, tw = g.measureText(t).width + 12 * u;
      g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(tx - 6 * u, ty - 20 * u, tw, 22 * u);
      g.fillStyle = "#ffc428"; g.fillText(t, tx, ty);
    }
    if (S.osd) {
      const d = new Date(), z = (n: number, l = 2) => String(n).padStart(l, "0");
      const ts = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}.${z(d.getMilliseconds(), 3)}`;
      g.font = mono(14); g.textBaseline = "top";
      g.shadowColor = "rgba(0,0,0,0.9)"; g.shadowBlur = 3 * u; g.fillStyle = "rgba(255,255,255,0.92)";
      g.fillText("CAM 02  BELT B  EGG COLLECTION", 12 * u, 10 * u);
      g.fillText(ts, W - g.measureText(ts).width - 12 * u, 10 * u);
      g.textBaseline = "bottom";
      const mpm = ((w.vBelt / MM) * 60) / 1000;
      g.fillText(`${W}x${H}  ${S.fps}fps  1/${Math.round(1000 / S.exposure)}s  BELT ${mpm.toFixed(1)} m/min  F${String(this.frameNo).padStart(7, "0")}`, 12 * u, H - 10 * u);
      g.shadowBlur = 0; g.shadowColor = "transparent";
    }
  }
  private tmp2 = new THREE.Vector3();
}
