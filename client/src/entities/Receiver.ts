import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AIState } from '@shared/GameTypes';

/** Cheap deterministic 3D value noise for one-off geometry work. */
function noise3(x: number, y: number, z: number): number {
  const h = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const u = sm(xf), v = sm(yf), w = sm(zf);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    r += h(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r * 2 - 1;
}

/** Displace vertices, then bake an organic mottle (blotches + darker creases) into vertex colours. */
function organic(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void, seed = 0): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const before = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    before.copy(p);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
    // recessed (pushed-in) areas read darker — fake cavity occlusion
    const inward = THREE.MathUtils.clamp((before.length() - p.length()) * 25, -1, 1);
    const blotch = noise3(p.x * 6 + seed, p.y * 6, p.z * 6) * 0.5 + 0.5;
    const vein = Math.abs(noise3(p.x * 22 + seed, p.y * 9, p.z * 22));
    const k = THREE.MathUtils.clamp(0.62 + blotch * 0.38 - inward * 0.25 - (vein < 0.06 ? 0.18 : 0), 0.3, 1);
    colors[i * 3] = k * 1.02;
    colors[i * 3 + 1] = k * 0.96;
    colors[i * 3 + 2] = k * 0.93;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export interface ReceiverMaterials {
  skin: THREE.Material;  // vertexColors: true
  flesh: THREE.Material; // BackSide
  teeth: THREE.Material;
}

/** Overall size relative to the authored proportions: ~2.7 m upright, taller than any player. */
const SCALE = 1.2;

/**
 * THE RECEIVER — visual model + procedural animation (design doc 6.1, revised).
 *
 * Original design. Taller than a person; long, thin, curved torso; uneven shoulders.
 * The right arm hangs absurdly long with an extra joint and drags its fingers; the
 * left arm is short and folded tight at the elbow, its hand twitching at the chest.
 * A long, kinked neck carries a lopsided, faceless head — a sunken flat plane where
 * a face should be. Only at the very end does the head split open.
 */
export class ReceiverModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private spineLow = new THREE.Group();
  private spineHigh = new THREE.Group();
  private neck: THREE.Group[] = [];
  private neckMeshes: THREE.Mesh[] = [];
  private head = new THREE.Group();
  private halfL = new THREE.Group();
  private halfR = new THREE.Group();
  // long arm (right): shoulder → elbow → extra joint → wrist
  private longArm!: { shoulder: THREE.Group; elbow: THREE.Group; extra: THREE.Group; wrist: THREE.Group; fingers: THREE.Group[] };
  // short folded arm (left)
  private shortArm!: { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; fingers: THREE.Group[] };
  private legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[] = [];
  private joints: THREE.Object3D[] = [];
  private saved: THREE.Euler[] = [];

  private phase = 0;
  private time = Math.random() * 100;
  private lean = 0.6;
  private open = 0;
  private duckK = 0;
  private headYaw = 0;
  private headTilt = 0.55;
  private stutterTimer = 0;
  private freezeTimer = 0;
  private shownPos = new THREE.Vector3();
  private shownYaw = 0;
  private placed = false;
  private fingerTwitch = 0;
  private savedHips = 1;
  private savedStretch = 1;
  /** 0..1 — squeeze down to pass under a door header */
  duck = 0;

  constructor(m: ReceiverMaterials) {
    let seed = 0;
    const limb = (len: number, r0: number, r1 = r0 * 0.7, knots = 0.18) => {
      const s = (seed += 3.7);
      const g = organic(new THREE.CylinderGeometry(r1, r0, len, 10, Math.max(4, Math.round(len * 18))), (p) => {
        const k = 1 + noise3(p.y * 12 + s, p.x * 25, p.z * 25) * knots;
        p.x *= k;
        p.z *= k * 0.85;
        p.x += noise3(p.y * 3 + s, 0, 0) * r0 * 0.6; // slight bowing — nothing is straight
      }, s);
      g.translate(0, -len / 2, 0);
      const mesh = new THREE.Mesh(g, m.skin);
      mesh.castShadow = true;
      return mesh;
    };
    const knuckle = (r: number, sx = 1, sy = 0.8, sz = 1) => {
      const s = (seed += 1.3);
      const g = organic(new THREE.SphereGeometry(r, 10, 8), (p) => p.addScaledVector(p.clone().normalize(), noise3(p.x * 40 + s, p.y * 40, p.z * 40) * r * 0.25), s);
      const k = new THREE.Mesh(g, m.skin);
      k.scale.set(sx, sy, sz);
      k.castShadow = true;
      return k;
    };
    const hand = (parent: THREE.Group, fingerLen: number, count: number): THREE.Group[] => {
      const palm = knuckle(0.03, 1.1, 1.6, 0.45);
      palm.position.y = -0.04;
      parent.add(palm);
      const fingers: THREE.Group[] = [];
      for (let f = 0; f < count; f++) {
        const fg = new THREE.Group();
        fg.position.set((f - (count - 1) / 2) * 0.016, -0.085, 0);
        const len = fingerLen * (1 - Math.abs(f - (count - 1) * 0.45) * 0.12);
        const segs = [0.4, 0.33, 0.27];
        let parentJ: THREE.Group = fg;
        segs.forEach((k, si) => {
          const seg = limb(len * k, 0.008 - si * 0.002, 0.006 - si * 0.002, 0.25);
          parentJ.add(seg);
          const j = new THREE.Group();
          j.position.y = -len * k;
          j.rotation.x = 0.25 + si * 0.1;
          parentJ.add(j);
          parentJ = j;
        });
        parent.add(fg);
        fingers.push(fg);
      }
      return fingers;
    };

    this.root.add(this.body);
    this.body.scale.setScalar(SCALE);
    this.body.add(this.hips);
    this.hips.add(this.spineLow);

    // ── torso: long, thin, curved; ribs show through ─────────
    const lowGeo = organic(new THREE.CapsuleGeometry(0.1, 0.3, 8, 14), (p) => {
      const waist = 1 - 0.3 * Math.exp(-((p.y - 0.05) ** 2) / 0.01);
      p.x *= waist * 1.25;
      p.z *= waist * 0.75;
    }, 11);
    const low = new THREE.Mesh(lowGeo, m.skin);
    low.position.y = 0.2;
    low.castShadow = true;
    const pelvis = knuckle(0.12, 1.3, 0.55, 0.8);
    this.spineLow.add(low, pelvis);
    this.spineHigh.position.y = 0.36;
    this.spineLow.add(this.spineHigh);
    const chestGeo = organic(new THREE.CapsuleGeometry(0.12, 0.38, 10, 18), (p) => {
      const y = p.y;
      const ribs = p.z > -0.02 && y > -0.2 && y < 0.2 ? 1 + 0.1 * Math.max(0, Math.sin((y + 0.2) * 48)) : 1;
      const sternum = p.z > 0 ? 1 - 0.12 * Math.exp(-(p.x * p.x) / 0.002) : 1; // sunken breastbone
      const cage = 1 + 0.15 * Math.exp(-((y - 0.05) ** 2) / 0.03);
      p.x *= cage * ribs * 1.2;
      p.z *= cage * ribs * sternum * (p.z < 0 ? 0.75 : 0.9);
      p.x += y * 0.06; // the ribcage itself is crooked
    }, 23);
    const chest = new THREE.Mesh(chestGeo, m.skin);
    chest.position.y = 0.26;
    chest.castShadow = true;
    this.spineHigh.add(chest);
    // spine ridge down the back (both segments)
    for (let i = 0; i < 12; i++) {
      const v = knuckle(0.022 - i * 0.0008, 1, 0.7, 1.4);
      const onHigh = i >= 5;
      v.position.set(0, onHigh ? (i - 5) * 0.075 + 0.02 : i * 0.075 + 0.02, onHigh ? -0.105 : -0.085);
      (onHigh ? this.spineHigh : this.spineLow).add(v);
    }

    // ── neck: long, three kinked segments ───────────────────
    let parent: THREE.Group = this.spineHigh;
    const neckBase = new THREE.Group();
    neckBase.position.set(0.02, 0.5, 0.05);
    parent.add(neckBase);
    parent = neckBase;
    for (let i = 0; i < 3; i++) {
      const j = new THREE.Group();
      if (i > 0) j.position.y = 0.17;
      const seg = limb(0.17, 0.042 - i * 0.003, 0.038 - i * 0.003, 0.22);
      seg.rotation.x = Math.PI;
      j.add(seg);
      parent.add(j);
      this.neck.push(j);
      this.neckMeshes.push(seg);
      parent = j;
    }
    this.head.position.y = 0.17;
    parent.add(this.head);

    // ── head: lopsided, faceless; splits open only at the end ──
    const R = 0.14;
    const skullFn = (p: THREE.Vector3) => {
      const d = p.clone().normalize();
      // sunken, flat dead face
      if (d.z > 0.25) {
        const k = (d.z - 0.25) / 0.75;
        p.z = THREE.MathUtils.lerp(p.z, R * 0.42, k);
        p.z -= 0.022 * Math.exp(-((d.y - 0.1) ** 2 + d.x * d.x) / 0.08); // hollow
      }
      // swollen back of the skull, pushed to one side
      if (d.z < 0) p.addScaledVector(d, -d.z * 0.05 + Math.max(0, d.x) * 0.03);
      // crushed in on the other side
      if (d.x < -0.4) p.x *= 0.82;
      p.x += p.y * 0.35; // the whole skull is skewed
      p.addScaledVector(d, noise3(d.x * 3.5 + 5, d.y * 3.5, d.z * 3.5) * 0.028 + noise3(d.x * 12, d.y * 12, d.z * 12) * 0.006);
    };
    const hinge = new THREE.Vector3(0, 0, -R * 0.7);
    for (const side of [-1, 1]) {
      const half = side < 0 ? this.halfL : this.halfR;
      half.position.copy(hinge);
      const geo = organic(new THREE.SphereGeometry(R, 40, 30, side < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), skullFn, 41);
      geo.translate(-hinge.x, -hinge.y, -hinge.z);
      const outer = new THREE.Mesh(geo, m.skin);
      outer.castShadow = true;
      const inner = new THREE.Mesh(geo.clone().scale(0.96, 0.96, 0.96), m.flesh);
      half.add(outer, inner);
      const teeth: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 16; i++) {
        const th = 0.3 + (i / 15) * (Math.PI - 0.6);
        const y = Math.cos(th) * R, z = Math.sin(th) * R;
        const len = 0.022 + Math.abs(Math.sin(i * 2.7)) * 0.016;
        for (const [r, s, depth] of [[0.006, 1, 0.94], [0.004, 0.7, 0.78]] as const) {
          const t = new THREE.ConeGeometry(r, len * s, 5);
          t.rotateZ(side * Math.PI / 2 + Math.sin(i * 5.1) * 0.25);
          // follow the deformed skull: same skew, and stay behind the flattened face
          const ty = y * depth;
          const tz = Math.min(z * depth, R * 0.3);
          t.translate(-side * len * s * 0.45 + ty * 0.35, ty, tz);
          teeth.push(t);
        }
      }
      const teethMesh = new THREE.Mesh(mergeGeometries(teeth), m.teeth);
      teethMesh.geometry.translate(-hinge.x, -hinge.y, -hinge.z);
      half.add(teethMesh);
      this.head.add(half);
    }
    const throat = new THREE.Mesh(new THREE.SphereGeometry(R * 0.5, 14, 10), m.flesh);
    throat.position.set(0, -0.01, -0.03);
    throat.scale.set(0.5, 1.5, 0.8);
    this.head.add(throat);
    this.head.scale.set(1.05, 1.7, 1.3);

    // ── arms: asymmetric ─────────────────────────────────────
    {
      // right: low, set back, absurdly long with an extra joint
      const shoulder = new THREE.Group();
      shoulder.position.set(-0.17, 0.4, -0.01);
      const elbow = new THREE.Group(); elbow.position.y = -0.7;
      const extra = new THREE.Group(); extra.position.y = -0.66;
      const wrist = new THREE.Group(); wrist.position.y = -0.3;
      shoulder.add(knuckle(0.05), limb(0.7, 0.034, 0.024), elbow);
      elbow.add(knuckle(0.03), limb(0.66, 0.026, 0.02), extra);
      extra.add(knuckle(0.024, 1, 1.4, 1), limb(0.3, 0.02, 0.016), wrist);
      const fingers = hand(wrist, 0.36, 4);
      this.spineHigh.add(shoulder);
      this.longArm = { shoulder, elbow, extra, wrist, fingers };
    }
    {
      // left: high, hunched forward, short and folded tight
      const shoulder = new THREE.Group();
      shoulder.position.set(0.16, 0.52, 0.05);
      const elbow = new THREE.Group(); elbow.position.y = -0.36;
      const wrist = new THREE.Group(); wrist.position.y = -0.34;
      shoulder.add(knuckle(0.055, 1.2, 1, 1), limb(0.36, 0.03, 0.024), elbow);
      elbow.add(knuckle(0.034, 1, 1.3, 1), limb(0.34, 0.024, 0.018), wrist);
      const fingers = hand(wrist, 0.22, 4);
      this.spineHigh.add(shoulder);
      this.shortArm = { shoulder, elbow, wrist, fingers };
    }

    // ── legs: thin, long feet, knees never straighten ────────
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.085, 0, 0);
      const knee = new THREE.Group(); knee.position.y = -0.58;
      const ankle = new THREE.Group(); ankle.position.y = -0.62;
      hip.add(knuckle(0.055), limb(0.58, 0.052, 0.036), knee);
      knee.add(knuckle(0.042, 1, 1, 1.2), limb(0.62, 0.036, 0.022), ankle);
      const foot = organic(new THREE.BoxGeometry(0.055, 0.03, 0.27, 2, 1, 6), (p) => { p.x *= 1 - (p.z + 0.13) * 0.5; }, side);
      const fm = new THREE.Mesh(foot, m.skin);
      fm.position.set(0, -0.02, 0.09);
      fm.castShadow = true;
      ankle.add(fm);
      this.hips.add(hip);
      this.legs.push({ hip, knee, ankle });
    }

    const la = this.longArm, sa = this.shortArm;
    this.joints = [
      this.spineLow, this.spineHigh, ...this.neck, this.head, this.halfL, this.halfR,
      la.shoulder, la.elbow, la.extra, la.wrist, ...la.fingers,
      sa.shoulder, sa.elbow, sa.wrist, ...sa.fingers,
      ...this.legs.flatMap((l) => [l.hip, l.knee, l.ankle]),
    ];
    this.saved = this.joints.map((j) => j.rotation.clone());
  }

  /**
   * @param pos/yaw simulated transform (continuous)
   * @param viewer  local camera position
   * @param stared  the local player is looking straight at it
   */
  animate(dt: number, state: AIState, speed: number, headLook: number, attack: number,
    pos: THREE.Vector3, yaw: number, viewer: THREE.Vector3, stared: boolean): void {
    this.time += dt;
    const t = this.time;
    const chase = state === 'chase';
    const moving = speed > 0.15;
    const still = state === 'idle' || state === 'observe' || state === 'apparition' || state === 'lurk' || (!moving && attack === 0);

    // ── stop-motion while it moves; perfectly smooth while still ──
    this.stutterTimer -= dt;
    this.freezeTimer -= dt;
    let tick = still;
    if (!still && this.freezeTimer <= 0 && this.stutterTimer <= 0) {
      tick = true;
      this.stutterTimer = (chase || attack > 0 ? 1 / 14 : 1 / 9) * (0.7 + Math.random() * 0.6);
      if (Math.random() < (chase ? 0.05 : 0.04)) this.freezeTimer = 0.12 + Math.random() * 0.3;
    }
    if (!this.placed) { this.placed = true; tick = true; }
    if (tick) { this.shownPos.copy(pos); this.shownYaw = yaw; }
    this.root.position.copy(this.shownPos);
    this.root.rotation.y = this.shownYaw;
    this.duckK += (this.duck - this.duckK) * Math.min(1, dt * 5);

    // ── legs: stiff, hips level, one leg lagging ─────────────
    const stride = chase ? 1.7 : 1.05;
    this.phase += (speed / stride) * dt * Math.PI;
    const p = this.phase;
    const amp = Math.min(1, speed / (chase ? 5 : 1.6)) * (chase ? 0.85 : 0.4);
    const L = this.legs;
    L[0].hip.rotation.x = Math.sin(p) * amp - 0.18;
    L[1].hip.rotation.x = Math.sin(p + Math.PI + 0.55) * amp * 0.8 - 0.22;
    L[0].knee.rotation.x = 0.32 + (chase ? Math.max(0, -Math.sin(p - 0.5)) * amp * 1.4 : Math.max(0, -Math.sin(p)) * amp * 0.35);
    L[1].knee.rotation.x = 0.36 + (chase ? Math.max(0, -Math.sin(p + Math.PI - 0.2)) * amp * 1.1 : 0.05);
    L[0].ankle.rotation.x = -0.12;
    L[1].ankle.rotation.x = -0.1 + (moving && !chase ? 0.25 : 0); // dragged foot, toes down
    L[1].hip.rotation.z = -0.06;

    // ── posture ──────────────────────────────────────────────
    const rear = attack > 0 ? (attack < 0.6 ? attack / 0.6 : 1 - ((attack - 0.6) / 0.4) * 0.6) : 0;
    const strike = attack > 0.6 ? (attack - 0.6) / 0.4 : 0;
    // lurk: it bends down over you from behind
    const baseLean = chase ? 1.25 : state === 'stalk' ? 0.75 : state === 'lurk' ? 0.85 : 0.5;
    const targetLean = attack > 0 ? THREE.MathUtils.lerp(0.5, 0.05, rear) + strike * 0.55 : baseLean + this.duckK * 0.45;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * (attack > 0 ? 10 : chase ? 6 : 3));
    this.spineLow.rotation.x = this.lean * 0.55;
    this.spineHigh.rotation.x = this.lean * 0.45 + 0.18; // the curve never straightens
    // lurching side to side instead of a human hip sway
    this.spineLow.rotation.z = moving ? Math.sin(p) * (chase ? 0.06 : 0.11) : 0.03;
    this.spineHigh.rotation.z = -0.07 + (moving ? -Math.sin(p) * 0.05 : 0); // uneven shoulders
    this.spineHigh.rotation.y = 0.08;
    const hipY = 1.12 - (chase ? 0.14 : 0) - this.duckK * 0.3 + rear * 0.12 - strike * 0.2 +
      (moving ? Math.abs(Math.cos(p)) * 0.03 * amp : Math.sin(t * 0.9) * 0.004);
    this.body.position.z = strike * 0.5;

    // ── long arm: dead weight, fingers on the floor ──────────
    const la = this.longArm;
    if (attack > 0) {
      la.shoulder.rotation.set(-2.2 * rear - 0.6 * strike, 0, -0.9 * rear * (1 - strike) - 0.1);
      la.elbow.rotation.set(-0.5 * rear + 0.3 * strike, 0, 0.9 * strike);
      la.extra.rotation.set(-0.3 * rear, 0, 0.5 * strike);
    } else if (chase) {
      la.shoulder.rotation.set(-0.85 - this.lean * 0.45 + Math.sin(p * 0.5) * 0.18, 0, -0.18);
      la.elbow.rotation.set(-0.25, 0, 0);
      la.extra.rotation.set(0.35, 0, 0);
    } else {
      const sway = moving ? Math.sin(p * 0.5) * 0.06 : Math.sin(t * 0.5) * 0.015;
      la.shoulder.rotation.set(-this.lean * 0.98 + sway, 0, -0.05);
      la.elbow.rotation.set(0.18, 0, 0.05);   // hyperextended
      la.extra.rotation.set(-0.45, 0, -0.1);  // the wrong-way extra joint
    }
    la.wrist.rotation.set(chase ? 0.6 : 0.5, 0, 0);
    const laSplay = chase || attack > 0 ? 0.32 : 0.1;
    la.fingers.forEach((f, k) => { f.rotation.z = (k - 1.5) * laSplay; f.rotation.x = attack > 0 ? -0.3 * rear + 0.8 * strike : 0.15; });

    // ── short arm: folded tight, hand twitching at the chest ──
    const sa = this.shortArm;
    this.fingerTwitch -= dt;
    if (this.fingerTwitch < 0 && Math.random() < dt * 1.5) this.fingerTwitch = 0.12;
    const tw = this.fingerTwitch > 0 ? Math.sin(t * 80) * 0.25 : 0;
    if (attack > 0) {
      sa.shoulder.rotation.set(-1.6 * rear - 0.4 * strike, 0, 0.6 * rear);
      sa.elbow.rotation.set(-1.0 * (1 - strike), 0, 0);
    } else {
      sa.shoulder.rotation.set(-0.95 - this.lean * 0.3, 0.25, 0.35);
      sa.elbow.rotation.set(-2.45, 0.2, 0);  // folded far past what an elbow should do
    }
    sa.wrist.rotation.set(1.05 + tw, 0.4, 0);
    sa.fingers.forEach((f, k) => { f.rotation.x = 0.9 + tw * (k % 2 ? 1 : -1); f.rotation.z = (k - 1.5) * 0.12; });

    // ── neck & head ──────────────────────────────────────────
    // counter the body lean so the face plane stays on its target
    const counter = -this.lean * (chase ? 0.75 : state === 'lurk' ? 0.4 : 0.55);
    this.neck[0].rotation.set(0.45 + counter * 0.5 + (attack > 0 ? -0.5 * rear + 0.9 * strike : 0), 0, 0.1);
    this.neck[1].rotation.set(0.2 + counter * 0.3 + (attack > 0 ? 0.2 * strike : 0), 0, -0.22);
    this.neck[2].rotation.set(0.15 + counter * 0.2, 0, 0.18);
    const stretch = 1 + (attack > 0 ? 0.5 * rear + 2.2 * strike : chase ? 0.3 : state === 'lurk' ? 0.7 : 0);
    this.neckMeshes.forEach((n) => { n.scale.y = stretch; });
    this.neck[1].position.y = 0.17 * stretch;
    this.neck[2].position.y = 0.17 * stretch;
    this.head.position.y = 0.17 * stretch;

    // head yaw: slow scan when idle; follows whoever it watches when observing
    let wantYaw = this.headYaw;
    let wantTilt = 0.55;
    const local = this.root.worldToLocal(viewer.clone());
    const toViewer = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.5, 1.5);
    let turnRate = 2;
    if (state === 'idle' || state === 'patrol' || state === 'search' || state === 'investigate') {
      wantYaw = Math.sin(t * 0.32) * 0.9 + Math.sin(t * 0.11) * 0.3; // very slow scan
      turnRate = 1.2;
      if (stared && state === 'idle') { wantYaw = toViewer; turnRate = 0.8; }
    } else if (state === 'observe' || state === 'stalk' || state === 'apparition' || state === 'lurk') {
      wantYaw = toViewer;               // body stays put — only the head follows you
      wantTilt = 0.55 + headLook * 0.25 + (state === 'lurk' ? 0.35 : 0);
      turnRate = state === 'lurk' ? 0.6 : 1.4;
    } else {
      wantYaw = 0;
      wantTilt = chase ? 0.2 : 0.3;
      turnRate = 6;
    }
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * turnRate);
    this.headTilt += (wantTilt - this.headTilt) * Math.min(1, dt * 1.5);
    this.head.rotation.set(-0.25 - strike * 0.8, this.headYaw, this.headTilt * (1 - strike));

    // the head splits open only at the very end
    const screaming = headLook >= 2;
    const targetOpen = screaming ? 1 : attack > 0 ? 0.55 + 0.45 * rear : chase ? 0.18 + Math.max(0, Math.sin(t * 7)) * 0.2 : 0;
    this.open += (targetOpen - this.open) * Math.min(1, dt * 12);
    this.halfL.rotation.y = -this.open * 0.95;
    this.halfR.rotation.y = this.open * 0.95;

    // ── commit on ticks only (stop-motion) ───────────────────
    if (tick) {
      this.joints.forEach((j, i) => this.saved[i].copy(j.rotation));
      this.savedHips = hipY;
      this.savedStretch = stretch;
    } else {
      this.joints.forEach((j, i) => j.rotation.copy(this.saved[i]));
      this.neckMeshes.forEach((n) => { n.scale.y = this.savedStretch; });
      this.neck[1].position.y = this.neck[2].position.y = this.head.position.y = 0.17 * this.savedStretch;
    }
    this.hips.position.y = tick ? hipY : this.savedHips;
  }

  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return this.head.getWorldPosition(target);
  }

  dispose(): void {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
