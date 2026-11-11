import * as THREE from 'three';
import { PLAYER } from '@shared/Constants';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { World } from '../world/World';
import type { Interactable } from './Interactable';

/**
 * Looks along the camera ray (Rapier query — walls occlude naturally) and reports
 * what the player is focusing on, for the "E - …" prompt.
 */
export class InteractionManager {
  focus: Interactable | null = null;
  private dir = new THREE.Vector3();
  private origin = new THREE.Vector3();

  constructor(private physics: PhysicsWorld, private world: World, private exclude: RAPIER.Collider) {}

  update(camera: THREE.Camera): void {
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.dir);
    const hit = this.physics.castRay(this.origin, this.dir, PLAYER.INTERACT_DISTANCE, this.exclude);
    let target: Interactable | null = null;
    if (hit) target = this.world.interactables.get(hit.collider.handle) ?? null;
    // Small floor items are hard to hit exactly: fall back to a short look-down cone.
    if (!target) target = this.nearbyFloorItem();
    this.focus = target && target.prompt() ? target : null;
  }

  private nearbyFloorItem(): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = 0.965; // cos ≈ 15°
    for (const i of this.world.byId.values()) {
      if (i.kind === 'door' || !i.prompt()) continue;
      const p = i.position();
      const to = p.clone().sub(this.origin);
      const d = to.length();
      if (d > PLAYER.INTERACT_DISTANCE + 0.3) continue;
      const score = to.normalize().dot(this.dir);
      if (score < bestScore) continue;
      // make sure nothing solid is in between
      const hit = this.physics.castRay(this.origin, to, d - 0.15, this.exclude);
      if (hit && !hit.collider.isSensor()) continue;
      best = i;
      bestScore = score;
    }
    return best;
  }
}
