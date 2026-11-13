import * as THREE from 'three';
import type { World } from '../world/World';
import type { GameAuthority } from '../multiplayer/GameAuthority';
import type { AudioManager } from '../audio/AudioManager';

/**
 * Level 1–2 ambush creatures (expansion spec §3, additions to the original levels).
 *
 *  PALLET MAW (Level 1) — a crate stack that is not a crate stack. Its lid rises
 *  and falls by a few millimetres (it breathes) and a red line shows in the gap.
 *  Walk past it upright and it opens and bites; crouch past slowly and it sleeps.
 *
 *  PIPE CRAWLER (Level 2) — lives in the wall vents under the ceiling. Make noise
 *  below a vent and long jointed arms come out and grab; crouch and it misses you.
 *
 * The wake-up goes through the authority (`mech:maw:i` / `mech:crawl:i`) so every
 * player sees the same creature move; each player only checks their own body.
 */
export interface LurkerHost {
  level: number;
  world: World;
  authority: () => GameAuthority;
  scene: THREE.Scene;
  audio: AudioManager;
  camera: THREE.Camera;
  feet(): THREE.Vector3;
  crouching(): boolean;
  speed(): number;
  noise(): number;
  alive(): boolean;
  hit(damage: number, from: THREE.Vector3): void;
  toast(text: string): void;
}

interface Maw { root: THREE.Group; lid: THREE.Group; glow: THREE.MeshStandardMaterial; pos: THREE.Vector3; t: number; cooldown: number; yaw: number; requested: number }
interface Crawler { root: THREE.Group; arms: { segs: THREE.Group[]; phase: number }[]; pos: THREE.Vector3; out: THREE.Vector3; t: number; cooldown: number; requested: number; target: THREE.Vector3 }

const WAKE_DIST = 2.3;
const BITE_DIST = 1.9;
const BITE_AT = 0.6;

export class Lurkers {
  private maws: Maw[] = [];
  private crawlers: Crawler[] = [];
  private time = 0;
  private warned = false;

  constructor(private h: LurkerHost) {
    if (h.level === 1) h.world.mawSpots.forEach((p, i) => this.maws.push(this.buildMaw(p, i)));
    if (h.level === 2) h.world.ventSpots.forEach((v) => this.crawlers.push(this.buildCrawler(v.pos, v.out)));
  }

  // ── Pallet Maw ─────────────────────────────────────────────
  private buildMaw(pos: THREE.Vector3, i: number): Maw {
    const lit = <T extends THREE.MeshStandardMaterial>(m: T) => this.h.world.baked.apply(m);
    const wood = lit(new THREE.MeshStandardMaterial({ color: 0x735a38, roughness: 0.85 }));
    const dark = lit(new THREE.MeshStandardMaterial({ color: 0x4f3d26, roughness: 0.9 }));
    const glow = lit(new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0x4a0603, emissiveIntensity: 0.4, roughness: 0.2 }));
    const tooth = lit(new THREE.MeshStandardMaterial({ color: 0xcfc4a0, roughness: 0.4 }));
    const S = 1.05;
    const root = new THREE.Group();
    root.position.copy(pos);
    const yaw = (i * 1.7) % (Math.PI * 2);
    root.rotation.y = yaw;
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(S + 0.06, 0.14, S + 0.06), dark);
    pallet.position.y = 0.07;
    const body = new THREE.Mesh(new THREE.BoxGeometry(S, 0.85, S), wood);
    body.position.y = 0.14 + 0.425;
    const band = new THREE.Mesh(new THREE.BoxGeometry(S + 0.02, 0.08, S + 0.02), dark);
    band.position.y = 0.6;
    // the mouth: a wet red throat filling the top of the "crate", teeth along the rim
    const throat = new THREE.Mesh(new THREE.BoxGeometry(S - 0.1, 0.06, S - 0.1), glow);
    throat.position.y = 1.0;
    root.add(pallet, body, band, throat);
    for (let k = 0; k < 14; k++) {
      const side = k % 4, f = ((k / 4) | 0) / 3 - 0.33;
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16 + (k % 3) * 0.04, 5), tooth);
      const e = S / 2 - 0.06;
      t.position.set(side === 0 ? f * S : side === 1 ? e : side === 2 ? -f * S : -e, 1.06, side === 0 ? e : side === 1 ? f * S : side === 2 ? -e : -f * S);
      root.add(t);
    }
    const tongue = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 6, 10), lit(new THREE.MeshStandardMaterial({ color: 0x9a4a48, roughness: 0.25 })));
    tongue.rotation.x = Math.PI / 2;
    tongue.position.set(0.05, 1.04, 0.05);
    root.add(tongue);
    // lid hinged at the back edge, teeth on its underside
    const lid = new THREE.Group();
    lid.position.set(0, 1.0, -S / 2);
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(S, 0.42, S), wood);
    lidBox.position.set(0, 0.21, S / 2);
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(S + 0.02, 0.07, S + 0.02), dark);
    lidBand.position.set(0, 0.25, S / 2);
    lid.add(lidBox, lidBand);
    for (let k = 0; k < 10; k++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 5), tooth);
      t.rotation.x = Math.PI;
      t.position.set((k % 5) / 4 * (S - 0.2) - (S - 0.2) / 2, -0.05, k < 5 ? S - 0.08 : 0.25);
      lid.add(t);
    }
    root.add(lid);
    root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.h.scene.add(root);
    return { root, lid, glow, pos: pos.clone(), t: -1, cooldown: 0, yaw, requested: -99 };
  }

  private updateMaws(dt: number): void {
    const f = this.h.feet();
    this.maws.forEach((m, i) => {
      m.cooldown -= dt;
      const d = Math.hypot(f.x - m.pos.x, f.z - m.pos.z);
      if (m.t < 0) {
        // asleep: it breathes — the lid lifts a crack and a red line shows
        const br = Math.max(0, Math.sin(this.time * 1.1 + i * 2.1));
        m.lid.rotation.x = -0.015 - br * 0.03;
        m.glow.emissiveIntensity = 0.15 + br * 0.35;
        if (!this.warned && d < 4) { this.warned = true; this.h.audio.playAt('rBreath', m.pos.clone().setY(0.9), 0.5, 0.6, false); }
        // upright and close (or loud) → it wakes
        const loud = this.h.noise() > 6 && d < 4.5;
        const careless = !this.h.crouching() || this.h.speed() > 1.6;
        if (this.h.alive() && m.cooldown <= 0 && ((d < WAKE_DIST && careless) || loud) && this.time - m.requested > 1.5) {
          m.requested = this.time;
          this.h.authority().requestInteraction(`mech:maw:${i}`, this.h.camera.position.clone());
        }
        return;
      }
      // awake: turn to the nearest body, gape, snap shut
      m.t += dt;
      const want = Math.atan2(f.x - m.pos.x, f.z - m.pos.z);
      let dy = want - m.root.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (m.t < BITE_AT) m.root.rotation.y += dy * Math.min(1, dt * 10);
      const open = m.t < BITE_AT ? Math.min(1, m.t / 0.3) : Math.max(0, 1 - (m.t - BITE_AT) / 0.08);
      m.lid.rotation.x = -1.25 * open;
      m.glow.emissiveIntensity = 0.3 + open * 0.8;
      m.root.position.y = m.t < BITE_AT ? Math.sin(m.t * 40) * 0.01 : 0;
      if (m.t >= BITE_AT && m.t - dt < BITE_AT) {
        this.h.audio.playAt('bang', m.pos.clone().setY(1), 1.2, 0.7);
        if (d < BITE_DIST && this.h.alive()) this.h.hit(32, m.pos.clone().setY(1));
      }
      if (m.t > 1.4) { m.t = -1; m.cooldown = 22; m.root.position.y = 0; }
    });
  }

  private wakeMaw(i: number): void {
    const m = this.maws[i];
    if (!m || m.t >= 0) return;
    m.t = 0;
    this.h.audio.playAt('doorOpen', m.pos.clone().setY(1), 1.4, 0.45);
    this.h.audio.playAt('rScreech', m.pos.clone().setY(1), 0.9, 0.55);
    if (m.pos.distanceTo(this.h.feet()) < 8) this.h.toast('상자 더미가 입을 벌린다');
  }

  // ── Pipe Crawler ───────────────────────────────────────────
  private buildCrawler(pos: THREE.Vector3, out: THREE.Vector3): Crawler {
    const skin = this.h.world.baked.apply(new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.3, metalness: 0.1 }));
    const root = new THREE.Group();
    root.position.copy(pos).addScaledVector(out, 0.05);
    const arms: Crawler['arms'] = [];
    for (let a = 0; a < 3; a++) {
      const segs: THREE.Group[] = [];
      let parent: THREE.Object3D = root;
      for (let k = 0; k < 4; k++) {
        const g = new THREE.Group();
        if (k > 0) g.position.y = -0.42;
        const len = 0.42, r = 0.035 - k * 0.006;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 7), skin);
        m.position.y = -len / 2;
        g.add(m);
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 8, 6), skin);
        knuckle.position.y = -len;
        g.add(knuckle);
        parent.add(g);
        segs.push(g);
        parent = g;
      }
      for (let fgr = 0; fgr < 4; fgr++) {
        const fm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.2, 5), skin);
        fm.position.set((fgr - 1.5) * 0.018, -0.52, 0);
        fm.rotation.z = (fgr - 1.5) * 0.25;
        segs[3].add(fm);
      }
      arms.push({ segs, phase: a * 1.9 });
    }
    root.scale.setScalar(0.001);
    root.visible = false;
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.h.scene.add(root);
    return { root, arms, pos: pos.clone(), out: out.clone(), t: -1, cooldown: 0, requested: -99, target: new THREE.Vector3() };
  }

  private updateCrawlers(dt: number): void {
    const f = this.h.feet();
    this.crawlers.forEach((c, i) => {
      c.cooldown -= dt;
      const reachPt = c.pos.clone().addScaledVector(c.out, 0.9).setY(0);
      const d = Math.hypot(f.x - reachPt.x, f.z - reachPt.z);
      if (c.t < 0) {
        if (d < 5 && Math.random() < dt * 0.25) this.h.audio.playAt('vent', c.pos, 0.8, 0.8 + Math.random() * 0.3, false);
        if (this.h.alive() && c.cooldown <= 0 && d < 1.9 && !this.h.crouching() && this.h.noise() >= 3 && this.time - c.requested > 1.5) {
          c.requested = this.time;
          this.h.authority().requestInteraction(`mech:crawl:${i}`, this.h.camera.position.clone());
        }
        return;
      }
      c.t += dt;
      const ext = c.t < 0.5 ? c.t / 0.5 : c.t < 1.1 ? 1 : Math.max(0, 1 - (c.t - 1.1) / 0.6);
      c.root.visible = ext > 0.01;
      c.root.scale.setScalar(Math.max(0.001, ext));
      if (c.t < 0.8) c.target.copy(f).setY(1.2);
      // aim the arm cluster at the target, joints curling as they reach
      const dir = c.target.clone().sub(c.root.position).normalize();
      c.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      c.arms.forEach((arm, a) => {
        const spread = (a - 1) * 0.45;
        arm.segs[0].rotation.set(spread * 0.6, 0, spread);
        for (let k = 1; k < 4; k++) arm.segs[k].rotation.set(Math.sin(this.time * 9 + arm.phase + k) * 0.35 * (1 - ext * 0.6), 0, -spread * 0.4 + (c.t > 0.8 ? 0.5 : 0));
      });
      if (c.t >= 0.8 && c.t - dt < 0.8) {
        this.h.audio.playAt('hit', c.pos, 0.8, 0.7);
        const fd = Math.hypot(f.x - reachPt.x, f.z - reachPt.z);
        if (fd < 1.7 && this.h.alive() && !this.h.crouching()) this.h.hit(26, c.pos.clone());
      }
      if (c.t > 1.8) { c.t = -1; c.cooldown = 18; c.root.visible = false; c.root.scale.setScalar(0.001); }
    });
  }

  private wakeCrawler(i: number): void {
    const c = this.crawlers[i];
    if (!c || c.t >= 0) return;
    c.t = 0;
    this.h.audio.playAt('grate0', c.pos, 1.4, 0.7);
    this.h.audio.playAt('rScreech', c.pos, 0.7, 0.8);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.maws.length) this.updateMaws(dt);
    if (this.crawlers.length) this.updateCrawlers(dt);
  }

  onCustom(targetId: string): void {
    const [, kind, idx] = targetId.split(':');
    if (kind === 'maw') this.wakeMaw(Number(idx));
    if (kind === 'crawl') this.wakeCrawler(Number(idx));
  }

  dispose(): void {
    for (const m of this.maws) m.root.removeFromParent();
    for (const c of this.crawlers) c.root.removeFromParent();
  }
}
