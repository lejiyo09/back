import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { asphaltTexture, brickTexture, concreteTexture, type PBRSet } from '../rendering/Textures';

/** Same cab dimensions as the real elevator, so the swap is invisible. */
const CAB_W = 1.9, CAB_D = 1.8, CAB_H = 2.4, OPEN_W = 1.2, OPEN_H = 2.2;

export type EndingKind = 'escape' | 'level1';

/**
 * Destinations for the two endings, built far outside the level (fog hides
 * everything in between). Each has a copy of the elevator cab; when the doors
 * close and the ride goes dark, players are moved into the copy and the doors open
 * onto somewhere else.
 *
 *  A — ESCAPE: a rain-soaked back alley at night. Real, ordinary, almost.
 *  B — WRONG FREQUENCY: Level 1 as the Backrooms Wiki describes it — a vast
 *      concrete warehouse, exposed rebar, conduits overhead, fluorescent lights,
 *      crates of supplies, puddles and a persistent fog.
 */
export class EndingScene {
  readonly group = new THREE.Group();
  readonly cabCenter: THREE.Vector3;
  readonly fog: { color: number; density: number };
  readonly exposure: number;
  private colliders: RAPIER.Collider[] = [];
  private doorMeshes: THREE.Mesh[] = [];
  private doorColliders: RAPIER.Collider[] = [];
  private textures: PBRSet[] = [];
  private flickerLights: { light: THREE.PointLight | null; base: number; strip?: THREE.MeshBasicMaterial; phase: number; pos: THREE.Vector3 }[] = [];
  private rain?: THREE.LineSegments;
  private rainPos?: Float32Array;
  private cabLight: THREE.PointLight;
  private cascade = -1;

  constructor(readonly kind: EndingKind, origin: THREE.Vector3, private physics: PhysicsWorld, seed: number) {
    this.cabCenter = origin.clone();
    const front = origin.z - CAB_D / 2; // opening faces -z, like the real cab
    this.fog = kind === 'escape' ? { color: 0x0d1018, density: 0.05 } : { color: 0x474a46, density: 0.075 };
    this.exposure = kind === 'escape' ? 1.25 : 1.2;

    // ── the cab copy ───────────────────────────────────────
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b8e8f, roughness: 0.38, metalness: 0.55 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.85 });
    const cx = origin.x, cz = origin.z;
    this.box(CAB_W + 0.2, 0.2, CAB_D + 0.2, cx, -0.1, cz, floorMat);
    this.box(CAB_W + 0.2, 0.1, CAB_D + 0.2, cx, CAB_H + 0.05, cz, steel);
    this.box(0.08, CAB_H, CAB_D, cx - CAB_W / 2 - 0.04, CAB_H / 2, cz, steel);
    this.box(0.08, CAB_H, CAB_D, cx + CAB_W / 2 + 0.04, CAB_H / 2, cz, steel);
    this.box(CAB_W + 0.16, CAB_H, 0.08, cx, CAB_H / 2, cz + CAB_D / 2 + 0.04, steel);
    const side = (CAB_W - OPEN_W) / 2;
    this.box(side, CAB_H, 0.08, cx - OPEN_W / 2 - side / 2, CAB_H / 2, front - 0.04, steel);
    this.box(side, CAB_H, 0.08, cx + OPEN_W / 2 + side / 2, CAB_H / 2, front - 0.04, steel);
    this.box(OPEN_W, CAB_H - OPEN_H, 0.08, cx, OPEN_H + (CAB_H - OPEN_H) / 2, front - 0.04, steel);
    for (const dir of [-1, 1]) {
      const m = this.box(OPEN_W / 2, OPEN_H, 0.04, cx + dir * OPEN_W / 4, OPEN_H / 2, front - 0.1, steel, true);
      this.doorMeshes.push(m);
    }
    this.cabLight = new THREE.PointLight(0xffe6c0, 3, 4.5, 2);
    this.cabLight.position.set(cx, CAB_H - 0.2, cz);
    this.group.add(this.cabLight);

    if (kind === 'escape') this.buildAlley(cx, front, seed);
    else this.buildLevel1(cx, front, seed);
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, isDoor = false, collide = true): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = true;
    this.group.add(m);
    if (collide) {
      const c = this.physics.addStaticBox(x, y, z, w / 2, h / 2, d / 2);
      (isDoor ? this.doorColliders : this.colliders).push(c);
    }
    return m;
  }

  private tiled(set: PBRSet, w: number, h: number, tile: number): THREE.MeshStandardMaterial {
    const clone = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(w / tile, h / tile); c.needsUpdate = true; return c; };
    return new THREE.MeshStandardMaterial({ map: clone(set.map), normalMap: clone(set.normalMap), roughnessMap: clone(set.roughnessMap), roughness: 1 });
  }

  // ── A: the alley ─────────────────────────────────────────
  private buildAlley(cx: number, front: number, seed: number): void {
    const brick = brickTexture(512, seed, 4), asphalt = asphaltTexture(512, seed, 4);
    this.textures.push(brick, asphalt);
    const groundW = 60, groundD = 40;
    const ground = this.box(groundW, 0.4, groundD, cx, -0.2, front - groundD / 2, this.tiled(asphalt, groundW, groundD, 3));
    (ground.material as THREE.MeshStandardMaterial).metalness = 0.15;
    // the building we come out of (the elevator is a service lift in its back wall)
    const wallH = 9;
    const bw = (groundW - OPEN_W) / 2;
    this.box(bw, wallH, 0.4, cx - OPEN_W / 2 - bw / 2 - 0.2, wallH / 2, front - 0.2 - 0.12, this.tiled(brick, bw, wallH, 1));
    this.box(bw, wallH, 0.4, cx + OPEN_W / 2 + bw / 2 + 0.2, wallH / 2, front - 0.2 - 0.12, this.tiled(brick, bw, wallH, 1));
    this.box(OPEN_W + 0.4, wallH - OPEN_H, 0.4, cx, OPEN_H + (wallH - OPEN_H) / 2, front - 0.32, this.tiled(brick, OPEN_W, wallH - OPEN_H, 1));
    // the building across the alley, with a few lit windows
    const across = front - 13;
    this.box(groundW, 14, 0.6, cx, 7, across, this.tiled(brick, groundW, 14, 1));
    const win = new THREE.MeshBasicMaterial({ color: 0xffc77a });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0b0d12 });
    const rng = (i: number) => Math.abs(Math.sin(seed + i * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 18; i++) {
      const wx = cx - 24 + (i % 9) * 6;
      const wy = 3.5 + Math.floor(i / 9) * 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), rng(i) > 0.6 ? win : dark);
      m.position.set(wx, wy, across + 0.31);
      this.group.add(m);
    }
    // curb & sidewalk along our wall
    this.box(groundW, 0.15, 2.2, cx, 0.075, front - 1.5, new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.8 }));
    // sodium street lamps
    for (const lx of [cx + 4, cx - 14, cx + 20]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.5 }));
      pole.position.set(lx, 3, front - 2.8);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.25), new THREE.MeshBasicMaterial({ color: 0xffb35c }));
      head.position.set(lx, 6, front - 3.2);
      const light = new THREE.PointLight(0xff9c40, 28, 20, 1.8);
      light.position.set(lx, 5.8, front - 3.4);
      this.group.add(pole, head, light);
      this.flickerLights.push({ light, base: 28, phase: lx, pos: light.position.clone() });
    }
    // bounds
    this.colliders.push(this.physics.addStaticBox(cx - groundW / 2, 2, front - groundD / 2, 0.2, 4, groundD / 2));
    this.colliders.push(this.physics.addStaticBox(cx + groundW / 2, 2, front - groundD / 2, 0.2, 4, groundD / 2));
    // rain streaks around the viewer
    const N = 1400;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = cx + (Math.random() - 0.5) * 30, y = Math.random() * 12, z = front - Math.random() * 25;
      this.rainPos.set([x, y, z, x - 0.02, y - 0.35, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  // ── B: Level 1 ───────────────────────────────────────────
  private buildLevel1(cx: number, front: number, seed: number): void {
    const conc = concreteTexture(512, seed, 4);
    this.textures.push(conc);
    const W = 60, D = 50, H = 5.5;
    this.box(W, 0.4, D, cx, -0.2, front - D / 2, this.tiled(conc, W, D, 2));
    this.box(W, 0.4, D, cx, H + 0.2, front - D / 2, this.tiled(conc, W, D, 2.5));
    const bw = (W - OPEN_W) / 2;
    const wallMat = this.tiled(conc, bw, H, 2);
    this.box(bw, H, 0.4, cx - OPEN_W / 2 - bw / 2 - 0.2, H / 2, front - 0.32, wallMat);
    this.box(bw, H, 0.4, cx + OPEN_W / 2 + bw / 2 + 0.2, H / 2, front - 0.32, wallMat);
    this.box(OPEN_W + 0.4, H - OPEN_H, 0.4, cx, OPEN_H + (H - OPEN_H) / 2, front - 0.32, wallMat);
    const pillarMat = this.tiled(conc, 0.8, H, 2);
    const rebarMat = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8, metalness: 0.4 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6e5434, roughness: 0.85 });
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a6d45, roughness: 0.9 });
    const stripOn = new THREE.MeshBasicMaterial({ color: 0xe8f0ea });
    let li = 0;
    for (let gx = -4; gx <= 4; gx++) for (let gz = 1; gz <= 7; gz++) {
      // pillars sit half a bay off-centre so a clear aisle runs straight out of the elevator
      const x = cx + 3 + gx * 6, z = front - gz * 6;
      // concrete pillar with rebar sticking out of a broken top
      this.box(0.8, H, 0.8, x, H / 2, z, pillarMat);
      if ((gx + gz) % 3 === 0) {
        for (let r = 0; r < 4; r++) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), rebarMat);
          bar.position.set(x + (r % 2 ? 0.25 : -0.25), H - 0.9, z + (r < 2 ? 0.41 : -0.41));
          bar.rotation.z = (r - 1.5) * 0.15;
          this.group.add(bar);
        }
      }
      // hanging fluorescent strips; a few are real lights near the arrival point
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.3), stripOn.clone());
      strip.position.set(x - 3, H - 0.6, z + 3); // over the aisles
      this.group.add(strip);
      const near = (gx === 0 || gx === 1) && gz <= 3;
      if (near) {
        const light = new THREE.PointLight(0xdfe8e0, 11, 18, 2);
        light.position.set(x - 3, H - 0.8, z + 3);
        this.group.add(light);
        this.flickerLights.push({ light, base: 7, strip: strip.material as THREE.MeshBasicMaterial, phase: li++ * 1.7, pos: strip.position.clone() });
      } else {
        this.flickerLights.push({ light: null, base: 0, strip: strip.material as THREE.MeshBasicMaterial, phase: li++ * 1.3, pos: strip.position.clone() });
      }
      // crates of supplies and pallets between some pillars
      const r = Math.abs(Math.sin(seed + gx * 7.1 + gz * 3.3) * 1000) % 1;
      const crateX = x + 1.1;
      if (r > 0.55 && !(Math.abs(crateX - cx) < 1.8 && gz <= 5)) {
        const n = 1 + Math.floor(r * 3);
        for (let k = 0; k < n; k++) this.box(1.1, 1.0, 1.1, crateX + (k % 2) * 1.15, 0.5 + Math.floor(k / 2) * 1.0, z + 1.5, crateMat);
        if (Math.abs(x - 1.6 - cx) > 1.2) this.box(1.2, 0.14, 1.0, x - 1.6, 0.07, z + 2.5, palletMat);
      }
    }
    // conduits overhead
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6b6e6a, metalness: 0.5, roughness: 0.5 });
    for (const off of [-2.2, 0.8, 3.1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, D, 10), pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(cx + off, H - 0.25, front - D / 2);
      this.group.add(pipe);
    }
    // puddles
    const puddle = new THREE.MeshStandardMaterial({ color: 0x1e201e, roughness: 0.05, metalness: 0.3 });
    for (let i = 0; i < 9; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.6 + (i % 3) * 0.4, 20), puddle);
      p.rotation.x = -Math.PI / 2;
      p.position.set(cx - 10 + (i * 37 % 20), 0.005, front - 3 - (i * 23 % 24));
      this.group.add(p);
    }
    this.colliders.push(this.physics.addStaticBox(cx - W / 2, H / 2, front - D / 2, 0.2, H / 2, D / 2));
    this.colliders.push(this.physics.addStaticBox(cx + W / 2, H / 2, front - D / 2, 0.2, H / 2, D / 2));
    this.colliders.push(this.physics.addStaticBox(cx, H / 2, front - D, W / 2, H / 2, 0.2));
  }

  /** 0 = closed, 1 = open. */
  openDoors(k: number): void {
    this.doorMeshes.forEach((m, i) => {
      const dir = i === 0 ? -1 : 1;
      m.position.x = this.cabCenter.x + dir * (OPEN_W / 4 + k * (OPEN_W / 2 - 0.02));
    });
    for (const c of this.doorColliders) c.setEnabled(k < 0.6);
  }

  /** Level 1 finale: the lights die one by one, far to near. */
  startCascade(): void {
    this.cascade = 0;
  }

  update(dt: number, t: number, viewer: THREE.Vector3): void {
    if (this.cascade >= 0) this.cascade += dt;
    for (const f of this.flickerLights) {
      let k = 1;
      if (this.kind === 'level1') {
        // a couple of tubes are always failing (Level 1's flickering lights)
        if (Math.sin(f.phase * 3.1) > 0.6) k = Math.sin(t * 23 + f.phase) * Math.sin(t * 7 + f.phase) > 0.2 ? 0.1 : 1;
        if (this.cascade >= 0) {
          // farthest first, rolling toward the viewer
          const d = f.pos.distanceTo(viewer);
          if (this.cascade > 3.2 - Math.min(3, d / 10)) k = 0;
        }
        if (f.strip) f.strip.color.setScalar(k > 0.5 ? 1 : 0.06);
      } else {
        k = 1 + Math.sin(t * 50 + f.phase) * 0.02;
      }
      if (f.light) f.light.intensity = f.base * k;
    }
    if (this.rain && this.rainPos) {
      const p = this.rainPos;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= 9 * dt; p[i + 4] -= 9 * dt;
        if (p[i + 1] < 0) {
          const x = viewer.x + (Math.random() - 0.5) * 30, z = viewer.z - 2 - Math.random() * 22;
          p[i] = x; p[i + 3] = x - 0.02; p[i + 2] = z; p[i + 5] = z; p[i + 1] = 12; p[i + 4] = 11.65;
        }
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    void dt;
  }

  set cabLightOn(v: boolean) {
    this.cabLight.intensity = v ? 3 : 0;
  }

  dispose(): void {
    for (const c of [...this.colliders, ...this.doorColliders]) this.physics.world.removeCollider(c, false);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const m = o.material as THREE.Material & { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture };
        m.map?.dispose(); m.normalMap?.dispose(); m.roughnessMap?.dispose();
        m.dispose();
      }
    });
    for (const t of this.textures) { t.map.dispose(); t.normalMap.dispose(); t.roughnessMap.dispose(); }
    this.group.removeFromParent();
  }
}
