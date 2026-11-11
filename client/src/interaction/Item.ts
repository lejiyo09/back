import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Interactable, InteractableKind } from './Interactable';

/** A floor pickup (battery) or a readable note. */
export class Item implements Interactable {
  readonly root = new THREE.Group();
  readonly colliders: RAPIER.Collider[] = [];
  collected = false;

  constructor(
    readonly id: string,
    readonly kind: Extract<InteractableKind, 'item' | 'note'>,
    private readonly label: string,
    pos: THREE.Vector3,
    rot: number,
    mesh: THREE.Object3D,
    physics: PhysicsWorld,
    readonly noteIndex = -1,
  ) {
    this.root.position.copy(pos);
    this.root.rotation.y = rot;
    this.root.add(mesh);
    this.colliders.push(physics.addSensorBall(pos.x, pos.y + 0.05, pos.z, 0.22));
  }

  prompt(): string {
    return this.collected ? '' : this.label;
  }

  position(): THREE.Vector3 {
    return this.root.position.clone();
  }

  setCollected(v: boolean): void {
    this.collected = v;
    this.root.visible = !v;
    for (const c of this.colliders) c.setEnabled(!v);
  }
}

export function makeBatteryMesh(): THREE.Object3D {
  // D-cell battery lying on its side (Ø34 mm x 61 mm)
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.017, 0.061, 20),
    new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.35, metalness: 0.4 }),
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0172, 0.0172, 0.022, 20),
    new THREE.MeshStandardMaterial({ color: 0xc9902a, roughness: 0.3, metalness: 0.6 }),
  );
  band.position.y = 0.012;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.004, 10),
    new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.2, metalness: 1 }),
  );
  cap.position.y = 0.032;
  g.add(body, band, cap);
  g.rotation.z = Math.PI / 2;
  g.position.y = 0.017;
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

export function makeNoteMesh(texture: THREE.Texture): THREE.Object3D {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.21, 0.27),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.receiveShadow = true;
  return m;
}
