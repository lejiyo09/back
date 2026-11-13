import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD } from '@shared/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable } from './Interactable';
import { gridPoint, type Level0Data } from '../world/Level0Layout';

export const STAIR_OPENING = 1.4;
export const STAIR_HEIGHT = 2.4;
const SHAFT_W = 2.0, LANDING = 1.4, RISE = 2.4, RUN = 3.6, BOTTOM = 2.2, CEIL = 2.9;

function signTexture(lit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#0d5a2a' : '#141814';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = lit ? '#d8ffe2' : '#3a443c';
  g.font = 'bold 30px monospace';
  g.fillText('B3 ↓', 18, 42);
  g.font = 'bold 22px sans-serif';
  g.fillText('비상 계단', 120, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Level 1's way out: a fire stairwell in the south wall, dead until both breakers
 * are thrown. Beyond the doors the stairs go down toward Level 2's pipe corridors;
 * walking down them ends the chapter.
 */
export class Stairwell {
  readonly root = new THREE.Group();
  readonly buttons: Interactable[] = [];
  readonly colliders: RAPIER.Collider[] = [];
  powered = false;
  open = false;
  ending = 0;
  blackout = false;
  readonly center: THREE.Vector3;
  private readonly wallZ: number;
  private doors: { mesh: THREE.Mesh; body: RAPIER.RigidBody; dir: number }[] = [];
  private doorOffset = 0;
  private sign: THREE.Mesh;
  private signLit = false;
  private lights: THREE.PointLight[] = [];

  constructor(level: Level0Data, physics: PhysicsWorld, mats: { concrete: THREE.Material; steel: THREE.Material; rail: THREE.Material }) {
    const p0 = gridPoint(level, level.exit.cx, level.h);
    const p1 = gridPoint(level, level.exit.cx + 1, level.h);
    const cx = (p0.x + p1.x) / 2;
    this.wallZ = p0.z;
    const T = WORLD.WALL_THICKNESS;
    const z0 = this.wallZ + T / 2;
    this.center = new THREE.Vector3(cx, 0, z0 + LANDING / 2);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, collide = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      if (collide) this.colliders.push(physics.addStaticBox(x, y, z, w / 2, h / 2, d / 2));
      return mesh;
    };
    const zEnd = z0 + LANDING + RUN + BOTTOM;
    // top landing, ramp (physics) + visual steps, bottom landing
    box(SHAFT_W, 0.2, LANDING, cx, -0.1, z0 + LANDING / 2, mats.concrete);
    const a = Math.atan2(RISE, RUN);
    const len = Math.hypot(RISE, RUN);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const mid = new THREE.Vector3(cx, -RISE / 2, z0 + LANDING + RUN / 2).addScaledVector(n, -0.1);
    this.colliders.push(physics.addStaticBoxRotated(mid.x, mid.y, mid.z, SHAFT_W / 2, 0.1, len / 2, q));
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const top = -(i + 1) * (RISE / steps);
      box(SHAFT_W, RISE / steps, RUN / steps, cx, top + RISE / steps / 2, z0 + LANDING + (i + 0.5) * (RUN / steps), mats.concrete, false);
    }
    box(SHAFT_W, 0.2, BOTTOM, cx, -RISE - 0.1, z0 + LANDING + RUN + BOTTOM / 2, mats.concrete);
    // shaft walls & ceiling
    const wallH = CEIL + RISE + 0.2;
    box(0.2, wallH, zEnd - z0, cx - SHAFT_W / 2 - 0.1, CEIL - wallH / 2, (z0 + zEnd) / 2, mats.concrete);
    box(0.2, wallH, zEnd - z0, cx + SHAFT_W / 2 + 0.1, CEIL - wallH / 2, (z0 + zEnd) / 2, mats.concrete);
    box(SHAFT_W + 0.4, wallH, 0.2, cx, CEIL - wallH / 2, zEnd + 0.1, mats.concrete);
    box(SHAFT_W + 0.4, 0.2, zEnd - z0, cx, CEIL + 0.1, (z0 + zEnd) / 2, mats.concrete);
    // handrail
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), mats.rail);
    rail.rotation.x = Math.PI / 2 - a;
    rail.position.set(cx + SHAFT_W / 2 - 0.08, -RISE / 2 + 0.9, z0 + LANDING + RUN / 2);
    this.root.add(rail);
    // caged bulbs, dead until power returns
    for (const [y, z] of [[CEIL - 0.25, z0 + 0.6], [CEIL - 0.25 - RISE, zEnd - 0.8]]) {
      const l = new THREE.PointLight(0xffd9a0, 0, 6, 2);
      l.position.set(cx, y, z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x332a1a }));
      bulb.position.copy(l.position);
      bulb.name = 'bulb';
      this.root.add(l, bulb);
      this.lights.push(l);
    }
    // sliding steel doors on the warehouse side
    const R = physics.R;
    for (const dir of [-1, 1]) {
      const w = STAIR_OPENING / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, STAIR_HEIGHT, 0.05), mats.steel);
      const x = cx + dir * w / 2, z = this.wallZ - T / 2 - 0.03;
      mesh.position.set(x, STAIR_HEIGHT / 2, z);
      mesh.castShadow = true;
      this.root.add(mesh);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, STAIR_HEIGHT / 2, z));
      this.colliders.push(physics.world.createCollider(R.ColliderDesc.cuboid(w / 2, STAIR_HEIGHT / 2, 0.025), body));
      this.doors.push({ mesh, body, dir });
    }
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({ map: signTexture(false) }));
    this.sign.rotation.y = Math.PI;
    this.sign.position.set(cx, STAIR_HEIGHT + 0.3, this.wallZ - T / 2 - 0.01);
    this.root.add(this.sign);
  }

  get doorPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.center.x, 1.2, this.wallZ);
  }

  contains(p: THREE.Vector3): boolean {
    return Math.abs(p.x - this.center.x) < SHAFT_W / 2 && p.z > this.wallZ;
  }

  /** Has this point gone far enough down the stairs to end the chapter? */
  descended(p: THREE.Vector3): boolean {
    return this.contains(p) && p.y < -RISE * 0.6;
  }

  setPowered(v: boolean): void {
    this.powered = v;
    this.open = v; // the breakers release the door magnets
  }

  update(dt: number, t: number): void {
    const target = this.open ? 1 : 0;
    const prev = this.doorOffset;
    this.doorOffset += Math.sign(target - this.doorOffset) * Math.min(Math.abs(target - this.doorOffset), dt * 0.5);
    if (this.doorOffset !== prev) {
      for (const d of this.doors) {
        const x = this.center.x + d.dir * (STAIR_OPENING / 4 + this.doorOffset * (STAIR_OPENING / 2 - 0.02));
        d.mesh.position.x = x;
        const tr = d.body.translation();
        d.body.setNextKinematicTranslation({ x, y: tr.y, z: tr.z });
      }
    }
    if (this.powered !== this.signLit) {
      this.signLit = this.powered;
      const m = this.sign.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = signTexture(this.powered);
      m.needsUpdate = true;
      this.root.children.filter((c) => c.name === 'bulb').forEach((b) => ((b as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(this.powered ? 0xffe2b0 : 0x332a1a));
    }
    this.lights.forEach((l, i) => { l.intensity = this.powered ? (i === 1 && Math.sin(t * 17) > 0.8 ? 0.4 : 2.2) : 0; });
  }
}
