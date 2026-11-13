import * as THREE from 'three';
import { NET, PLAYER } from '@shared/Constants';
import type { PlayerNetState } from '@shared/GameTypes';
import type { AudioManager } from '../audio/AudioManager';
import type { AITarget } from '../entities/ReceiverAI';

interface Snapshot { t: number; p: THREE.Vector3; yaw: number; pitch: number; c: boolean; f: boolean; s: number; n: number; d: boolean; dn: boolean }

class RemoteAvatar {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private light: THREE.SpotLight;
  private target = new THREE.Object3D();
  private buffer: Snapshot[] = [];
  private stepAccum = 0;
  private crouchK = 0;
  readonly pos = new THREE.Vector3();
  speed = 0;
  lastSeen = performance.now();
  latest?: PlayerNetState;
  offline = false;

  private materials: { body: THREE.Material; head: THREE.Material };
  setGhost(ghost: THREE.Material | null): void {
    this.body.material = ghost ?? this.materials.body;
    this.head.material = ghost ?? this.materials.head;
  }

  constructor(name: string, materials: { body: THREE.Material; head: THREE.Material }) {
    this.materials = materials;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.95, 6, 12), materials.body);
    this.body.position.y = 0.27 + 0.475 + 0.02;
    this.body.castShadow = true;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), materials.head);
    this.head.position.y = 1.58;
    this.head.castShadow = true;
    this.light = new THREE.SpotLight(0xfff4e0, 0, 18, THREE.MathUtils.degToRad(24), 0.55, 1.6);
    this.light.position.set(0.18, 1.4, -0.1);
    this.light.target = this.target;
    this.target.position.set(0.18, 1.2, -5);
    this.root.add(this.body, this.head, this.light, this.target, makeNameTag(name));
  }

  push(st: PlayerNetState, now: number): void {
    this.lastSeen = now;
    this.buffer.push({ t: now, p: new THREE.Vector3(...st.p), yaw: st.r[0], pitch: st.r[1], c: st.c, f: st.f, s: st.s, n: st.n, d: st.d, dn: st.dn });
    this.latest = st;
    if (this.buffer.length > 30) this.buffer.shift();
  }

  update(dt: number, now: number, audio: AudioManager, occluded: (p: THREE.Vector3) => boolean): void {
    const renderT = now - NET.INTERPOLATION_DELAY_MS;
    const b = this.buffer;
    if (!b.length) return;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= renderT && b[i + 1].t >= renderT) { a = b[i]; c = b[i + 1]; break; }
    }
    const span = c.t - a.t;
    const k = span > 0 ? THREE.MathUtils.clamp((renderT - a.t) / span, 0, 1) : 1;
    this.pos.lerpVectors(a.p, c.p, k);
    let dy = c.yaw - a.yaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = a.yaw + dy * k;
    const pitch = a.pitch + (c.pitch - a.pitch) * k;
    this.root.position.copy(this.pos);
    this.root.rotation.y = yaw;
    this.crouchK += ((c.c ? 1 : 0) - this.crouchK) * Math.min(1, dt * 10);
    const sy = 1 - this.crouchK * ((PLAYER.STAND_HEIGHT - PLAYER.CROUCH_HEIGHT) / PLAYER.STAND_HEIGHT);
    this.body.scale.y = sy;
    this.body.position.y = (0.27 + 0.475 + 0.02) * sy;
    this.head.position.y = 1.58 * sy + 0.02;
    this.light.position.y = 1.4 * sy;
    this.target.position.set(0.18, this.light.position.y + Math.sin(pitch) * 5, -Math.cos(pitch) * 5);
    this.light.intensity = c.f && !c.d ? 16 : 0;
    this.root.visible = !c.d;
    // downed: lying on the carpet
    this.root.rotation.x = c.dn ? -Math.PI / 2 + 0.15 : 0;
    if (c.dn) this.root.position.y = this.pos.y + 0.28;
    this.speed = c.s;

    // footsteps from replicated speed (stride ≈ 0.75 m walking, 1 m running)
    if (c.s > 0.5) {
      const stride = c.c ? 0.55 : c.s > 5 ? 1.0 : 0.75;
      this.stepAccum += (c.s * dt) / stride;
      if (this.stepAccum >= 1) {
        this.stepAccum -= 1;
        const at = this.pos.clone().setY(this.pos.y + 0.05);
        audio.footstep(c.c ? 'crouch' : c.s > 5 ? 'run' : 'walk', at, occluded(at.clone().setY(at.y + 1)));
      }
    } else {
      this.stepAccum = 0.5;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}

function makeNameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(250, ctx.measureText(name).width + 28);
  ctx.fillRect(128 - w / 2, 12, w, 40);
  ctx.fillStyle = '#efe6c8';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 }));
  s.scale.set(0.8, 0.2, 1);
  s.position.y = 1.95;
  return s;
}

/** Other survivors: interpolated ~110 ms in the past for smooth motion (design doc 8-2). */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private avatars = new Map<string, RemoteAvatar>();
  private names = new Map<string, string>();
  private ghost = new THREE.MeshBasicMaterial({ color: 0x9aa7b0, transparent: true, opacity: 0.25, depthWrite: false });
  private offline = new Set<string>();
  private materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.85 }),
    head: new THREE.MeshStandardMaterial({ color: 0xb48f74, roughness: 0.7 }),
  };

  constructor(private audio: AudioManager, private occluded: (p: THREE.Vector3) => boolean) {}

  setName(id: string, name: string): void {
    this.names.set(id, name);
  }

  onState(id: string, st: PlayerNetState): void {
    let a = this.avatars.get(id);
    if (!a) {
      a = new RemoteAvatar(this.names.get(id) ?? 'Survivor', this.materials);
      if (this.offline.has(id)) { a.offline = true; a.setGhost(this.ghost); }
      this.avatars.set(id, a);
      this.group.add(a.root);
    }
    a.push(st, performance.now());
  }

  remove(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    this.group.remove(a.root);
    a.dispose();
    this.avatars.delete(id);
  }

  /** What the host's AI may know about remote players (latest, un-delayed state). */
  targets(): AITarget[] {
    const out: AITarget[] = [];
    for (const [id, a] of this.avatars) {
      const s = a.latest;
      if (!s || a.offline) continue;
      const feet = new THREE.Vector3(...s.p);
      const [yaw, pitch] = s.r;
      // camera convention: yaw/pitch in YXZ order, looking down -Z at yaw 0
      const viewDir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const eye = feet.clone().setY(feet.y + (s.c ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT));
      out.push({ id, feet, crouching: s.c, flashlight: s.f, noise: s.n, dead: s.d || s.dn, speed: s.s, eye, viewDir });
    }
    return out;
  }

  /** Connection state of a teammate (offline avatars become translucent and stop counting). */
  setOnline(id: string, online: boolean): void {
    if (online) this.offline.delete(id); else this.offline.add(id);
    const a = this.avatars.get(id);
    if (!a) return;
    a.offline = !online;
    a.lastSeen = performance.now();
    a.setGhost(online ? null : this.ghost);
  }

  /** Teammates and their state, for the Tab panel. */
  roster(): { id: string; name: string; status: string }[] {
    const ids = new Set([...this.names.keys(), ...this.avatars.keys()]);
    return [...ids].map((id) => {
      const s = this.avatars.get(id)?.latest;
      const status = this.offline.has(id) ? '연결 끊김' : !s ? '대기' : s.d ? '신호 소실' : s.dn ? '쓰러짐' : '생존';
      return { id, name: this.names.get(id) ?? 'Survivor', status };
    });
  }

  forgetName(id: string): void {
    this.names.delete(id);
    this.offline.delete(id);
  }

  /** A downed teammate within reach that the camera is roughly facing. */
  downedNear(eye: THREE.Vector3, dir: THREE.Vector3, reach: number): string | null {
    for (const [id, a] of this.avatars) {
      if (!a.latest?.dn) continue;
      const p = new THREE.Vector3(...a.latest.p).setY(a.latest.p[1] + 0.3);
      const to = p.clone().sub(eye);
      if (to.length() > reach + 0.8) continue;
      if (dir.dot(to.normalize()) > 0.55) return id;
    }
    return null;
  }

  get count(): number {
    return this.avatars.size;
  }

  update(dt: number): void {
    const now = performance.now();
    for (const [id, a] of this.avatars) {
      if (a.offline) continue; // frozen in place until they return or the slot expires
      if (now - a.lastSeen > 8000) { this.remove(id); continue; }
      a.update(dt, now, this.audio, this.occluded);
    }
  }

  /** remove every avatar (going solo after the connection was lost) */
  clear(): void {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }

  dispose(): void {
    for (const id of [...this.avatars.keys()]) this.remove(id);
    this.materials.body.dispose();
    this.materials.head.dispose();
  }
}
