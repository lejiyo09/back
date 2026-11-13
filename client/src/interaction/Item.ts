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
    readonly kind: Extract<InteractableKind, 'item' | 'note' | 'tool'>,
    private readonly label: string,
    pos: THREE.Vector3,
    rot: number,
    mesh: THREE.Object3D,
    physics: PhysicsWorld,
    readonly noteIndex = -1,
    private readonly hold = 0,
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

  holdTime(): number {
    return this.collected ? 0 : this.hold;
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

/** The Signal Recorder: a battered handheld field recorder with a whip antenna. */
export function makeRecorderMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.55, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 0.12), shell);
  body.position.y = 0.0125;
  const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.002, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
  grille.position.set(0, 0.026, 0.025);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  led.position.set(0.022, 0.026, -0.04);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.002, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.3 }));
  antenna.rotation.x = Math.PI / 2 - 0.15;
  antenna.position.set(-0.024, 0.02, -0.13);
  g.add(body, grille, led, antenna);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

/** A small glinting item (key, card, part) — tinted per item, with a faint glow so it can be found. */
export function makeKeyMesh(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55, emissive: color, emissiveIntensity: 0.18 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.07), mat);
  body.position.y = 0.0125;
  const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.026, 12), mat);
  tag.position.set(-0.07, 0.013, 0);
  g.add(body, tag);
  // soft halo so it reads in the dark
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(16, 16, 1, 16, 16, 15);
  const col = new THREE.Color(color);
  gr.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.55)`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 32, 32);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  halo.scale.setScalar(0.35);
  halo.position.y = 0.06;
  g.add(halo);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}
