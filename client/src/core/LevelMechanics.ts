import * as THREE from 'three';
import { SeededRandom } from '@shared/Random';
import { WORLD } from '@shared/Constants';
import type { World } from '../world/World';
import type { EntityManager } from '../entities/EntityManager';
import type { ReceiverAI } from '../entities/ReceiverAI';
import type { GameAuthority } from '../multiplayer/GameAuthority';
import type { HUD } from '../ui/HUD';
import type { AudioManager } from '../audio/AudioManager';
import type { Input } from './Input';
import type { Flashlight } from '../player/Flashlight';
import type { Recorder } from '../player/Recorder';
import { cellCenter, worldToCell } from '../world/Level0Layout';
import type { LevelTheme } from '../world/levels/Themes';

/** What a level mechanic may touch — a narrow view of Game. */
export interface MechanicHost {
  level: number;
  theme: LevelTheme;
  world: World;
  entities: EntityManager;
  authority: GameAuthority;
  hud: HUD;
  audio: AudioManager;
  input: Input;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  flashlight: Flashlight;
  recorder: Recorder;
  feet(): THREE.Vector3;
  teleport(p: THREE.Vector3): void;
  alive(): boolean;
  name(id: string): string;
  envDamage(amount: number, from?: THREE.Vector3): void;
  emitNoise(radius: number): void;
  isOccluded(p: THREE.Vector3): boolean;
}

/**
 * The one thing that makes each level of the Expanded Campaign play differently
 * (expansion spec §3). Everything that changes shared state goes through the
 * authority as `mech:*` events, so single-player and multiplayer behave the same;
 * purely personal effects (CCTV view, scanner, teleporting doors) stay local.
 */
export class LevelMechanics {
  private rng: SeededRandom;
  private lureCooldown = 0;
  private cctv = false;
  private cctvPose: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private savedCam = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private liveCells = new Set<string>();
  private sparks: THREE.Sprite[] = [];
  private sparkTimer = 0;
  private trainTimer = 30;
  private train: { mesh: THREE.Group; x: number; dir: number; hit: boolean } | null = null;
  private trainMesh: THREE.Group | null = null;
  private trainLoop: THREE.Audio | null = null;
  private resonance = -1;
  private teleportDoors: string[] = [];
  private tpCooldown = 0;
  private lures: { sprite: THREE.Object3D; light?: THREE.PointLight; until: number }[] = [];
  private time = 0;
  private drained = false;
  private announceTimer = 18;

  constructor(private h: MechanicHost) {
    const L = h.world.level;
    this.rng = new SeededRandom(L.seed ^ 0x3ec4);
    h.entities.onAI = (ai) => this.configureAI(ai);
    if (h.entities.ai) this.configureAI(h.entities.ai);

    if (h.level === 8) h.entities.hideRule = (p) => this.undertowHidden(p);
    if (h.level === 9) h.entities.hideRule = () => !this.cctv;
    if (h.level === 4) {
      // three doors that do not lead where they should
      this.teleportDoors = this.rng.shuffle([...h.world.doors.keys()]).slice(0, 3);
    }
    if (h.level === 6) {
      // live water: a few flooded cells carry current from a fallen cable
      for (const w of L.water) if (this.rng.chance(0.3)) this.liveCells.add(`${w.cx},${w.cy}`);
    }
    if (h.level === 7) this.buildTrain();
  }

  private configureAI(ai: ReceiverAI): void {
    if (this.h.level === 5) ai.freezeWhenWatched = true;
  }

  private has(key: string): boolean {
    return this.h.world.hasKey(key);
  }

  private keyName(key: string): string {
    return this.h.theme.keys.find((k) => k.key === key)?.name ?? key;
  }

  // ── Objective line ─────────────────────────────────────────
  objective(): string {
    const w = this.h.world;
    const n = w.activeRelays, total = w.relays.size;
    if (w.elevator.powered) return this.h.theme.exitKind === 'radio'
      ? (w.elevator.open ? '무전실에서 선택하라 — 송신, 또는 침묵' : '무전실로 가라')
      : '아래로 내려가는 계단을 찾아라';
    const missing = this.h.theme.keys.filter((k) => w.level.keys?.some((s) => s.key === k.key) && !this.has(k.key) && this.h.theme.devices.some((d) => d.needs === k.key));
    const extra = this.h.level === 10 && this.resonance >= 0 ? ` · 공명 ${Math.max(0, Math.ceil(40 - (this.time - this.resonance)))}초` : '';
    return `${this.h.theme.objective} (${n}/${total})${missing.length ? ` · 필요: ${missing.map((k) => k.name).join(', ')}` : ''}${extra}`;
  }

  /** E on a device the team cannot use yet: say what is missing (returns true if locked). */
  lockedToast(relayId: string): boolean {
    const miss = this.h.world.missingKey(relayId);
    if (!miss) return false;
    this.h.audio.play('click', 0.4, 0.6);
    this.h.hud.toast(`잠겨 있다 — ${this.keyName(miss)}이(가) 필요하다`);
    return true;
  }

  // ── Events ─────────────────────────────────────────────────
  onKey(itemId: string, byPlayerId: string): void {
    const key = [...this.h.world.keyItems.entries()].find(([, it]) => it.id === itemId)?.[0];
    if (!key) return;
    const def = this.h.theme.keys.find((k) => k.key === key)!;
    const who = byPlayerId === this.h.authority.localPlayerId ? '' : `${this.h.name(byPlayerId)} 님이 `;
    this.h.audio.play('pickup', 0.8, 0.9);
    this.h.hud.toast(`${who}${def.name}을(를) 찾았다 — ${def.hint}`, 5200);
    if (key === 'surgical-flashlight' || key === 'diving-light') this.h.flashlight.boost = 1.6;
  }

  onRelay(): void {
    const w = this.h.world;
    // Archive: the records shift — every door swaps state (host decides, everyone sees)
    if (this.h.level === 3 && this.h.authority.simulates) {
      for (const d of w.doors.values()) this.h.authority.worldEvent(d.id, d.state === 0 ? 1 : 0);
      this.h.hud.toast('서가가 움직인다 — 문들이 바뀌었다');
    }
    // Last Signal: the first resonator starts a 40 s window
    if (this.h.level === 10 && this.resonance < 0 && w.activeRelays < w.relays.size) this.resonance = this.time;
  }

  onPower(): void {
    if (this.h.level === 6) this.drain();
    if (this.h.level === 7 && this.trainLoop?.isPlaying) this.trainLoop.stop();
    this.resonance = -1;
  }

  /** `mech:*` events from the authority (same on every machine). */
  onCustom(targetId: string, byPlayerId: string): void {
    const [, kind, ...rest] = targetId.split(':');
    if (kind === 'lure') this.spawnLure(Number(rest[0]), Number(rest[1]), rest[2]);
    else if (kind === 'noise') { if (this.h.authority.simulates) this.h.entities.hearNoise(new THREE.Vector3(Number(rest[0]), 0, Number(rest[1])), Number(rest[2])); }
    else if (kind === 'train') this.startTrain(Number(rest[0]), rest[1] === '1');
    void byPlayerId;
  }

  /** reading a document: in the Archive the Indexer hears paper */
  onRead(): void {
    if (this.h.level !== 3) return;
    const f = this.h.feet();
    this.h.authority.requestInteraction(`mech:noise:${f.x.toFixed(1)}:${f.z.toFixed(1)}:16`, this.h.camera.position.clone());
  }

  // ── Per frame ──────────────────────────────────────────────
  update(dt: number): void {
    this.time += dt;
    const h = this.h, inp = h.input;
    this.lureCooldown -= dt;
    this.tpCooldown -= dt;

    // G: throw a lure (tape recorder / hotel bell / flare)
    const lureKey = h.level === 3 ? 'old-recorder' : h.level === 4 ? 'hotel-bell' : h.level === 7 ? 'emergency-flare' : null;
    if (lureKey && inp.wasPressed('KeyG') && h.alive()) {
      if (!this.has(lureKey)) h.hud.toast(`${this.keyName(lureKey)}이(가) 없다`);
      else if (this.lureCooldown > 0) h.hud.toast(`아직 쓸 수 없다 (${Math.ceil(this.lureCooldown)}초)`);
      else {
        this.lureCooldown = 20;
        const dir = h.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const hit = h.isOccluded(h.camera.position.clone().addScaledVector(dir, 9)) ? 4 : 9;
        const p = h.camera.position.clone().addScaledVector(dir, hit);
        h.authority.requestInteraction(`mech:lure:${p.x.toFixed(1)}:${p.z.toFixed(1)}:${h.level}`, h.camera.position.clone());
      }
    }
    for (let i = this.lures.length - 1; i >= 0; i--) {
      const l = this.lures[i];
      if (l.light) l.light.intensity = 3 + Math.random() * 1.5;
      if (this.time > l.until) { l.sprite.removeFromParent(); l.light?.removeFromParent(); this.lures.splice(i, 1); }
    }

    // Level 5: the medical scanner reads the nearest heartbeat
    if (h.level === 5 && this.has('medical-scanner')) {
      const d = h.entities.present ? h.entities.pose.p.distanceTo(h.feet()) : Infinity;
      h.hud.setScanner(d < 30 ? `♥ 생체 신호  ${d.toFixed(0)} m${h.entities.ai?.frozen ? '  — 멈춤' : ''}` : '♥ 생체 신호 없음', d < 10 ? 1 : 0);
    }

    // Level 4: some doors lead somewhere else
    if (h.level === 4 && this.tpCooldown <= 0 && h.alive()) {
      const f = h.feet();
      for (const id of this.teleportDoors) {
        const door = h.world.doors.get(id);
        if (!door || door.state === 0 || door.position().setY(0).distanceTo(f.clone().setY(0)) > 0.45) continue;
        const L = h.world.level;
        const far = this.rng.int(0, 999);
        let best = { cx: L.spawn.cx, cy: L.spawn.cy };
        for (let k = 0; k < 40; k++) {
          const cx = (far + k * 7) % L.w, cy = (far * 3 + k * 11) % L.h;
          const c = cellCenter(L, cx, cy);
          if (Math.hypot(c.x - f.x, c.z - f.z) > 15 && !L.water.some((w) => w.cx === cx && w.cy === cy)) { best = { cx, cy }; break; }
        }
        const c = cellCenter(L, best.cx, best.cy);
        h.teleport(new THREE.Vector3(c.x, 0.05, c.z));
        h.audio.play('doorClose', 0.8, 0.8);
        h.hud.toast('…방금 지나온 복도와 똑같다');
        this.tpCooldown = 8;
        break;
      }
    }

    // Level 6: live water shocks you unless you have insulated gloves; the Drowned is fast in water
    if (h.level === 6) {
      const f = h.feet();
      const c = worldToCell(h.world.level, f.x, f.z);
      if (!this.drained && this.liveCells.has(`${c.cx},${c.cy}`) && h.alive() && !h.world.blackout) {
        if (!this.has('insulated-gloves')) {
          h.envDamage(9 * dt);
          if (Math.random() < dt * 3) h.audio.play('staticBurst', 0.3, 1.6);
        }
      }
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0 && !this.drained && !h.world.blackout) {
        this.sparkTimer = 0.6 + Math.random();
        const cells = [...this.liveCells];
        if (cells.length) {
          const [cx, cy] = cells[Math.floor(Math.random() * cells.length)].split(',').map(Number);
          const cc = cellCenter(h.world.level, cx, cy);
          const p = new THREE.Vector3(cc.x + (Math.random() - 0.5) * 2, 0.08, cc.z + (Math.random() - 0.5) * 2);
          if (p.distanceTo(f) < 18) { this.spark(p); h.audio.playAt('staticBurst', p, 0.6, 1.8, h.isOccluded(p)); }
        }
      }
      const ai = h.entities.ai;
      if (ai) ai.speedMul = h.world.isWater(ai.pos.x, ai.pos.z) && !this.drained ? 1.5 : 0.65;
    }

    // Level 7: trains on the line, false announcements; the Conductor rushes along the rails
    if (h.level === 7) {
      const L = h.world.level;
      if (h.authority.simulates && !h.world.elevator.powered && !this.train) {
        this.trainTimer -= dt;
        if (this.trainTimer <= 0) {
          this.trainTimer = 26 + Math.random() * 18;
          h.authority.worldEvent(`mech:train:${Math.random() < 0.5 ? 1 : -1}:${Math.random() < 0.25 ? 1 : 0}`, 1);
        }
      }
      this.updateTrain(dt);
      const ai = h.entities.ai;
      if (ai && L.rail) ai.speedMul = worldToCell(L, ai.pos.x, ai.pos.z).cy === L.rail.cy ? 1.5 : 1;
      this.announceTimer -= dt;
      if (this.announceTimer <= 0) {
        this.announceTimer = 35 + Math.random() * 30;
        const lines = ['곧 열차가 도착합니다. 안전선 밖으로 물러나 주십시오.', '이번 열차는 종착역으로 가는 열차입니다. 이번 열차는 종착역에서 출발한 열차입니다.', '승객 여러분께 알려 드립니다. 이 역에는 승객이 없습니다.', '…지금 승강장에 계신 손님, 뒤를 돌아보지 마십시오.'];
        h.hud.setSubtitle(lines[Math.floor(Math.random() * lines.length)], '안내 방송');
        setTimeout(() => h.hud.setSubtitle(null), 4200);
      }
    }

    // Level 9: hold C to look through the nearest CCTV camera — the only way to see it
    if (h.level === 9) {
      const want = inp.isDown('KeyC') && this.has('camera-remote') && h.alive();
      if (want && !this.cctv) { this.cctv = true; this.cctvPose = this.pickCamera(); h.audio.play('click', 0.5, 1.4); }
      if (!want && this.cctv) { this.cctv = false; this.cctvPose = null; }
      h.hud.setCCTV(this.cctv ? `CAM ${String(Math.floor(this.time) % 97).padStart(2, '0')} · ${new Date().toTimeString().slice(0, 8)}` : null);
    }

    // Level 10: the resonators must all run together
    if (h.level === 10 && this.resonance >= 0 && h.authority.simulates && !h.world.elevator.powered && this.time - this.resonance > 40) {
      this.resonance = -1;
      for (const r of h.world.relays.values()) if (r.active) h.authority.worldEvent(r.id, -1);
      h.authority.worldEvent('mech:noise:0:0:999', 1);
    }
    if (h.level === 10 && this.resonance >= 0 && h.world.activeRelays === 0) this.resonance = -1;
  }

  /** Called by Game right before rendering: swap the camera to the CCTV pose for this frame. */
  beginRender(): boolean {
    if (!this.cctv || !this.cctvPose) return false;
    const c = this.h.camera;
    this.savedCam.p.copy(c.position);
    this.savedCam.q.copy(c.quaternion);
    c.position.copy(this.cctvPose.pos);
    c.lookAt(this.h.feet().clone().setY(1.0));
    return true;
  }

  endRender(): void {
    this.h.camera.position.copy(this.savedCam.p);
    this.h.camera.quaternion.copy(this.savedCam.q);
  }

  get cctvActive(): boolean { return this.cctv; }

  private pickCamera(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    // a ceiling corner a few metres behind you, facing your way
    const h = this.h;
    const f = h.feet();
    const back = h.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().negate();
    const top = h.world.level.ceiling - 0.25;
    for (const d of [6, 4.5, 3, 1.8]) {
      const p = f.clone().addScaledVector(back, d).setY(top);
      if (!h.isOccluded(p)) return { pos: p, look: f.clone() };
    }
    return { pos: f.clone().setY(top), look: f.clone() };
  }

  private undertowHidden(p: THREE.Vector3): boolean {
    const h = this.h;
    if (!h.world.isWater(p.x, p.z)) return false;
    if (p.distanceTo(h.feet()) < 3.2) return false;               // the surface breaks when it is close
    if (this.has('waterproof-recorder') && h.recorder.on) return false; // the waterproof recorder hears it
    return true;
  }

  private spawnLure(x: number, z: number, kind: string): void {
    const h = this.h;
    const p = new THREE.Vector3(x, 0.15, z);
    const lv = Number(kind);
    if (lv === 4) { h.audio.playAt('ding', p, 2.2, 1.15); setTimeout(() => h.audio.playAt('ding', p, 1.8, 1.15), 600); }
    else if (lv === 3) h.audio.playAt('whisper0', p, 2.0, 0.9);
    else h.audio.playAt('steam', p, 1.4, 1.8);
    const mat = new THREE.SpriteMaterial({ color: lv === 7 ? 0xff3020 : 0xffd080, transparent: true, opacity: 0.9, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(lv === 7 ? 0.5 : 0.18);
    s.position.copy(p);
    h.scene.add(s);
    let light: THREE.PointLight | undefined;
    if (lv === 7) { light = new THREE.PointLight(0xff3020, 4, 9, 1.6); light.position.copy(p).setY(0.4); h.scene.add(light); }
    this.lures.push({ sprite: s, light, until: this.time + (lv === 7 ? 14 : 4) });
    // the creature goes to it — far further than it hears anything else
    if (h.authority.simulates) h.entities.hearNoise(p, lv === 4 ? 80 : 40);
  }

  private spark(p: THREE.Vector3): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xa8d8ff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(p);
    s.scale.setScalar(0.25);
    this.h.scene.add(s);
    this.sparks.push(s);
    setTimeout(() => { s.removeFromParent(); s.material.dispose(); this.sparks.splice(this.sparks.indexOf(s), 1); }, 120);
  }

  private drain(): void {
    this.drained = true;
    this.h.world.drainWater();
    this.h.hud.toast('펌프가 돌아간다 — 물이 빠진다');
  }

  // ── Level 7 trains ─────────────────────────────────────────
  private buildTrain(): void {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x8a8d8f, roughness: 0.5, metalness: 0.6 });
    const glass = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    for (let car = 0; car < 2; car++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(11, 3.0, 2.3), body);
      m.position.set(car * 11.4 - 5.7, 1.6, 0);
      g.add(m);
      for (let w = 0; w < 5; w++) for (const side of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), glass);
        win.position.set(car * 11.4 - 5.7 - 4 + w * 2, 2.1, side * 1.16);
        win.rotation.y = side > 0 ? 0 : Math.PI;
        g.add(win);
      }
    }
    const head = new THREE.PointLight(0xfff0c0, 0, 20, 1.5);
    head.name = 'head';
    g.add(head);
    g.visible = false;
    this.h.scene.add(g);
    this.trainMesh = g;
  }

  private startTrain(dir: number, fake: boolean): void {
    const h = this.h;
    h.hud.setSubtitle(fake ? '열차가 들어옵니다. 열차가 들어옵니다.' : '열차가 들어옵니다 — 선로에서 떨어지십시오', '안내 방송');
    setTimeout(() => h.hud.setSubtitle(null), 3500);
    if (fake) { h.audio.play('rumble', 0.25, 0.7); return; } // the announcement lies
    if (!this.trainMesh) return;
    this.train = { mesh: this.trainMesh, x: -dir * 60, dir, hit: false };
    this.trainLoop?.stop();
    this.trainLoop = h.audio.loop('rumble', 0);
  }

  private updateTrain(dt: number): void {
    const t = this.train;
    const L = this.h.world.level;
    if (!t || !L.rail) return;
    const rz = cellCenter(L, 0, L.rail.cy).z;
    t.x += t.dir * 22 * dt;
    t.mesh.visible = true;
    t.mesh.position.set(t.x, 0, rz);
    t.mesh.rotation.y = t.dir > 0 ? 0 : Math.PI;
    const head = t.mesh.getObjectByName('head') as THREE.PointLight;
    head.intensity = 6;
    head.position.set(6, 1.6, 0);
    const f = this.h.feet();
    const near = Math.abs(f.x - t.x);
    if (this.trainLoop) this.trainLoop.setVolume(Math.max(0, 1 - near / 45) * 0.9);
    // masks every noise near the line while it passes
    if (near < 25) this.h.emitNoise(0);
    if (!t.hit && near < 11.5 && Math.abs(f.z - rz) < WORLD.CELL_SIZE / 2 + 0.2 && this.h.alive()) {
      t.hit = true;
      this.h.envDamage(70, new THREE.Vector3(t.x, 0, rz));
      this.h.hud.toast('열차에 치였다');
    }
    if (Math.abs(t.x) > 60 && Math.sign(t.x) === t.dir) {
      t.mesh.visible = false;
      this.train = null;
      this.trainLoop?.stop();
      this.trainLoop = null;
    }
  }

  dispose(): void {
    this.trainLoop?.stop();
    this.trainMesh?.removeFromParent();
    for (const l of this.lures) { l.sprite.removeFromParent(); l.light?.removeFromParent(); }
    this.h.hud.setScanner(null);
    this.h.hud.setCCTV(null);
  }
}
