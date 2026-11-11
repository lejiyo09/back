import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_HZ } from '@shared/Constants';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/**
 * Thin wrapper over a Rapier world stepped at a fixed 60 Hz (design doc 14.2).
 * Static level geometry lives on a single fixed body; doors are kinematic bodies.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly staticBody: RAPIER.RigidBody;
  readonly dt = 1 / PHYSICS_HZ;

  constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.staticBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
  }

  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): RAPIER.Collider {
    return this.world.createCollider(
      this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz),
      this.staticBody,
    );
  }

  addSensorBall(x: number, y: number, z: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(
      this.R.ColliderDesc.ball(radius).setTranslation(x, y, z).setSensor(true),
      this.staticBody,
    );
  }

  step(): void {
    this.world.step();
  }

  /** First collider hit along a ray, ignoring `exclude`. Sensors are included. */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    exclude?: RAPIER.Collider,
  ): { collider: RAPIER.Collider; distance: number } | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, exclude);
    return hit ? { collider: hit.collider, distance: hit.timeOfImpact } : null;
  }

  dispose(): void {
    this.world.free();
  }
}
