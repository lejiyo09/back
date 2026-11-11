import * as THREE from 'three';

/**
 * Hand-held flashlight: a SpotLight that lags slightly behind the view (hand sway).
 * Only the flashlight may cast real-time shadows (design doc 6-3).
 */
export class Flashlight {
  readonly light: THREE.SpotLight;
  readonly target = new THREE.Object3D();
  /** Fake single-bounce fill placed where the beam lands, so dark rooms get faint spill. */
  readonly bounce = new THREE.PointLight(0xd8c08a, 0, 7, 2);
  on = false;
  private smoothDir = new THREE.Vector3(0, 0, -1);
  private flicker = 0;

  constructor(shadowSize: number) {
    this.light = new THREE.SpotLight(0xfff4e0, 0, 22, THREE.MathUtils.degToRad(33), 0.9, 1.6);
    this.light.castShadow = shadowSize > 0;
    if (shadowSize > 0) {
      this.light.shadow.mapSize.set(shadowSize, shadowSize);
      this.light.shadow.camera.near = 0.15;
      this.light.shadow.camera.far = 22;
      this.light.shadow.bias = -0.0004;
      this.light.shadow.normalBias = 0.02;
    }
    this.light.target = this.target;
  }

  toggle(): boolean {
    this.on = !this.on;
    return this.on;
  }

  /** `hitDistance`: distance along the view ray to the first surface (Infinity if none). */
  update(dt: number, camera: THREE.Camera, battery: number, t: number, hitDistance = Infinity): void {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.smoothDir.lerp(dir, 1 - Math.exp(-dt * 14)).normalize();
    // Held at the right hip, slightly below the eye.
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const pos = camera.getWorldPosition(new THREE.Vector3())
      .addScaledVector(right, 0.18)
      .add(new THREE.Vector3(0, -0.22, 0))
      .addScaledVector(dir, 0.1);
    this.light.position.copy(pos);
    this.target.position.copy(pos).addScaledVector(this.smoothDir, 5);

    let intensity = 0;
    if (this.on && battery > 0) {
      intensity = 18 * (0.35 + 0.65 * Math.min(1, battery / 30));
      // Low battery: the bulb stutters.
      if (battery < 15) {
        this.flicker -= dt;
        if (this.flicker < 0) this.flicker = Math.random() * (battery / 15) * 2.5;
        if (this.flicker < 0.08) intensity *= 0.15 + Math.random() * 0.3;
      }
      intensity *= 1 + Math.sin(t * 31) * 0.01;
    }
    this.light.intensity = intensity;
    const hd = Math.min(hitDistance, 12);
    this.bounce.position.copy(pos).addScaledVector(this.smoothDir, Math.max(0.3, hd - 0.35));
    this.bounce.intensity = intensity * 0.05 * Math.min(1, 4 / (1 + hd));
  }
}
