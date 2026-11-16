import * as THREE from 'three';
import type { AIState } from '@shared/GameTypes';
import type { SceneAsset } from '../core/AssetManager';

/** What EntityManager needs from a creature body — implemented by ReceiverModel and WhispererModel. */
export interface CreatureModel {
  /** 'receiver' (procedural) or 'whisperer' (external model) */
  readonly kind: string;
  readonly root: THREE.Group;
  duck: number;
  animate(dt: number, state: AIState, speed: number, headLook: number, attack: number,
    pos: THREE.Vector3, yaw: number, viewer: THREE.Vector3, stared: boolean): void;
  headWorld(target?: THREE.Vector3): THREE.Vector3;
  decorate(kind: string, overall?: number): void;
  dispose(): void;
}

const HEIGHT = 2.7;          // design height (the AI's collider and door logic are unchanged)
const SRC_HEIGHT = 3.463;    // the Whisperer as published

/**
 * The main creature's body built from Polyfork's "The Whisperer" (CC BY 4.0,
 * modified). Only the look changes: the AI, movement, collider and network
 * state are exactly what drove the procedural Receiver.
 *
 * Kept from the Receiver's design:
 *  - faceless: the source head has no face; it is darkened and kept that way
 *  - the head split: triangles bound to the Head bone are cut out into two
 *    halves hinged at the back, opening on attack and fully on the scream,
 *    with wet flesh and teeth inside
 *  - stop-motion: the clips advance in irregular ticks with sudden freezes, so
 *    it never moves like a person
 *  - head tracking, the lunge, the folded ambush pose, stooping under doors
 */
export class WhispererModel implements CreatureModel {
  readonly kind = 'whisperer';
  readonly root = new THREE.Group();
  duck = 0;
  private scene: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private actions: Record<'Idle' | 'Walk' | 'Run', THREE.AnimationAction | null>;
  private bones = new Map<string, THREE.Bone>();
  private halves: THREE.Object3D[] = [];
  private inside: THREE.Object3D;
  private time = Math.random() * 100;
  private pending = 0;
  private stutter = 0;
  private freeze = 0;
  private shownPos = new THREE.Vector3();
  private shownYaw = 0;
  private placed = false;
  private headYaw = 0;
  private headTilt = 0;
  private open = 0;
  private duckK = 0;
  private crouchK = 0;
  private base = new Map<THREE.Bone, THREE.Quaternion>();
  private extraGeos: THREE.BufferGeometry[] = [];

  constructor(asset: SceneAsset, mats: { skin: THREE.Material; flesh: THREE.Material; teeth: THREE.Material }) {
    this.scene = asset.scene;
    this.scene.scale.setScalar(HEIGHT / SRC_HEIGHT);
    this.root.add(this.scene);
    this.scene.traverse((o) => { if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone); });
    let body: THREE.SkinnedMesh | null = null;
    this.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !body) body = o as THREE.SkinnedMesh; });
    if (!body) throw new Error('Whisperer: no skinned mesh');
    const skinned = body as THREE.SkinnedMesh;
    skinned.material = mats.skin;
    skinned.castShadow = true;
    skinned.frustumCulled = false; // bounds of a skinned mesh are the bind pose
    this.inside = new THREE.Group();
    this.splitHead(skinned, mats);
    this.mixer = new THREE.AnimationMixer(this.scene);
    const clip = (n: string) => asset.animations.find((a) => a.name === n) ?? null;
    this.actions = { Idle: null, Walk: null, Run: null };
    for (const n of ['Idle', 'Walk', 'Run'] as const) {
      const c = clip(n);
      if (!c) continue;
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
      this.actions[n] = a;
    }
    this.mixer.update(0);
    this.captureBase();
  }

  /** cut the Head-bound triangles out of the skin into two hinged halves */
  private splitHead(mesh: THREE.SkinnedMesh, mats: { flesh: THREE.Material; teeth: THREE.Material }): void {
    const head = this.bones.get('Head');
    if (!head) return;
    const geo = mesh.geometry;
    const headIdx = mesh.skeleton.bones.indexOf(head);
    const idx = geo.index;
    const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color;
    const ji = geo.attributes.skinIndex, jw = geo.attributes.skinWeight;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const vtx = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    const isHead = (v: number) => ji.getX(v) === headIdx && jw.getX(v) > 0.5;
    const toHead = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[headIdx], mesh.bindMatrix);
    const keep: number[] = [];
    const halves = [{ p: [] as number[], n: [] as number[], c: [] as number[] }, { p: [] as number[], n: [] as number[], c: [] as number[] }];
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const nrm = new THREE.Matrix3().getNormalMatrix(toHead);
    for (let t = 0; t < triCount; t++) {
      const a = vtx(t, 0), b = vtx(t, 1), c = vtx(t, 2);
      if (!(isHead(a) && isHead(b) && isHead(c))) { keep.push(a, b, c); continue; }
      let cx = 0;
      const pts = [a, b, c].map((i) => { v.fromBufferAttribute(pos, i).applyMatrix4(toHead); cx += v.x; return v.clone(); });
      const side = halves[cx < 0 ? 0 : 1];
      [a, b, c].forEach((i, k) => {
        side.p.push(pts[k].x, pts[k].y, pts[k].z);
        n.fromBufferAttribute(nor, i).applyMatrix3(nrm).normalize();
        side.n.push(n.x, n.y, n.z);
        if (col) side.c.push(col.getX(i), col.getY(i), col.getZ(i));
      });
    }
    if (!halves[0].p.length || !halves[1].p.length) return; // nothing bound to the head: keep the original
    geo.setIndex(keep);
    // hinge at the back of the skull
    const all = new THREE.Box3();
    for (const h of halves) for (let i = 0; i < h.p.length; i += 3) all.expandByPoint(v.set(h.p[i], h.p[i + 1], h.p[i + 2]));
    const hinge = new THREE.Vector3((all.min.x + all.max.x) / 2, (all.min.y + all.max.y) / 2, all.min.z);
    const skinMat = mesh.material as THREE.Material;
    halves.forEach((h, side) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(h.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(h.n, 3));
      if (h.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(h.c, 3));
      g.translate(-hinge.x, -hinge.y, -hinge.z);
      this.extraGeos.push(g);
      const pivot = new THREE.Group();
      pivot.position.copy(hinge);
      const m = new THREE.Mesh(g, skinMat);
      m.castShadow = true;
      pivot.add(m);
      // teeth along the inner edge of each half, pointing across the split
      const size = all.getSize(new THREE.Vector3());
      for (let k = 0; k < 7; k++) {
        const tg = new THREE.ConeGeometry(size.x * 0.035, size.x * 0.22, 5);
        this.extraGeos.push(tg);
        const tooth = new THREE.Mesh(tg, mats.teeth);
        const y = (k / 6 - 0.5) * size.y * 0.75;
        tooth.position.set((all.min.x + all.max.x) / 2 - hinge.x + (side ? 0.004 : -0.004), y, size.z * (0.35 + 0.5 * Math.abs(Math.sin(k * 1.3))));
        tooth.rotation.z = side ? Math.PI / 2 : -Math.PI / 2;
        pivot.add(tooth);
      }
      head.add(pivot);
      this.halves.push(pivot);
    });
    // wet flesh behind the split, only visible when it opens
    const size = all.getSize(new THREE.Vector3());
    const fg = new THREE.SphereGeometry(1, 14, 10);
    this.extraGeos.push(fg);
    const flesh = new THREE.Mesh(fg, mats.flesh);
    flesh.scale.set(size.x * 0.32, size.y * 0.45, size.z * 0.42);
    flesh.position.copy(all.getCenter(new THREE.Vector3()));
    this.inside.add(flesh);
    this.inside.visible = false;
    head.add(this.inside);
  }

  private captureBase(): void {
    for (const n of ['Head', 'Neck', 'Spine', 'Spine1', 'Spine2', 'RightArm', 'RightForeArm', 'LeftArm', 'Hips']) {
      const b = this.bones.get(n);
      if (b) this.base.set(b, b.quaternion.clone());
    }
  }

  animate(dt: number, state: AIState, speed: number, headLook: number, attack: number,
    pos: THREE.Vector3, yaw: number, viewer: THREE.Vector3, stared: boolean): void {
    this.time += dt;
    const t = this.time;
    const chase = state === 'chase';
    const moving = speed > 0.15;
    const still = state === 'idle' || state === 'observe' || state === 'apparition' || state === 'lurk' || (!moving && attack === 0);
    const crouched = state === 'ambush' && !moving;

    // stop-motion: the clips only advance on irregular ticks, with sudden freezes
    this.pending += dt;
    this.stutter -= dt;
    this.freeze -= dt;
    let tick = still;
    if (!still && this.freeze <= 0 && this.stutter <= 0) {
      tick = true;
      this.stutter = (chase || attack > 0 ? 1 / 14 : 1 / 9) * (0.7 + Math.random() * 0.6);
      if (Math.random() < (chase ? 0.05 : 0.04)) this.freeze = 0.12 + Math.random() * 0.3;
    }
    if (!this.placed) { this.placed = true; tick = true; }
    if (tick) {
      // clip blend by ground speed
      const run = chase || speed > 3.6 ? THREE.MathUtils.clamp((speed - 2.5) / 2, 0, 1) : 0;
      const walk = moving ? 1 - run : 0;
      const idle = moving ? 0 : 1;
      this.actions.Idle?.setEffectiveWeight(idle);
      this.actions.Walk?.setEffectiveWeight(walk);
      this.actions.Run?.setEffectiveWeight(run);
      if (this.actions.Walk) this.actions.Walk.timeScale = THREE.MathUtils.clamp(speed / 1.4, 0.4, 1.8);
      if (this.actions.Run) this.actions.Run.timeScale = THREE.MathUtils.clamp(speed / 5, 0.6, 1.5);
      if (this.actions.Idle) this.actions.Idle.timeScale = state === 'lurk' || state === 'apparition' ? 0.25 : 0.7;
      this.mixer.update(this.pending);
      this.pending = 0;
      this.captureBase();
      this.shownPos.copy(pos);
      this.shownYaw = yaw;
    }
    this.root.position.copy(this.shownPos);
    this.root.rotation.y = this.shownYaw;

    // procedural layer on top of the clip pose (re-applied from the captured pose every frame)
    for (const [b, q] of this.base) b.quaternion.copy(q);
    const add = (name: string, x: number, y = 0, z = 0) => {
      const b = this.bones.get(name);
      if (b) b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
    };
    // head: slow scan, or locked on whoever it watches
    const local = this.root.worldToLocal(viewer.clone());
    const toViewer = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.4, 1.4);
    let wantYaw = 0, wantTilt = 0, rate = 2;
    if (state === 'idle' || state === 'patrol' || state === 'search' || state === 'investigate') {
      wantYaw = Math.sin(t * 0.32) * 0.8 + Math.sin(t * 0.11) * 0.3; rate = 1.2;
      if (stared && state === 'idle') { wantYaw = toViewer; rate = 0.8; }
    } else if (state === 'observe' || state === 'stalk' || state === 'apparition' || state === 'lurk') {
      wantYaw = toViewer; wantTilt = 0.25 + headLook * 0.15 + (state === 'lurk' ? 0.35 : 0); rate = state === 'lurk' ? 0.6 : 1.4;
    } else if (crouched) { wantTilt = 0.4; rate = 0.5; }
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * rate);
    this.headTilt += (wantTilt - this.headTilt) * Math.min(1, dt * 1.5);
    add('Neck', this.headTilt * 0.4, this.headYaw * 0.4, 0);
    add('Head', this.headTilt * 0.6, this.headYaw * 0.6, Math.sin(t * 0.7) * 0.05 + (state === 'lurk' ? 0.35 : 0));
    // the lunge: rear back, then the long right arm comes down
    if (attack > 0) {
      const rear = attack < 0.45 ? attack / 0.45 : Math.max(0, 1 - (attack - 0.45) / 0.15);
      const strike = attack < 0.45 ? 0 : Math.min(1, (attack - 0.45) / 0.1) * (1 - Math.max(0, (attack - 0.8) / 0.2));
      add('Spine1', -0.25 * rear + 0.55 * strike);
      add('RightArm', 0, 0, -1.4 * rear + 1.6 * strike);
      add('RightForeArm', 0, -0.8 * rear, 0);
    } else if (chase) {
      add('Spine1', 0.35); add('Spine2', 0.15);
    }
    // folded low behind a corner (ambush), and stooping through doorways
    this.crouchK += ((crouched ? 1 : 0) - this.crouchK) * Math.min(1, dt * 3);
    this.duckK += (this.duck - this.duckK) * Math.min(1, dt * 5);
    const bend = this.crouchK * 0.9 + this.duckK * 0.75;
    if (bend > 0.001) { add('Spine', bend * 0.45); add('Spine1', bend * 0.5); add('Spine2', bend * 0.35); add('Neck', -bend * 0.5); }
    this.scene.position.y = -this.crouchK * 0.55 - this.duckK * 0.2;

    // the head splits open only at the very end
    const screaming = headLook >= 2;
    const rear = attack > 0 ? (attack < 0.45 ? attack / 0.45 : Math.max(0, 1 - (attack - 0.45) / 0.15)) : 0;
    const targetOpen = screaming ? 1 : attack > 0 ? 0.55 + 0.45 * rear : chase ? 0.15 + Math.max(0, Math.sin(t * 7)) * 0.2 : 0;
    this.open += (targetOpen - this.open) * Math.min(1, dt * 12);
    if (this.halves.length === 2) {
      this.halves[0].rotation.y = -this.open * 0.95;
      this.halves[1].rotation.y = this.open * 0.95;
    }
    this.inside.visible = this.open > 0.04;
  }

  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    const h = this.bones.get('Head');
    return h ? h.getWorldPosition(target) : this.root.getWorldPosition(target).setY(HEIGHT - 0.3);
  }

  /** per-level variants are the Receiver's job; here only size and a tint */
  /**
   * A group riding on a bone, with its axes and scale matching the creature's
   * own frame in the rest pose (+y up, +z forward, 1 unit = 1 m at design
   * height) — so accessories can be placed by eye and still follow the animation.
   */
  private anchor(bone: string): THREE.Group | null {
    const b = this.bones.get(bone);
    if (!b) return null;
    this.root.updateMatrixWorld(true);
    const bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bp = new THREE.Vector3();
    b.matrixWorld.decompose(bp, bq, bs);
    const rq = new THREE.Quaternion(), rs = new THREE.Vector3(), rp = new THREE.Vector3();
    this.root.matrixWorld.decompose(rp, rq, rs);
    const g = new THREE.Group();
    g.quaternion.copy(bq).invert().multiply(rq);
    g.scale.setScalar(rs.x / bs.x);
    b.add(g);
    return g;
  }

  /** the faceless head's centre and size in the head anchor's frame */
  private headBox(anchor: THREE.Group): { c: THREE.Vector3; s: THREE.Vector3 } {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const h of this.halves) box.expandByObject(h);
    if (box.isEmpty()) return { c: new THREE.Vector3(0, 0.12, 0.04), s: new THREE.Vector3(0.24, 0.3, 0.26) };
    const inv = anchor.matrixWorld.clone().invert();
    const lb = box.clone().applyMatrix4(inv);
    return { c: lb.getCenter(new THREE.Vector3()), s: lb.getSize(new THREE.Vector3()) };
  }

  /**
   * Levels 3–10: the same body, dressed for the level it haunts. Accessories ride
   * on the bones (head, chest, back, hands) and so move with every clip.
   */
  decorate(kind: string, overall = 1): void {
    this.root.scale.setScalar(overall);
    if (!kind) return;
    const geo = <T extends THREE.BufferGeometry>(g: T) => { this.extraGeos.push(g); return g; };
    const mat = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    const add = (parent: THREE.Object3D | null, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      if (!parent) return null;
      const mesh = new THREE.Mesh(geo(g), m);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true;
      parent.add(mesh); return mesh;
    };
    const rnd = (k: number) => Math.abs((Math.sin(k * 91.7) * 43758.5) % 1);
    const head = this.anchor('Head');
    const chest = this.anchor('Spine2') ?? this.anchor('Spine1');
    const back = this.anchor('Spine1') ?? chest;
    const hand = this.anchor('RightHand') ?? this.anchor('RightForeArm');
    const fore = this.anchor('RightForeArm');
    const foreL = this.anchor('LeftForeArm');
    const hb = head ? this.headBox(head) : { c: new THREE.Vector3(), s: new THREE.Vector3(0.24, 0.3, 0.26) };
    const top = hb.c.y + hb.s.y / 2 - 0.05, front = hb.c.z + hb.s.z / 2;
    if (kind === 'pages') {
      // THE INDEXER: index cards and torn pages pinned into its back, shoulders and arms; a card over the blank face
      const paper = mat(0xd8cdb0, { side: THREE.DoubleSide, roughness: 0.95 });
      const ink = mat(0xb8ac8c, { side: THREE.DoubleSide, roughness: 0.95 });
      for (let i = 0; i < 26; i++) {
        const g = new THREE.PlaneGeometry(0.12 + rnd(i) * 0.08, 0.16 + rnd(i + 3) * 0.07);
        const on = i < 14 ? chest : i < 20 ? back : i % 2 ? fore : foreL;
        add(on, g, i % 3 ? paper : ink, (rnd(i + 7) - 0.5) * 0.34, (rnd(i + 11) - 0.3) * 0.4, -0.1 - rnd(i + 5) * 0.06, -0.5 + rnd(i) * 1, rnd(i + 2) * 0.8 + Math.PI, rnd(i + 9) * 1.4);
      }
      add(head, new THREE.PlaneGeometry(hb.s.x * 0.7, hb.s.y * 0.55), paper, hb.c.x, hb.c.y, front + 0.012, 0, 0, 0.12);
    } else if (kind === 'bell') {
      // THE BELLMAN: a bellhop's red jacket with brass buttons, a pillbox cap, a service bell lodged in the throat
      const brass = mat(0xb08a3a, { metalness: 0.85, roughness: 0.3 });
      const red = mat(0x6a1612, { roughness: 0.7, side: THREE.DoubleSide });
      add(chest, new THREE.CylinderGeometry(0.2, 0.24, 0.5, 18, 1, true), red, 0, -0.05, 0, 0, 0, 0);
      for (let i = 0; i < 5; i++) add(chest, new THREE.SphereGeometry(0.016, 8, 6), brass, 0.06, 0.14 - i * 0.08, 0.235);
      for (const s of [-1, 1]) add(chest, new THREE.BoxGeometry(0.1, 0.03, 0.12), brass, s * 0.22, 0.2, 0);
      add(head, new THREE.CylinderGeometry(hb.s.x * 0.42, hb.s.x * 0.46, 0.08, 18), red, hb.c.x, top + 0.02, hb.c.z, -0.15, 0, 0.12);
      add(head, new THREE.CylinderGeometry(hb.s.x * 0.47, hb.s.x * 0.47, 0.012, 18), brass, hb.c.x, top - 0.015, hb.c.z, -0.15, 0, 0.12);
      add(head, new THREE.SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), brass, hb.c.x, hb.c.y - hb.s.y * 0.6, front - 0.02, Math.PI * 0.9, 0, 0);
    } else if (kind === 'curtain') {
      // CURTAIN WALKER: a hospital privacy curtain hung from its shoulders, rings still on, dragging past the knees
      const cloth = mat(0xa9b8b0, { side: THREE.DoubleSide, roughness: 0.9 });
      const g = new THREE.CylinderGeometry(0.22, 0.4, 1.5, 22, 10, true, Math.PI * 0.12, Math.PI * 1.76);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const k = 1 + Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 9) * 0.07 * (0.75 - y); pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
      g.computeVertexNormals();
      add(chest, g, cloth, 0, -0.62, -0.02, 0, Math.PI, 0);
      const ring = mat(0x9a9a9a, { metalness: 0.85, roughness: 0.3 });
      for (let i = 0; i < 8; i++) { const a = Math.PI * 0.2 + i * 0.2; add(chest, new THREE.TorusGeometry(0.02, 0.005, 6, 12), ring, Math.cos(a) * 0.22, 0.13, -Math.sin(a) * 0.16, Math.PI / 2, 0, 0); }
      // a strip of the same cloth bound over the face
      add(head, new THREE.CylinderGeometry(hb.s.x * 0.56, hb.s.x * 0.56, hb.s.y * 0.22, 16, 1, true), cloth, hb.c.x, hb.c.y + hb.s.y * 0.05, hb.c.z, 0, 0, 0);
    } else if (kind === 'drowned') {
      // THE DROWNED: waterlogged, weed and silt hanging off its arms and shoulders, hair plastered down
      const weed = mat(0x23331f, { side: THREE.DoubleSide, roughness: 0.4 });
      const silt = mat(0x2c2a22, { roughness: 1 });
      for (let i = 0; i < 18; i++) {
        const on = i % 3 === 0 ? chest : i % 3 === 1 ? fore : foreL;
        add(on, new THREE.PlaneGeometry(0.035, 0.3 + rnd(i) * 0.4), weed, (rnd(i + 1) - 0.5) * 0.22, -0.15 - rnd(i + 2) * 0.15, (rnd(i + 4) - 0.5) * 0.2, 0.1, rnd(i) * 3, 0.15);
      }
      for (let i = 0; i < 22; i++) {
        const a = rnd(i + 30) * Math.PI * 2;
        add(head, new THREE.PlaneGeometry(0.025, hb.s.y * (0.6 + rnd(i) * 0.6)), weed, hb.c.x + Math.cos(a) * hb.s.x * 0.45, top - hb.s.y * 0.35, hb.c.z + Math.sin(a) * hb.s.z * 0.45 - 0.02, 0.05, -a, 0);
      }
      for (let i = 0; i < 6; i++) add(chest, new THREE.SphereGeometry(0.04 + rnd(i) * 0.04, 8, 6), silt, (rnd(i + 8) - 0.5) * 0.3, (rnd(i + 9) - 0.5) * 0.3, 0.12 + rnd(i) * 0.04);
    } else if (kind === 'lantern') {
      // THE CONDUCTOR: a long black coat, a peaked cap with a brass badge, a railway lantern in the long hand
      const coat = mat(0x14161c, { side: THREE.DoubleSide, roughness: 0.75 });
      const g = new THREE.CylinderGeometry(0.21, 0.38, 1.35, 20, 6, true, Math.PI * 0.08, Math.PI * 1.84);
      g.computeVertexNormals();
      add(chest, g, coat, 0, -0.55, 0, 0, Math.PI, 0);
      for (const s of [-1, 1]) add(chest, new THREE.BoxGeometry(0.12, 0.3, 0.02), coat, s * 0.1, 0.05, 0.22, 0.1, s * 0.25, 0);
      add(head, new THREE.CylinderGeometry(hb.s.x * 0.5, hb.s.x * 0.52, 0.09, 18), coat, hb.c.x, top + 0.025, hb.c.z, -0.2, 0, 0);
      add(head, new THREE.BoxGeometry(hb.s.x * 0.9, 0.014, 0.1), mat(0x0c0c10, { roughness: 0.4 }), hb.c.x, top - 0.01, front + 0.02, -0.2, 0, 0);
      add(head, new THREE.CircleGeometry(0.022, 12), mat(0xb08a3a, { metalness: 0.9, roughness: 0.3 }), hb.c.x, top + 0.03, front - 0.005, -0.2, 0, 0);
      if (hand) {
        const lamp = new THREE.Group();
        lamp.position.set(0, -0.12, 0);
        hand.add(lamp);
        add(lamp, new THREE.TorusGeometry(0.05, 0.006, 6, 14, Math.PI), mat(0x2a2a2a, { metalness: 0.7 }), 0, 0, 0, 0, 0, 0);
        add(lamp, new THREE.CylinderGeometry(0.07, 0.085, 0.03, 10), mat(0x2a2a2a, { metalness: 0.7 }), 0, -0.07, 0);
        add(lamp, new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10, 1, true), mat(0xffc070, { emissive: 0xff9a30, emissiveIntensity: 1.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), 0, -0.16, 0);
        add(lamp, new THREE.CylinderGeometry(0.085, 0.075, 0.035, 10), mat(0x2a2a2a, { metalness: 0.7 }), 0, -0.26, 0);
      }
    } else if (kind === 'fins') {
      // THE UNDERTOW: a ridge of translucent fins down the spine and forearms, gill slits at the neck
      const fin = mat(0x1a2a30, { side: THREE.DoubleSide, roughness: 0.25, transparent: true, opacity: 0.85 });
      const finGeo = (h: number) => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(h * 0.3, h * 0.6, -h * 0.25, h); sh.lineTo(-h * 0.4, 0); return new THREE.ShapeGeometry(sh); };
      for (let i = 0; i < 8; i++) add(i < 5 ? chest : back, finGeo(0.16 + (i % 3) * 0.06), fin, 0, 0.18 - (i % 5) * 0.09, -0.15, 0, Math.PI / 2, 0.3);
      for (const f of [fore, foreL]) for (let i = 0; i < 4; i++) add(f, finGeo(0.1), fin, 0, -0.05 - i * 0.07, -0.04, 0, Math.PI / 2, 0.5);
      const gill = mat(0x3a0e0c, { roughness: 0.3 });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) add(head, new THREE.BoxGeometry(0.006, 0.05, 0.02), gill, hb.c.x + s * hb.s.x * 0.48, hb.c.y - hb.s.y * 0.35 - i * 0.025, hb.c.z, 0, 0, s * 0.3);
    } else if (kind === 'eyes') {
      // THE OBSERVER: a cluster of camera lenses pushed out through the blank face, glowing red
      const lens = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.4, emissive: 0xff1a0a, emissiveIntensity: 1.1 });
      const rim = mat(0x30353a, { metalness: 0.75, roughness: 0.35 });
      for (let i = 0; i < 17; i++) {
        const a = i * 2.4, r = (0.012 + (i % 6) * 0.017) * (hb.s.x / 0.28);
        const sz = 0.017 + (i % 4) * 0.005;
        add(head, new THREE.CylinderGeometry(sz, sz * 1.2, 0.04, 12), rim, hb.c.x + Math.cos(a) * r, hb.c.y + Math.sin(a) * r * 1.2, front - 0.005, Math.PI / 2, 0, 0);
        add(head, new THREE.SphereGeometry(sz * 0.85, 12, 8), lens, hb.c.x + Math.cos(a) * r, hb.c.y + Math.sin(a) * r * 1.2, front + 0.016);
      }
      // a coil of cable from the back of the skull into the spine
      const cable = mat(0x101214, { roughness: 0.5 });
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(hb.c.x, hb.c.y, hb.c.z - hb.s.z * 0.45), new THREE.Vector3(0.05, hb.c.y - 0.15, hb.c.z - hb.s.z * 0.8), new THREE.Vector3(-0.02, hb.c.y - 0.35, hb.c.z - hb.s.z * 0.6)]);
      add(head, new THREE.TubeGeometry(curve, 16, 0.014, 6), cable, 0, 0, 0);
    } else if (kind === 'antenna') {
      // RECEIVER PRIME: antennae and wire growing out of the skull and spine, red beacons at their tips
      const wire = mat(0x3a3530, { metalness: 0.75, roughness: 0.35 });
      const beacon = new THREE.MeshBasicMaterial({ color: 0xff2010 });
      for (let i = 0; i < 6; i++) {
        const len = 0.55 + i * 0.12, tilt = -0.35 + i * 0.13, lean = (i - 2.5) * 0.22;
        const x = hb.c.x + (i - 2.5) * 0.045, y = top - 0.02;
        add(head, new THREE.CylinderGeometry(0.007, 0.015, len, 6), wire, x + Math.sin(-lean) * len / 2, y + Math.cos(lean) * len / 2, hb.c.z + Math.sin(tilt) * len / 2, tilt, 0, lean);
        add(head, new THREE.SphereGeometry(0.026, 8, 6), beacon, x + Math.sin(-lean) * len, y + Math.cos(lean) * len, hb.c.z + Math.sin(tilt) * len);
      }
      for (let i = 0; i < 5; i++) add(chest, new THREE.CylinderGeometry(0.006, 0.011, 0.55, 6), wire, (i - 2) * 0.07, 0.3, -0.16, -0.6, 0, (i - 2) * 0.3);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.extraGeos.forEach((g) => g.dispose());
    this.root.removeFromParent();
  }
}
