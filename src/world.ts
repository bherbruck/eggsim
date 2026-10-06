// Physics (Rapier) and scene objects (Three). World units are centimetres; settings are in mm.
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Settings, shadeHSL } from "./settings";
import { mulberry32, rr, gaussR, clamp, modp, TAU, Rand } from "./rng";
import {
  EggLook, eggTexture, eggRadius, eggAxial, beltTiles, TILE_MM, steelTexture, stapleTexture,
  stainSprite, featherSprite, manureSprite, brokenSprite, Sprite, isPerforated,
} from "./textures";

export const MM = 0.1;
const LOOP_CM = 1400;
const G_EGG = 0x0001, G_WALL = 0x0002;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
const EGG_GROUPS = groups(G_EGG, 0xffff);
const RELEASED_GROUPS = groups(G_EGG, 0xffff & ~G_WALL);
const WALL_GROUPS = groups(G_WALL, G_EGG);
const UP = new THREE.Vector3(0, 1, 0);

export type Egg = {
  kind: "egg"; id: number; cls: string; look: EggLook; a: number; b: number;
  body: RAPIER.RigidBody; col: RAPIER.Collider; mesh: THREE.Mesh;
  hull: Float32Array; counted: boolean; prevZ: number; released: boolean; trail: number[];
  p: THREE.Vector3; q: THREE.Quaternion; lv: THREE.Vector3; av: THREE.Vector3;
};
export type Flat = {
  kind: "broken" | "feather" | "manure"; id: number; cls: string; x: number; z: number; ang: number;
  obj: THREE.Object3D; hw: number; hl: number; counted: boolean; prevZ: number; trail: number[];
};
type Stain = { u: number; xf: number; thr: number; ang: number; spec: any; mesh?: THREE.Mesh };

function decal(spr: Sprite, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const tex = new THREE.CanvasTexture(spr.c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 0.85,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(spr.wmm * MM, spr.hmm * MM), mat);
  m.receiveShadow = true;
  return m;
}
function disposeObj(o: THREE.Object3D) {
  o.traverse((n: any) => {
    n.userData.dirt?.dispose(); n.userData.idMat?.dispose();
    if (n.geometry) n.geometry.dispose();
    if (n.material) { const m = n.material; for (const k of ["map", "bumpMap", "roughnessMap"]) m[k]?.dispose(); m.dispose(); }
  });
  o.removeFromParent();
}

export class World {
  S: Settings;
  scene = new THREE.Scene();
  rw!: RAPIER.World;
  rng: Rand = Math.random;
  eggs: Egg[] = []; flats: Flat[] = []; stains: Stain[] = [];
  beltPos = 0; simTime = 0; vBelt = 0; nextId = 1; spawnTimer = 0; relTokens = 0; trailT = 0;
  counted = 0; countTimes: number[] = []; tally = { dirty: 0, broken: 0 }; rateT0 = 0;
  Lcm = 40; // view length along the belt, on the belt plane

  private beltBody!: RAPIER.RigidBody; private railBodies: RAPIER.RigidBody[] = [];
  private wallBody!: RAPIER.RigidBody; private wallCol!: RAPIER.Collider;
  private statics = new THREE.Group(); private dyn = new THREE.Group();
  private beltMat!: THREE.MeshStandardMaterial; private beltTex: THREE.Texture[] = []; private beltTexType = "";
  private wallMesh!: THREE.Mesh; private splice!: THREE.Mesh;
  light = new THREE.DirectionalLight(0xffffff, 1.0);
  hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.25);
  private steel: THREE.MeshStandardMaterial;

  constructor(S: Settings) {
    this.S = S;
    this.scene.background = new THREE.Color(0x0b0c0d);
    this.scene.add(this.statics, this.dyn);
    const st = new THREE.CanvasTexture(steelTexture()); st.colorSpace = THREE.SRGBColorSpace;
    st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(0.12, 30);
    this.steel = new THREE.MeshStandardMaterial({ map: st, metalness: 0.85, roughness: 0.42 });
    const l = this.light;
    l.castShadow = true; l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02;
    this.scene.add(l, l.target);
    this.scene.add(this.hemi);
  }

  // ---------------- setup ----------------
  restart() {
    const S = this.S;
    for (const e of this.eggs) disposeObj(e.mesh);
    for (const f of this.flats) disposeObj(f.obj);
    for (const s of this.stains) if (s.mesh) disposeObj(s.mesh);
    this.eggs = []; this.flats = []; this.stains = [];
    this.rw?.free();
    this.beltBody = undefined as any; this.railBodies = []; this.wallBody = undefined as any;
    this.rw = new RAPIER.World({ x: 0, y: -981, z: 0 });
    this.rw.timestep = 1 / 120;
    const ip: any = this.rw.integrationParameters;
    if ("lengthUnit" in ip) ip.lengthUnit = 100;
    this.rng = mulberry32(Number(S.seed) || 1);
    this.beltPos = 0; this.simTime = 0; this.nextId = 1; this.spawnTimer = 0; this.relTokens = 0;
    this.vBelt = this.beltTarget();
    const r = this.rng;
    for (let i = 0; i < 260; i++) {
      const kind = r();
      this.stains.push({
        u: rr(r, 0, LOOP_CM), xf: rr(r, -0.48, 0.48), thr: r(), ang: Math.PI / 2 + rr(r, -0.2, 0.2),
        spec: {
          seed: (r() * 2 ** 32) >>> 0, len: rr(r, 15, 90), wid: rr(r, 8, 30), alpha: rr(r, 0.1, 0.28),
          col: kind < 0.55 ? "92,74,46" : kind < 0.75 ? "165,128,60" : kind < 0.9 ? "70,72,60" : "120,110,95",
        },
      });
    }
    this.buildStatics();
    const v = this.vBelt;
    if (v > 0) {
      const T = Math.min(14, (this.Lcm + 40) / v);
      for (let t = 0; t < T; t += 1 / 120) this.step(1 / 120);
    }
    this.counted = 0; this.countTimes = []; this.tally = { dirty: 0, broken: 0 }; this.rateT0 = this.simTime;
    for (const e of this.eggs) e.trail.length = 0;
  }

  /** Belt, rails, gate. Called on restart and when belt width changes. */
  buildStatics() {
    const S = this.S, hw = (S.beltW * MM) / 2;
    for (const c of [...this.statics.children]) { if (c !== this.splice) disposeObj(c); }
    this.statics.clear();
    if (this.beltBody) this.rw.removeRigidBody(this.beltBody);
    for (const b of this.railBodies) this.rw.removeRigidBody(b);
    if (this.wallBody) this.rw.removeRigidBody(this.wallBody);

    // physics
    this.beltBody = this.rw.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(0, -0.5, 0));
    this.rw.createCollider(RAPIER.ColliderDesc.cuboid(hw + 3, 0.5, 600).setFriction(0.9), this.beltBody);
    this.railBodies = [-1, 1].map((side) => {
      const b = this.rw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(side * (hw + 1.1), 2, 0));
      this.rw.createCollider(RAPIER.ColliderDesc.cuboid(1.1, 2, 600).setFriction(0.3).setRestitution(0.3), b);
      return b;
    });
    this.wallBody = this.rw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2.8, this.wallZ() + 1));
    this.wallCol = this.rw.createCollider(RAPIER.ColliderDesc.cuboid(hw, 2.5, 1).setFriction(0.25).setCollisionGroups(WALL_GROUPS), this.wallBody);
    this.wallCol.setEnabled(!!S.backup);

    // visuals
    if (!this.beltMat || this.beltTexType !== S.beltType) this.makeBeltMaterial();
    const beltLen = 600;
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(S.beltW * MM, beltLen), this.beltMat);
    belt.rotation.x = -Math.PI / 2; belt.position.z = this.Lcm / 2; belt.receiveShadow = true;
    if (isPerforated(S.beltType)) {
      belt.castShadow = true;
      const st = new THREE.CanvasTexture(steelTexture()); st.colorSpace = THREE.SRGBColorSpace;
      st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(S.beltW / 120, beltLen / 12);
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(S.beltW * MM + 2, beltLen), new THREE.MeshStandardMaterial({ map: st, color: 0x6a6e70, metalness: 0.7, roughness: 0.55 }));
      bed.rotation.x = -Math.PI / 2; bed.position.set(0, -0.45, this.Lcm / 2); bed.receiveShadow = true;
      this.statics.add(bed);
    }
    for (const t of this.beltTex) t.repeat.set(S.beltW / TILE_MM, (beltLen * 10) / TILE_MM);
    this.statics.add(belt);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -35; floor.receiveShadow = true;
    this.statics.add(floor);
    // conveyor side frame under the rails
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4, beltLen), this.steel);
      rail.position.set(side * (hw + 1.1), 2, this.Lcm / 2); rail.castShadow = rail.receiveShadow = true;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(8, 12, beltLen), new THREE.MeshStandardMaterial({ color: 0x3a3e41, roughness: 0.7, metalness: 0.3 }));
      frame.position.set(side * (hw + 6.2), -6, this.Lcm / 2); frame.receiveShadow = true;
      this.statics.add(rail, frame);
    }
    this.wallMesh = new THREE.Mesh(new THREE.BoxGeometry(S.beltW * MM + 4.4, 5, 2), this.steel);
    this.wallMesh.castShadow = this.wallMesh.receiveShadow = true;
    this.statics.add(this.wallMesh);
    if (!this.splice) {
      const st = new THREE.CanvasTexture(stapleTexture()); st.colorSpace = THREE.SRGBColorSpace; st.wrapS = THREE.RepeatWrapping;
      this.splice = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.8), new THREE.MeshStandardMaterial({ map: st, transparent: true, metalness: 0.6, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.splice.rotation.x = -Math.PI / 2; this.splice.userData.kind = "splice";
    }
    this.splice.scale.x = S.beltW * MM;
    (this.splice.material as any).map.repeat.set(S.beltW / 6.5, 1);
    this.statics.add(this.splice);
    for (const s of this.stains) if (s.mesh) { disposeObj(s.mesh); s.mesh = undefined; }
  }

  makeBeltMaterial() {
    const S = this.S;
    for (const t of this.beltTex) t.dispose();
    this.beltMat?.dispose();
    const { col, bump } = beltTiles(S.beltType);
    const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace;
    const bm = new THREE.CanvasTexture(bump);
    for (const t of [map, bm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
    this.beltTex = [map, bm];
    const perf = isPerforated(S.beltType);
    this.beltMat = new THREE.MeshStandardMaterial({
      map, bumpMap: bm, bumpScale: S.beltType === "rubber" ? 0.3 : perf ? 2 : 1.2,
      roughness: S.beltType === "rubber" ? 0.55 : perf ? 0.5 : 0.82, alphaTest: perf ? 0.5 : 0,
    });
    this.beltTexType = S.beltType;
  }

  wallZ() { return this.Lcm * this.S.wallPos; }

  // ---------------- live setting changes ----------------
  applyMaterialSettings() {
    for (const e of this.eggs) { e.col.setRestitution(this.S.bounce); e.body.setAngularDamping(this.angDamp()); }
    this.wallCol?.setEnabled(!!this.S.backup);
    this.wallBody?.setTranslation({ x: 0, y: 2.8, z: this.wallZ() + 1 }, true);
    if (this.beltTexType !== this.S.beltType) {
      this.makeBeltMaterial();
      this.buildStatics();
    }
  }
  angDamp() { return 0.12 + (1 - this.S.rollEase) * 3.5; }

  beltTarget() {
    const S = this.S, v = (S.speed * 1000) / 60 * MM; // cm/s
    if (!S.stopGo) return v;
    const run = S.stopCycle, stop = Math.max(1.5, S.stopCycle * 0.35);
    return this.simTime % (run + stop) < run ? v : 0;
  }

  // ---------------- spawning ----------------
  private lateralX(halfFree: number) {
    const S = this.S, bw = S.beltW * MM, r = this.rng;
    switch (S.lateral) {
      case "edges": return (r() < 0.5 ? -1 : 1) * (halfFree - Math.abs(gaussR(r)) * bw * 0.07);
      case "center": return clamp(gaussR(r) * bw * 0.14, -halfFree, halfFree);
      case "left": return -halfFree + Math.abs(gaussR(r)) * bw * 0.18;
      default: return rr(r, -halfFree, halfFree);
    }
  }
  private eggAngle() {
    const S = this.S, r = this.rng;
    if (S.align < 0.03) return r() * TAU;
    return Math.PI / 2 + gaussR(r) * (1 - S.align) * 1.4 + (r() < 0.5 ? Math.PI : 0);
  }
  private axisXZ(q: THREE.Quaternion) { const d = UP.clone().applyQuaternion(q); return [d.x, d.z]; }
  private overlaps(x: number, z: number, ang: number, a: number, b: number) {
    const d = a - b, cx = Math.cos(ang) * d, cz = Math.sin(ang) * d;
    const mine = [[x + cx, z + cz], [x - cx, z - cz]];
    for (const o of this.eggs) {
      if (Math.abs(o.p.z - z) > 10 || Math.abs(o.p.x - x) > 10) continue;
      const [ax, az] = this.axisXZ(o.q), od = o.a - o.b;
      for (const s of [1, -1]) for (const m of mine) {
        const dx = o.p.x + ax * od * s - m[0], dz = o.p.z + az * od * s - m[1], rs = o.b + b + 0.05;
        if (dx * dx + dz * dz < rs * rs) return true;
      }
    }
    return false;
  }

  private spawnGroup() {
    const S = this.S, r = this.rng;
    let n = 1; const q = S.clump * 0.9;
    while (r() < q && n < 40) n++;
    let px: number | null = null, pz = -9 - rr(r, 0, 3);
    for (let i = 0; i < n; i++) {
      if (r() < S.broken) { this.spawnBroken(this.lateralX((S.beltW * MM) / 2 - 3), pz - 4); continue; }
      const look = this.newLook();
      const a = look.a * MM, b = look.b * MM, half = (S.beltW * MM) / 2 - b - 0.1;
      if (half <= 0) return;
      let ok = false, x = 0, z = 0; const ang = this.eggAngle();
      for (let t = 0; t < 10 && !ok; t++) {
        if (px === null || t > 5) { x = this.lateralX(half); z = pz - t * 1.2; }
        else { const th = r() * TAU, dd = a + b + rr(r, 0.1, 0.8); x = clamp(px + Math.cos(th) * dd, -half, half); z = pz + Math.sin(th) * dd * 0.9 - 2; }
        ok = z > -40 && !this.overlaps(x, z, ang, a, b);
      }
      if (!ok) continue;
      this.addEgg(look, x, z, ang);
      px = x; pz = z;
    }
  }

  private newLook(): EggLook {
    const S = this.S, r = this.rng;
    const len = clamp(S.size + gaussR(r) * S.sizeVar, 40, 76);
    const si = clamp(0.765 + gaussR(r) * 0.02, 0.7, 0.83);
    const shade = rr(r, Math.min(S.shadeLo, S.shadeHi), Math.max(S.shadeLo, S.shadeHi));
    const [h, sat, l] = shadeHSL(shade);
    return {
      seed: (r() * 2 ** 32) >>> 0, a: len / 2, b: (len * si) / 2, k: clamp(0.08 + gaussR(r) * 0.025, 0.02, 0.15),
      brown: shade > 0.35, h: h + rr(r, -2, 2), sat: sat + rr(r, -4, 4), l: l + rr(r, -2, 2),
      dirty: r() < S.dirty, cracked: r() < S.cracked,
    };
  }

  texSize = 128;
  private addEgg(look: EggLook, x: number, z: number, ang: number) {
    const S = this.S, r = this.rng;
    const a = look.a * MM, b = look.b * MM;
    const ec = { a, b, k: look.k };
    // visual: lathe around +Y
    const prof: THREE.Vector2[] = [];
    const N = 30;
    for (let i = 0; i <= N; i++) { const t = (i / N) * Math.PI; prof.push(new THREE.Vector2(Math.max(0, eggRadius(ec, t)), eggAxial(ec, t))); }
    const geo = new THREE.LatheGeometry(prof, 40);
    const painted = eggTexture(look, this.texSize);
    const tex = new THREE.CanvasTexture(painted.color);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: look.brown ? 0.58 : 0.5, clearcoat: 0.08, clearcoatRoughness: 0.5, sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    if (look.dirty) mesh.userData.dirt = new THREE.CanvasTexture(painted.dirt);
    const id = this.nextId++;
    mesh.userData.kind = "egg"; mesh.userData.oid = id & 0xffff;
    this.dyn.add(mesh);
    // physics: convex hull of the same profile
    const pts: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI, rad = eggRadius(ec, t), y = eggAxial(ec, t);
      if (i === 0 || i === 12) { pts.push(0, y, 0); continue; }
      for (let j = 0; j < 14; j++) { const p = (j / 14) * TAU; pts.push(Math.cos(p) * rad, y, Math.sin(p) * rad); }
    }
    const hull = new Float32Array(pts);
    // orientation: long axis horizontal at `ang` in the belt plane, random spin about it
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const qq = new THREE.Quaternion().setFromUnitVectors(UP, dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, r() * TAU));
    const toward = S.lateral === "edges" || S.lateral === "left" ? -Math.sign(x) || 1 : r() < 0.5 ? -1 : 1;
    const vx = toward * S.rollIn * rr(r, 4, 24);
    const vz = this.vBelt * (1 - S.rollIn * rr(r, 0.2, 0.7));
    const body = this.rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, b + 0.15, z).setRotation(qq)
        .setLinvel(vx, 0, vz).setAngvel({ x: -(vz - this.vBelt) / b, y: 0, z: vx / b })
        .setAngularDamping(this.angDamp()).setCanSleep(false),
    );
    const col = this.rw.createCollider(
      RAPIER.ColliderDesc.convexHull(hull)!.setDensity(1.05).setFriction(0.45).setRestitution(S.bounce).setCollisionGroups(EGG_GROUPS),
      body,
    );
    const cls = look.dirty ? "dirty" : "egg";
    this.eggs.push({
      kind: "egg", id, cls, look, a, b, body, col, mesh, hull, counted: false, prevZ: z, released: false, trail: [],
      p: new THREE.Vector3(x, b, z), q: qq.clone(), lv: new THREE.Vector3(), av: new THREE.Vector3(),
    });
  }

  private spawnBroken(x: number, z: number) {
    const r = this.rng, S = this.S;
    const [h, sat, l] = shadeHSL(rr(r, Math.min(S.shadeLo, S.shadeHi), Math.max(S.shadeLo, S.shadeHi)));
    const spec = { seed: (r() * 2 ** 32) >>> 0, h, sat, l };
    const spr = brokenSprite(spec);
    const g = new THREE.Group();
    const d = decal(spr, { roughness: 0.25 }); d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d);
    const [yx, yy, yr, sm] = spr.yolk;
    const yolk = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), new THREE.MeshPhysicalMaterial({ color: 0xf2a114, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
    yolk.scale.set(yr * MM * sm, yr * MM * 0.45, yr * MM);
    yolk.position.set(yx * MM, 0.05, yy * MM); yolk.castShadow = true; g.add(yolk);
    const ang = r() * TAU, id = this.nextId++;
    for (const m of [d, yolk]) { m.userData.kind = "broken"; m.userData.oid = id & 0xffff; }
    g.rotation.y = ang; g.position.set(x, 0, z);
    this.dyn.add(g);
    this.flats.push({ kind: "broken", id, cls: "broken", x, z, ang, obj: g, hw: 4.2, hl: 4.2, counted: false, prevZ: z, trail: [] });
  }
  private spawnDebris(kind: "feather" | "manure") {
    const r = this.rng, S = this.S, half = (S.beltW * MM) / 2 - 0.8;
    const x = rr(r, -half, half), z = kind === "feather" ? -12 : -7, ang = r() * TAU;
    let m: THREE.Mesh, hw: number, hl: number;
    if (kind === "feather") {
      const down = r() < 0.35;
      const spec = { seed: (r() * 2 ** 32) >>> 0, len: down ? rr(r, 18, 34) : rr(r, 30, 75), down, white: r() < 0.4 + 0.6 * (1 - (S.shadeLo + S.shadeHi) / 2) };
      m = decal(featherSprite(spec), { roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.02 });
      m.castShadow = true;
      hl = (down ? spec.len * 0.35 : spec.len * 0.5) * MM; hw = (down ? spec.len * 0.35 : spec.len * 0.22) * MM;
      m.position.y = 0.12;
    } else {
      const spec = { seed: (r() * 2 ** 32) >>> 0, size: rr(r, 2, 7) };
      m = decal(manureSprite(spec), { roughness: 0.6 });
      hl = hw = spec.size * MM; m.position.y = 0.06;
    }
    m.rotation.set(-Math.PI / 2, 0, ang);
    const id = this.nextId++;
    m.userData.kind = kind; m.userData.oid = id & 0xffff;
    const g = new THREE.Group(); g.add(m); g.position.set(x, 0, z);
    this.dyn.add(g);
    this.flats.push({ kind, id, cls: kind, x, z, ang, obj: g, hw, hl, counted: true, prevZ: z, trail: [] });
  }

  // ---------------- stepping ----------------
  step(dt: number) {
    const S = this.S, r = this.rng;
    const target = this.beltTarget(), acc = 320 * dt;
    this.vBelt += clamp(target - this.vBelt, -acc, acc);
    const v = this.vBelt;
    this.beltPos += v * dt; this.simTime += dt;
    // belt is a velocity-driven kinematic slab; teleport it back now and then (it is featureless)
    const bt = this.beltBody.translation();
    // Vibration up to 100% is gentle random nudging. Above that the belt itself starts shaking side to side
    // and up and down (torture testing); its position is re-centred so it can't drift.
    const vib = Math.min(1, S.vibration), shakeAmt = Math.max(0, S.vibration - 1), ts = this.simTime;
    if (bt.z > 100 || Math.abs(bt.x) > 0.3 || Math.abs(bt.y + 0.5) > 0.3) this.beltBody.setTranslation({ x: 0, y: -0.5, z: bt.z > 100 ? bt.z - 200 : bt.z }, true);
    const shake = v > 0 || S.stopGo ? shakeAmt : 0;
    this.beltBody.setLinvel({ x: shake * 15 * Math.sin(TAU * 11 * ts), y: shake * 8 * Math.cos(TAU * 17 * ts), z: v }, true);

    // arrivals keep coming even when the belt is stopped; crowded spots simply refuse new eggs
    const meanGroup = 1 / (1 - S.clump * 0.9);
    const evRate = S.rate / 3600 / meanGroup;
    if (evRate > 0) {
      this.spawnTimer -= dt;
      while (this.spawnTimer <= 0) { this.spawnGroup(); this.spawnTimer += -Math.log(1 - r()) / evRate; }
    } else this.spawnTimer = 0.2;
    const dist = (v * dt) / 100;
    if (r() < S.feathers * dist) this.spawnDebris("feather");
    if (r() < S.manure * dist) this.spawnDebris("manure");

    // disturbances
    const sq = Math.sqrt(dt);
    for (const e of this.eggs) {
      const m = e.body.mass();
      if (vib > 0 && (v > 0 || shakeAmt > 0)) e.body.applyImpulse({ x: gaussR(r) * (vib * 2.2 + shakeAmt * 6) * sq * m, y: 0, z: gaussR(r) * (vib * 1.2 + shakeAmt * 5) * sq * m }, true);
      // knocks get rarer and gentler fast at low settings (10% ≈ one knock per egg every 3 minutes)
      if (S.bumps > 0 && r() < S.bumps * S.bumps * 0.6 * dt) {
        const th = r() * TAU, dv = rr(r, 6, 30) * (0.7 + 0.6 * S.bumps);
        e.body.applyImpulse({ x: Math.cos(th) * dv * m, y: rr(r, 0, 12) * m, z: Math.sin(th) * dv * m }, true);
        e.body.applyTorqueImpulse({ x: gaussR(r) * m * 6, y: gaussR(r) * m * 6, z: gaussR(r) * m * 6 }, true);
      }
    }
    // gate releases one egg at a time
    if (S.backup) {
      this.relTokens = Math.min(2, this.relTokens + (S.release / 3600) * dt);
      if (this.relTokens >= 1) {
        const wz = this.wallZ();
        const cands = this.eggs.filter((e) => !e.released && e.p.z + e.a > wz - 0.5);
        if (cands.length) {
          const e = cands[Math.floor(r() * cands.length)];
          e.released = true; e.col.setCollisionGroups(RELEASED_GROUPS); this.relTokens -= 1;
        }
      }
    }

    this.rw.step();

    // read back
    const lineZ = this.Lcm * S.linePos;
    for (const e of this.eggs) {
      const t = e.body.translation(), q = e.body.rotation(), lv = e.body.linvel(), av = e.body.angvel();
      e.prevZ = e.p.z;
      e.p.set(t.x, t.y, t.z); e.q.set(q.x, q.y, q.z, q.w); e.lv.set(lv.x, lv.y, lv.z); e.av.set(av.x, av.y, av.z);
    }
    for (const f of this.flats) {
      f.prevZ = f.z; f.z += v * dt;
      if (f.kind === "feather" && vib > 0) { f.x += gaussR(r) * vib * 0.3 * sq; f.ang += gaussR(r) * vib * 0.05 * sq; }
    }
    const tally = (o: { counted: boolean; prevZ: number; cls: string }, z: number) => {
      if (o.counted || o.prevZ >= lineZ || z < lineZ) return;
      o.counted = true; this.counted++; this.countTimes.push(this.simTime);
      if (o.cls in this.tally) (this.tally as any)[o.cls]++;
    };
    for (const e of this.eggs) tally(e, e.p.z);
    for (const f of this.flats) if (f.kind === "broken") tally(f, f.z);
    this.trailT += dt;
    if (this.trailT >= 0.1) {
      this.trailT = 0;
      for (const e of this.eggs) { e.trail.push(e.p.x, e.p.y, e.p.z); if (e.trail.length > 120) e.trail.splice(0, 3); }
    }
    // cleanup
    const gone = this.Lcm + 30;
    this.eggs = this.eggs.filter((e) => {
      if (e.p.z < gone && e.p.y > -15 && e.p.z > -200) return true;
      this.rw.removeRigidBody(e.body); disposeObj(e.mesh); return false;
    });
    this.flats = this.flats.filter((f) => { if (f.z < gone) return true; disposeObj(f.obj); return false; });
    while (this.countTimes.length && this.countTimes[0] < this.simTime - 60) this.countTimes.shift();
  }

  // ---------------- pose for rendering ----------------
  private dq = new THREE.Quaternion(); private ax = new THREE.Vector3();
  /** Places every visual at its pose `tau` seconds before now (used for motion-blur sub-frames). */
  pose(tau: number) {
    const S = this.S, v = this.vBelt, bp = this.beltPos - v * tau;
    const off = (bp * 10) / TILE_MM;
    for (const t of this.beltTex) t.offset.y = off % 1;
    for (const e of this.eggs) {
      e.mesh.position.copy(e.p).addScaledVector(e.lv, -tau);
      const w = e.av.length();
      if (tau > 0 && w > 1e-3) {
        this.ax.copy(e.av).multiplyScalar(1 / w);
        this.dq.setFromAxisAngle(this.ax, -w * tau);
        e.mesh.quaternion.copy(this.dq).multiply(e.q);
      } else e.mesh.quaternion.copy(e.q);
    }
    for (const f of this.flats) {
      f.obj.position.set(f.x, 0, f.z - v * tau);
      if (f.kind !== "broken") f.obj.children[0].rotation.z = f.ang;
    }
    // stains are fixed to the belt loop
    const bw = S.beltW * MM;
    for (const s of this.stains) {
      const vis = s.thr <= S.beltDirt;
      const z = modp(s.u + bp, LOOP_CM) - 20;
      const inView = vis && z > -20 && z < this.Lcm + 20;
      if (inView && !s.mesh) {
        s.mesh = decal(stainSprite(s.spec)); s.mesh.userData.kind = "stain";
        s.mesh.rotation.set(-Math.PI / 2, 0, s.ang);
        this.statics.add(s.mesh);
      }
      if (s.mesh) { s.mesh.visible = inView; s.mesh.position.set(s.xf * bw, 0.02, z); }
    }
    const zs = modp(bp, LOOP_CM) - 20;
    this.splice.visible = zs > -5 && zs < this.Lcm + 5;
    this.splice.position.set(0, 0.03, zs);
    this.wallMesh.visible = !!S.backup;
    this.wallMesh.position.set(0, 2.8, this.wallZ() + 1);
  }

  /** Points on an object's outline in world space, for ground-truth boxes. */
  outline(o: Egg | Flat, out: THREE.Vector3[]) {
    out.length = 0;
    if (o.kind === "egg") {
      const h = o.hull, m = o.mesh.matrixWorld;
      for (let i = 0; i < h.length; i += 3) out.push(new THREE.Vector3(h[i], h[i + 1], h[i + 2]).applyMatrix4(m));
    } else {
      const c = Math.cos(o.ang), s = Math.sin(o.ang), y = o.kind === "broken" ? 0.4 : 0.1;
      const pos = o.obj.position;
      for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = u * o.hl, lz = w * o.hw;
        out.push(new THREE.Vector3(pos.x + lx * c - lz * s, y, pos.z - (lx * s + lz * c)));
      }
    }
    return out;
  }
}
