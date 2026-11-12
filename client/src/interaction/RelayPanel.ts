import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { OBJECTIVE, WORLD } from '@shared/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable } from './Interactable';
import { cellCenter, type Level0Data, type WallSpot } from '../world/Level0Layout';

function labelTexture(lines: string[], w = 256, h = 160): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5b6157';
  ctx.fillRect(0, 0, w, h);
  // worn paint
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '30,30,25' : '140,140,120'},${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 6, Math.random() * 6);
  }
  ctx.fillStyle = '#e8d85a';
  ctx.fillRect(14, 14, w - 28, 34);
  ctx.fillStyle = '#1b1b14';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(lines[0], 24, 39);
  ctx.fillStyle = '#d9d6c8';
  ctx.font = '16px sans-serif';
  lines.slice(1).forEach((l, i) => ctx.fillText(l, 22, 76 + i * 22));
  // hazard stripes
  for (let x = -h; x < w; x += 24) {
    ctx.fillStyle = '#1b1b14';
    ctx.beginPath(); ctx.moveTo(x, h - 18); ctx.lineTo(x + 12, h - 18); ctx.lineTo(x + 30, h); ctx.lineTo(x + 18, h); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Wall-mounted main breaker ("전력 패널"). Holding E throws the lever — loud.
 * Three of them restore power to the service elevator.
 */
export class RelayPanel implements Interactable {
  readonly kind = 'device' as const;
  readonly root = new THREE.Group();
  readonly colliders: RAPIER.Collider[] = [];
  active = false;
  private lever = new THREE.Group();
  private lamp: THREE.Mesh;
  private lampMat: THREE.MeshBasicMaterial;
  private leverAngle = 0.9;
  readonly index: number;

  constructor(readonly id: string, spot: WallSpot, level: Level0Data, physics: PhysicsWorld, metal: THREE.Material, lit: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial = (m) => m) {
    this.index = Number(id.split('-')[1]);
    const c = cellCenter(level, spot.cx, spot.cy);
    const half = WORLD.CELL_SIZE / 2 - WORLD.WALL_THICKNESS / 2 - 0.07;
    const off = { n: [0, -half, 0], s: [0, half, Math.PI], w: [-half, 0, Math.PI / 2], e: [half, 0, -Math.PI / 2] }[spot.side];
    this.root.position.set(c.x + off[0], 0, c.z + off[1]);
    this.root.rotation.y = off[2];

    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.12), metal);
    box.position.y = 1.35;
    box.castShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), lit(new THREE.MeshStandardMaterial({
      map: labelTexture([`RELAY 0${this.index + 1}`, '주 전원 차단기', 'MAIN BREAKER — B2']), roughness: 0.7,
    })));
    face.position.set(-0.01, 1.47, 0.061);
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, WORLD.CEILING_HEIGHT - 1.66, 8), metal);
    conduit.position.set(0.12, (WORLD.CEILING_HEIGHT + 1.66) / 2, 0);
    this.lever.position.set(0.16, 1.22, 0.07);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.025), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    arm.position.y = 0.08;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: 0.4 }));
    knob.position.y = 0.16;
    this.lever.add(arm, knob);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x5a0d08 });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), this.lampMat);
    this.lamp.position.set(-0.13, 1.18, 0.07);
    this.root.add(box, face, conduit, this.lever, this.lamp);
    this.root.updateMatrixWorld(true);

    const wp = box.getWorldPosition(new THREE.Vector3());
    const ew = spot.side === 'n' || spot.side === 's';
    this.colliders.push(physics.addStaticBox(wp.x, wp.y, wp.z, ew ? 0.22 : 0.06, 0.31, ew ? 0.06 : 0.22));
  }

  prompt(): string {
    return this.active ? '' : '전력 패널 레버 내리기';
  }

  holdTime(): number {
    return OBJECTIVE.RELAY_HOLD;
  }

  position(): THREE.Vector3 {
    return this.root.position.clone().setY(1.3);
  }

  setActive(v: boolean): void {
    this.active = v;
  }

  update(dt: number, t: number): void {
    const target = this.active ? -0.9 : 0.9;
    this.leverAngle += (target - this.leverAngle) * Math.min(1, dt * 10);
    this.lever.rotation.x = this.leverAngle;
    // a dead red lamp blinks; a live one glows steady green
    if (this.active) this.lampMat.color.setHex(0x3dff6a);
    else this.lampMat.color.setHex(Math.sin(t * 3 + this.index) > 0.6 ? 0xff2a14 : 0x4a0a06);
  }
}
