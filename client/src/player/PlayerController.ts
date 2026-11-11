import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { NOISE, PLAYER } from '@shared/Constants';
import type { PlayerNetState } from '@shared/GameTypes';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Input } from '../core/Input';
import { SurvivalStatus } from './SurvivalStatus';

const STAND_HALF = (PLAYER.STAND_HEIGHT - 2 * PLAYER.RADIUS) / 2;
const CROUCH_HALF = (PLAYER.CROUCH_HEIGHT - 2 * PLAYER.RADIUS) / 2;

export interface FootstepEvent {
  gait: 'crouch' | 'walk' | 'run';
}

/**
 * Local player. Mouse rotates the camera (PointerLockControls); keyboard produces a
 * desired velocity; Rapier's kinematic character controller resolves collisions;
 * the resulting position drives the camera (design doc 7-2). Physics runs at a
 * fixed 60 Hz and the camera interpolates between physics states.
 */
export class PlayerController {
  readonly status = new SurvivalStatus();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private velY = 0;
  grounded = false;
  crouching = false;
  sprinting = false;
  /** feet position at the previous and current physics step */
  private prevFeet = new THREE.Vector3();
  readonly feet = new THREE.Vector3();
  private eyeHeight: number = PLAYER.EYE_HEIGHT;
  horizontalSpeed = 0;
  private bobPhase = 0;
  private lastStepSide = 0;
  private airTime = 0;
  headBob = true;
  flashlightOn = false;
  onFootstep?: (e: FootstepEvent) => void;
  onLand?: (impact: number) => void;

  constructor(private physics: PhysicsWorld, spawn: THREE.Vector3, private camera: THREE.PerspectiveCamera, private input: Input) {
    const R = physics.R;
    const cy = spawn.y + STAND_HALF + PLAYER.RADIUS;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, cy, spawn.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(STAND_HALF, PLAYER.RADIUS), this.body);
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(45));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50));
    this.controller.enableAutostep(0.25, 0.15, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setSlideEnabled(true);
    this.feet.copy(spawn);
    this.prevFeet.copy(spawn);
  }

  private halfHeight(): number {
    return this.crouching ? CROUCH_HALF : STAND_HALF;
  }

  private canStand(): boolean {
    const t = this.body.translation();
    const top = t.y + this.halfHeight() + PLAYER.RADIUS;
    const needed = PLAYER.STAND_HEIGHT - PLAYER.CROUCH_HEIGHT + 0.05;
    const hit = this.physics.castRay({ x: t.x, y: top - 0.05, z: t.z }, { x: 0, y: 1, z: 0 }, needed, this.collider);
    return !hit || hit.collider.isSensor();
  }

  private setCrouch(c: boolean): void {
    if (c === this.crouching) return;
    if (!c && !this.canStand()) return;
    const t = this.body.translation();
    const oldHalf = this.halfHeight();
    this.crouching = c;
    const newHalf = this.halfHeight();
    this.collider.setHalfHeight(newHalf);
    // keep feet planted
    const ny = t.y - oldHalf + newHalf;
    this.body.setTranslation({ x: t.x, y: ny, z: t.z }, true);
    this.body.setNextKinematicTranslation({ x: t.x, y: ny, z: t.z });
  }

  /** Fixed 60 Hz step. */
  fixedUpdate(dt: number): void {
    const inp = this.input;
    this.setCrouch(inp.isDown('ControlLeft') || inp.isDown('ControlRight') || inp.isDown('KeyC'));

    // movement basis from camera yaw
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (inp.isDown('KeyW')) wish.add(fwd);
    if (inp.isDown('KeyS')) wish.sub(fwd);
    if (inp.isDown('KeyD')) wish.add(right);
    if (inp.isDown('KeyA')) wish.sub(right);
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    const wantSprint = (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) && moving && !this.crouching && inp.isDown('KeyW');
    this.sprinting = wantSprint && this.status.canSprint() && this.grounded;
    const speed = this.crouching ? PLAYER.CROUCH_SPEED : this.sprinting ? PLAYER.RUN_SPEED : PLAYER.WALK_SPEED;

    const jump = inp.wasPressed('Space');
    if (this.grounded) {
      this.velY = -0.5;
      if (jump && !this.crouching) {
        this.velY = PLAYER.JUMP_VELOCITY;
        this.grounded = false;
      }
    } else {
      this.velY -= PLAYER.GRAVITY * dt;
      this.airTime += dt;
    }

    const desired = { x: wish.x * speed * dt, y: this.velY * dt, z: wish.z * speed * dt };
    this.controller.computeColliderMovement(this.collider, desired, this.physics.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);

    if (this.grounded && !wasGrounded && this.airTime > 0.25) {
      this.onLand?.(Math.min(1, this.airTime));
      this.status.emitNoise(NOISE.JUMP_LAND);
    }
    if (this.grounded) this.airTime = 0;
    if (this.velY > 0 && mv.y < desired.y * 0.5) this.velY = 0; // bumped head on ceiling

    this.prevFeet.copy(this.feet);
    this.feet.set(next.x, next.y - this.halfHeight() - PLAYER.RADIUS, next.z);
    this.horizontalSpeed = Math.hypot(mv.x, mv.z) / dt;

    this.status.update(dt, this.sprinting && this.horizontalSpeed > 1, this.flashlightOn);
    if (this.grounded && this.horizontalSpeed > 0.5) {
      this.status.emitNoise(this.crouching ? NOISE.CROUCH : this.sprinting ? NOISE.RUN : NOISE.WALK);
    }
  }

  /** Per render frame: interpolate camera, head bob, footsteps. */
  updateCamera(dt: number, alpha: number): void {
    const targetEye = this.crouching ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-dt * 12));
    const feet = new THREE.Vector3().lerpVectors(this.prevFeet, this.feet, alpha);

    let bobY = 0;
    let bobX = 0;
    const speed = this.grounded ? this.horizontalSpeed : 0;
    if (speed > 0.3) {
      const freq = this.crouching ? 1.4 : this.sprinting ? 2.5 : 1.95; // steps per second / 2
      this.bobPhase += dt * freq * Math.PI * 2;
      const side = Math.sin(this.bobPhase) >= 0 ? 1 : -1;
      if (side !== this.lastStepSide) {
        this.lastStepSide = side;
        this.onFootstep?.({ gait: this.crouching ? 'crouch' : this.sprinting ? 'run' : 'walk' });
      }
      const amp = this.crouching ? 0.018 : this.sprinting ? 0.055 : 0.032;
      bobY = Math.abs(Math.sin(this.bobPhase)) * amp - amp * 0.5;
      bobX = Math.cos(this.bobPhase) * amp * 0.5;
    } else {
      this.bobPhase *= 0.9;
    }
    if (!this.headBob) { bobX = 0; bobY = 0; }
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(right);
    right.set(-right.z, 0, right.x).normalize();
    this.camera.position.set(feet.x, feet.y + this.eyeHeight + bobY, feet.z).addScaledVector(right, bobX);
  }

  /** Snap to a position (spawn / respawn). */
  teleport(p: THREE.Vector3): void {
    const cy = p.y + this.halfHeight() + PLAYER.RADIUS;
    this.body.setTranslation({ x: p.x, y: cy, z: p.z }, true);
    this.feet.copy(p);
    this.prevFeet.copy(p);
  }

  netState(flashlightOn: boolean): PlayerNetState {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      p: [r(this.feet.x), r(this.feet.y), r(this.feet.z)],
      r: [r(e.y), r(e.x)],
      c: this.crouching,
      f: flashlightOn,
      s: r(this.horizontalSpeed),
      t: Date.now(),
    };
  }
}
