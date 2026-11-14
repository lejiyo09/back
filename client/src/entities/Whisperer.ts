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
  decorate(_kind: string, overall = 1): void {
    this.root.scale.setScalar(overall);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.extraGeos.forEach((g) => g.dispose());
    this.root.removeFromParent();
  }
}
