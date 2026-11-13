import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD } from '@shared/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable } from './Interactable';
import { gridPoint, type Level0Data } from '../world/Level0Layout';

export const RADIO_OPENING = 1.4;
export const RADIO_HEIGHT = 2.2;
const ROOM_W = 3.2, ROOM_D = 3.0, ROOM_H = 2.5;

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
  holdTime(): number { return 1.5; }
}

function label(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.fillStyle = fg; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The end of the signal (Level 2's goal). A maintenance radio room behind a blast
 * door that opens when both steam valves are turned. On the console: a CRT with
 * the signal's waveform, a reel-to-reel deck — and two choices.
 *   final-0  RECORD          → the loop goes on (Ending C)
 *   final-1  CUT THE SIGNAL  → silence (Ending D)
 */
export class RadioRoom {
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
  private screen: THREE.CanvasTexture;
  private screenCtx: CanvasRenderingContext2D;
  private lamp: THREE.PointLight;
  private screenGlow: THREE.PointLight;
  private reels: THREE.Mesh[] = [];

  constructor(level: Level0Data, physics: PhysicsWorld, mats: { concrete: THREE.Material; steel: THREE.Material; desk: THREE.Material }) {
    const p0 = gridPoint(level, level.exit.cx, level.h);
    const p1 = gridPoint(level, level.exit.cx + 1, level.h);
    const cx = (p0.x + p1.x) / 2;
    this.wallZ = p0.z;
    const T = WORLD.WALL_THICKNESS;
    const front = this.wallZ + T / 2;
    this.center = new THREE.Vector3(cx, 0, front + ROOM_D / 2);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, collide = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
      if (collide) this.colliders.push(physics.addStaticBox(x, y, z, w / 2, h / 2, d / 2));
      return mesh;
    };
    const cz = this.center.z;
    box(ROOM_W + 0.4, 0.2, ROOM_D + 0.2, cx, -0.1, cz, mats.concrete);
    box(ROOM_W + 0.4, 0.2, ROOM_D + 0.2, cx, ROOM_H + 0.1, cz, mats.concrete);
    box(0.2, ROOM_H, ROOM_D, cx - ROOM_W / 2 - 0.1, ROOM_H / 2, cz, mats.concrete);
    box(0.2, ROOM_H, ROOM_D, cx + ROOM_W / 2 + 0.1, ROOM_H / 2, cz, mats.concrete);
    box(ROOM_W + 0.4, ROOM_H, 0.2, cx, ROOM_H / 2, front + ROOM_D + 0.1, mats.concrete);
    const side = (ROOM_W - RADIO_OPENING) / 2;
    box(side, ROOM_H, 0.12, cx - RADIO_OPENING / 2 - side / 2, ROOM_H / 2, front + 0.06, mats.concrete);
    box(side, ROOM_H, 0.12, cx + RADIO_OPENING / 2 + side / 2, ROOM_H / 2, front + 0.06, mats.concrete);

    // console desk against the back wall
    const deskZ = front + ROOM_D - 0.45;
    box(2.4, 0.8, 0.7, cx, 0.4, deskZ, mats.desk);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 192;
    this.screenCtx = c.getContext('2d')!;
    this.screen = new THREE.CanvasTexture(c);
    this.screen.colorSpace = THREE.SRGBColorSpace;
    const crt = box(0.62, 0.5, 0.5, cx, 1.06, deskZ + 0.05, mats.steel, false);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshBasicMaterial({ map: this.screen }));
    face.rotation.y = Math.PI;
    face.position.set(cx, 1.08, deskZ - 0.205);
    this.root.add(face);
    void crt;
    // reel-to-reel deck
    for (const dx of [-0.85, -0.55]) {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }));
      reel.rotation.x = Math.PI / 2;
      reel.position.set(cx + dx, 1.0, deskZ - 0.05);
      this.root.add(reel);
      this.reels.push(reel);
    }
    box(0.7, 0.3, 0.2, cx - 0.7, 0.95, deskZ + 0.06, mats.steel, false);
    // speakers
    for (const dx of [-1.35, 1.35]) box(0.32, 0.5, 0.3, cx + dx, 1.05, deskZ, mats.desk, false);

    // the two choices
    const rec = new THREE.Group();
    rec.position.set(cx + 0.55, 0.83, deskZ - 0.2);
    const recBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0xb01a10, emissive: 0x300000, roughness: 0.4 }));
    recBtn.position.y = 0.02;
    const recLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.075), new THREE.MeshBasicMaterial({ map: label(level.index === 10 ? '● 송신' : '● 녹음', '#1a1a1a', '#ff6a5a') }));
    recLabel.rotation.x = -Math.PI / 2;
    recLabel.position.set(0, 0.005, 0.13);
    recLabel.rotation.z = Math.PI;
    rec.add(recBtn, recLabel);
    this.root.add(rec);
    const cut = new THREE.Group();
    cut.position.set(cx + 0.95, 0.83, deskZ - 0.2);
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9c24a, roughness: 0.5 }));
    sw.position.y = 0.06;
    const cutLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.075), new THREE.MeshBasicMaterial({ map: label(level.index === 10 ? '침묵' : '송신 차단', '#1a1a1a', '#ffe27a') }));
    cutLabel.rotation.x = -Math.PI / 2;
    cutLabel.rotation.z = Math.PI;
    cutLabel.position.set(0, 0.005, 0.13);
    cut.add(sw, cutLabel);
    this.root.add(cut);
    this.root.updateMatrixWorld(true);
    this.buttons.push(new Button('final-0', rec, () => (this.open && !this.ending ? (level.index === 10 ? '송신하기 — 신호를 세상 밖으로 보낸다' : '녹음하기 — 다음 사람에게 남긴다') : ''), physics, [0.07, 0.05, 0.07]));
    this.buttons.push(new Button('final-1', cut, () => (this.open && !this.ending ? (level.index === 10 ? '침묵 — 모든 신호를 영원히 끊는다' : '송신 차단 — 신호를 끊는다') : ''), physics, [0.07, 0.08, 0.07]));

    this.lamp = new THREE.PointLight(0xffc98a, 0, 5, 2);
    this.lamp.position.set(cx - 0.9, 2.1, deskZ - 0.6);
    this.screenGlow = new THREE.PointLight(0x7dff8a, 0, 3, 2);
    this.screenGlow.position.set(cx, 1.1, deskZ - 0.6);
    this.root.add(this.lamp, this.screenGlow);

    // blast door (corridor side)
    const R = physics.R;
    for (const dir of [-1, 1]) {
      const w = RADIO_OPENING / 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, RADIO_HEIGHT, 0.08), mats.steel);
      const x = cx + dir * w / 2, z = this.wallZ - T / 2 - 0.05;
      mesh.position.set(x, RADIO_HEIGHT / 2, z);
      mesh.castShadow = true;
      this.root.add(mesh);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, RADIO_HEIGHT / 2, z));
      this.colliders.push(physics.world.createCollider(R.ColliderDesc.cuboid(w / 2, RADIO_HEIGHT / 2, 0.04), body));
      this.doors.push({ mesh, body, dir });
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: label('무전실 — 관계자 외 출입금지', '#2a2a24', '#cfc9a8') }));
    sign.rotation.y = Math.PI;
    sign.position.set(cx, RADIO_HEIGHT + 0.18, this.wallZ - T / 2 - 0.01);
    this.root.add(sign);
  }

  get doorPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.center.x, 1.2, this.wallZ);
  }

  contains(p: THREE.Vector3): boolean {
    return Math.abs(p.x - this.center.x) < ROOM_W / 2 && p.z > this.wallZ && p.z < this.wallZ + ROOM_D + 0.1;
  }

  setPowered(v: boolean): void {
    this.powered = v;
    this.open = v; // the valves restore pressure to the door actuators
  }

  private t = 0;
  update(dt: number, t: number): void {
    this.t = t;
    const target = this.open && !this.ending ? 1 : 0;
    const prev = this.doorOffset;
    this.doorOffset += Math.sign(target - this.doorOffset) * Math.min(Math.abs(target - this.doorOffset), dt * 0.45);
    if (this.doorOffset !== prev) {
      for (const d of this.doors) {
        const x = this.center.x + d.dir * (RADIO_OPENING / 4 + this.doorOffset * (RADIO_OPENING / 2 - 0.02));
        d.mesh.position.x = x;
        const tr = d.body.translation();
        d.body.setNextKinematicTranslation({ x, y: tr.y, z: tr.z });
      }
    }
    const live = this.powered && !this.blackout;
    this.lamp.intensity = live ? 2.5 : 0;
    this.screenGlow.intensity = live ? 0.8 : 0;
    // the signal on the CRT
    const g = this.screenCtx;
    g.fillStyle = '#031006';
    g.fillRect(0, 0, 256, 192);
    if (live) {
      g.strokeStyle = this.ending === 2 ? '#1f5a2a' : '#7dff8a';
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < 256; x++) {
        const a = this.ending === 2 ? 0 : 1;
        const y = 96 + (Math.sin(x * 0.09 + t * 6) * 30 + Math.sin(x * 0.31 + t * 11) * 12 + (Math.random() - 0.5) * 10) * a;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = '#7dff8a';
      g.font = '14px monospace';
      g.fillText(this.ending === 2 ? 'NO SIGNAL' : 'SIGNAL  ▮▮▮▮▮  TX', 12, 22);
      g.fillText('88.1 / 104.6 MHz', 12, 180);
    }
    this.screen.needsUpdate = true;
    if (live && this.ending !== 2) this.reels.forEach((r, i) => { r.rotation.y += dt * (i ? 2.2 : 3.1); });
    void this.t;
  }
}
