import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { OBJECTIVE, WORLD } from '@shared/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable } from './Interactable';
import { gridPoint, type Level0Data } from '../world/Level0Layout';

export const ELEVATOR_OPENING = 1.2;
export const ELEVATOR_HEIGHT = 2.2;
const CAB_W = 1.9;
const CAB_D = 1.8;
const CAB_H = 2.4;

function displayTexture(text: string, lit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0806';
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = lit ? '#ffb43a' : '#2a1a0a';
  ctx.font = 'bold 30px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 64, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buttonLabel(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8c8f90';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 64, 30);
  ctx.font = '14px monospace';
  ctx.fillText('MHz', 64, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Button implements Interactable {
  readonly colliders: RAPIER.Collider[] = [];
  readonly kind = 'button' as const;
  constructor(readonly id: string, private readonly mesh: THREE.Object3D, private readonly label: () => string, physics: PhysicsWorld, half: [number, number, number]) {
    mesh.updateMatrixWorld(true);
    const p = mesh.getWorldPosition(new THREE.Vector3());
    this.colliders.push(physics.addStaticBox(p.x, p.y, p.z, ...half));
  }
  prompt(): string { return this.label(); }
  position(): THREE.Vector3 { return this.mesh.getWorldPosition(new THREE.Vector3()); }
}

/**
 * Service elevator set into the outer wall at the far end of the lights-out
 * section (design doc ACT 4–5). Dead until all three relays are thrown; then it
 * can be called, and inside, one of two frequencies is chosen — one way out, one
 * way further in.
 */
export class Elevator {
  readonly root = new THREE.Group();
  readonly buttons: Button[] = [];
  readonly colliders: RAPIER.Collider[] = [];
  powered = false;
  open = false;
  ending = 0;
  private doors: { mesh: THREE.Mesh; body: RAPIER.RigidBody; dir: number }[] = [];
  private doorOffset = 0;
  private display: THREE.Mesh;
  private displayLit = false;
  private cabLight: THREE.PointLight;
  private callLamp: THREE.MeshBasicMaterial;
  private readonly wallZ: number;
  readonly center: THREE.Vector3;

  constructor(level: Level0Data, private physics: PhysicsWorld, materials: { steel: THREE.Material; trim: THREE.Material; floor: THREE.Material }) {
    const p0 = gridPoint(level, level.exit.cx, level.h);
    const p1 = gridPoint(level, level.exit.cx + 1, level.h);
    const cx = (p0.x + p1.x) / 2;
    this.wallZ = p0.z;
    const T = WORLD.WALL_THICKNESS;
    const front = this.wallZ + T / 2;          // cabin starts behind the wall
    this.center = new THREE.Vector3(cx, 0, front + CAB_D / 2);
    const R = physics.R;

    // ── cabin (outside the level grid, so it gets its own floor) ──
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.root.add(m);
      if (collide) this.colliders.push(physics.addStaticBox(x, y, z, w / 2, h / 2, d / 2));
      return m;
    };
    box(CAB_W + 0.2, 0.2, CAB_D + 0.2, cx, -0.1, this.center.z, materials.floor);
    box(CAB_W + 0.2, 0.1, CAB_D + 0.2, cx, CAB_H + 0.05, this.center.z, materials.steel);
    box(0.08, CAB_H, CAB_D, cx - CAB_W / 2 - 0.04, CAB_H / 2, this.center.z, materials.steel);
    box(0.08, CAB_H, CAB_D, cx + CAB_W / 2 + 0.04, CAB_H / 2, this.center.z, materials.steel);
    box(CAB_W + 0.16, CAB_H, 0.08, cx, CAB_H / 2, front + CAB_D + 0.04, materials.steel);
    // front facade behind the wall opening (cabin side), so the cab reads as a shaft
    const side = (CAB_W - ELEVATOR_OPENING) / 2;
    box(side, CAB_H, 0.06, cx - ELEVATOR_OPENING / 2 - side / 2, CAB_H / 2, front + 0.03, materials.steel);
    box(side, CAB_H, 0.06, cx + ELEVATOR_OPENING / 2 + side / 2, CAB_H / 2, front + 0.03, materials.steel);
    // handrail
    box(CAB_W - 0.2, 0.04, 0.04, cx, 0.95, front + CAB_D - 0.06, materials.trim, false);

    this.cabLight = new THREE.PointLight(0xffe6c0, 0, 4.5, 2);
    this.cabLight.position.set(cx, CAB_H - 0.2, this.center.z);
    const ceilPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    ceilPanel.rotation.x = Math.PI / 2;
    ceilPanel.position.set(cx, CAB_H - 0.001, this.center.z);
    ceilPanel.name = 'ceilPanel';
    this.root.add(this.cabLight, ceilPanel);

    // ── sliding doors (corridor side) ─────────────────────
    for (const dir of [-1, 1]) {
      const w = ELEVATOR_OPENING / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, ELEVATOR_HEIGHT, 0.04), materials.steel);
      const x = cx + dir * w / 2;
      const z = this.wallZ - T / 2 - 0.025;
      mesh.position.set(x, ELEVATOR_HEIGHT / 2, z);
      mesh.castShadow = true;
      this.root.add(mesh);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, ELEVATOR_HEIGHT / 2, z));
      this.colliders.push(physics.world.createCollider(R.ColliderDesc.cuboid(w / 2, ELEVATOR_HEIGHT / 2, 0.02), body));
      this.doors.push({ mesh, body, dir });
    }
    // frame + floor indicator over the opening
    box(ELEVATOR_OPENING + 0.16, 0.08, 0.06, cx, ELEVATOR_HEIGHT + 0.04, this.wallZ - T / 2 - 0.03, materials.trim, false);
    for (const dir of [-1, 1]) box(0.08, ELEVATOR_HEIGHT, 0.06, cx + dir * (ELEVATOR_OPENING / 2 + 0.04), ELEVATOR_HEIGHT / 2, this.wallZ - T / 2 - 0.03, materials.trim, false);
    this.display = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.12), new THREE.MeshBasicMaterial({ map: displayTexture('—', false) }));
    this.display.rotation.y = Math.PI;
    this.display.position.set(cx, ELEVATOR_HEIGHT + 0.25, this.wallZ - T / 2 - 0.005);
    this.root.add(this.display);

    // ── call button (corridor wall, right of the opening as you face it) ──
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.02), materials.trim);
    plate.position.set(cx - ELEVATOR_OPENING / 2 - 0.3, 1.2, this.wallZ - T / 2 - 0.01);
    this.callLamp = new THREE.MeshBasicMaterial({ color: 0x2a1408 });
    const call = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 16), this.callLamp);
    call.rotation.x = Math.PI / 2;
    call.position.set(0, 0, -0.015);
    plate.add(call);
    this.root.add(plate);
    this.buttons.push(new Button('elevator-call', plate, () =>
      this.open ? '' : this.powered ? '엘리베이터 호출' : '호출 버튼 — 전원이 없다', physics, [0.05, 0.1, 0.02]));

    // ── frequency panel inside ────────────────────────────
    const panel = new THREE.Group();
    panel.position.set(cx + CAB_W / 2 - 0.005, 1.35, front + 0.55);
    panel.rotation.y = -Math.PI / 2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.02), materials.trim);
    panel.add(back);
    this.root.add(panel);
    OBJECTIVE.FREQUENCIES.forEach((f, i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.025), new THREE.MeshStandardMaterial({ map: buttonLabel(f), roughness: 0.4 }));
      b.position.set(0, 0.1 - i * 0.16, 0.02);
      panel.add(b);
      panel.updateMatrixWorld(true);
      this.buttons.push(new Button(`freq-${i}`, b, () =>
        this.open && !this.ending ? `주파수 ${f} MHz` : '', physics, [0.04, 0.035, 0.07]));
    });
  }

  /** Is a point inside the cab? */
  contains(p: THREE.Vector3): boolean {
    const front = this.wallZ + WORLD.WALL_THICKNESS / 2;
    return Math.abs(p.x - this.center.x) < CAB_W / 2 && p.z > front - 0.05 && p.z < front + CAB_D;
  }

  get doorPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.center.x, 1.2, this.wallZ);
  }

  setPowered(v: boolean): void {
    this.powered = v;
  }

  update(dt: number, t: number): void {
    const target = this.open && !this.ending ? 1 : 0;
    const prev = this.doorOffset;
    this.doorOffset += Math.sign(target - this.doorOffset) * Math.min(Math.abs(target - this.doorOffset), dt * 0.6);
    if (this.doorOffset !== prev) {
      for (const d of this.doors) {
        const x = this.center.x + d.dir * (ELEVATOR_OPENING / 4 + this.doorOffset * (ELEVATOR_OPENING / 2 - 0.02));
        d.mesh.position.x = x;
        const tr = d.body.translation();
        d.body.setNextKinematicTranslation({ x, y: tr.y, z: tr.z });
      }
    }
    if (this.powered !== this.displayLit) {
      this.displayLit = this.powered;
      const m = this.display.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.map = displayTexture(this.powered ? '▼ B2' : '—', this.powered);
      m.needsUpdate = true;
      const cp = this.root.getObjectByName('ceilPanel') as THREE.Mesh;
      (cp.material as THREE.MeshBasicMaterial).color.setHex(this.powered ? 0xfff0d0 : 0x222222);
    }
    this.cabLight.intensity = this.powered ? 3 * (Math.sin(t * 40) > 0.97 ? 0.4 : 1) : 0;
    this.callLamp.color.setHex(!this.powered ? 0x2a1408 : this.open ? 0xffd27a : (Math.sin(t * 4) > 0 ? 0xffb43a : 0x7a4a10));
    void this.physics;
  }
}
