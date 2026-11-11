import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD } from '@shared/Constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable } from './Interactable';
import type { DoorSpot, Level0Data } from '../world/Level0Layout';
import { gridPoint } from '../world/Level0Layout';

const OPEN_ANGLE = THREE.MathUtils.degToRad(100);
const PANEL_W = 0.88;
const PANEL_H = WORLD.DOOR_HEIGHT;
const PANEL_T = 0.044;

/**
 * Hinged door with a kinematic Rapier body. State: 0 closed, ±1 open towards the
 * local ±Z side. The host decides the side (away from whoever opened it), so the
 * door moves identically on every client.
 */
export class Door implements Interactable {
  readonly kind = 'door' as const;
  readonly id: string;
  readonly root = new THREE.Group();
  readonly colliders: RAPIER.Collider[] = [];
  private pivot = new THREE.Group();
  private body: RAPIER.RigidBody;
  private angle = 0;
  private dir: number;
  state = 0;
  onStateChanged?: (door: Door, state: number) => void;

  constructor(spot: DoorSpot, level: Level0Data, physics: PhysicsWorld, material: THREE.Material, handleMat: THREE.Material) {
    this.id = spot.id;
    const a = gridPoint(level, spot.x, spot.y);
    const b = spot.dir === 'h' ? gridPoint(level, spot.x + 1, spot.y) : gridPoint(level, spot.x, spot.y + 1);
    this.root.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    this.root.rotation.y = spot.dir === 'h' ? 0 : -Math.PI / 2;

    const flip = spot.hingeFlip;
    const hingeX = (flip ? 1 : -1) * (WORLD.DOOR_WIDTH / 2 - 0.005);
    this.dir = flip ? -1 : 1;
    this.pivot.position.set(hingeX, 0, 0);
    this.root.add(this.pivot);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, PANEL_H, PANEL_T), material);
    panel.position.set(this.dir * PANEL_W / 2, PANEL_H / 2 + 0.005, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    this.pivot.add(panel);

    const handleGeo = new THREE.BoxGeometry(0.12, 0.022, 0.022);
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(handleGeo, handleMat);
      h.position.set(this.dir * (PANEL_W - 0.11), 0.98, side * (PANEL_T / 2 + 0.03));
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 12), handleMat);
      rose.rotation.x = Math.PI / 2;
      rose.position.set(this.dir * (PANEL_W - 0.06), 0.98, side * (PANEL_T / 2 + 0.006));
      this.pivot.add(h, rose);
    }

    // Kinematic body at the hinge, collider offset to the slab centre.
    this.root.updateMatrixWorld(true);
    const hingeWorld = this.pivot.getWorldPosition(new THREE.Vector3());
    const q = this.root.quaternion;
    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(hingeWorld.x, 0, hingeWorld.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.colliders.push(
      physics.world.createCollider(
        R.ColliderDesc.cuboid(PANEL_W / 2, PANEL_H / 2, PANEL_T / 2).setTranslation(this.dir * PANEL_W / 2, PANEL_H / 2 + 0.005, 0),
        this.body,
      ),
    );
  }

  prompt(): string {
    return this.state === 0 ? '문 열기' : '문 닫기';
  }

  position(): THREE.Vector3 {
    return this.root.position.clone().setY(1);
  }

  /** Which way should the door swing for someone standing at `from`? (opens away) */
  swingAwayFrom(from: THREE.Vector3): number {
    const local = this.root.worldToLocal(from.clone());
    return local.z > 0 ? -1 : 1;
  }

  setState(state: number, silent = false): void {
    const s = Math.sign(state);
    if (s === this.state) return;
    this.state = s;
    if (!silent) this.onStateChanged?.(this, s);
  }

  /** Fixed-step update: animate and push the kinematic body. */
  fixedUpdate(dt: number): void {
    const target = -this.dir * this.state * OPEN_ANGLE;
    const diff = target - this.angle;
    if (Math.abs(diff) < 1e-4) return;
    const speed = 3.2;
    this.angle += Math.sign(diff) * Math.min(Math.abs(diff), speed * dt * (0.35 + Math.min(1, Math.abs(diff))));
    this.pivot.rotation.y = this.angle;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.angle).premultiply(this.root.quaternion);
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
}
