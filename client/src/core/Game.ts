import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { NET, NOISE, PLAYER, SURVIVAL, WORLD } from '@shared/Constants';
import type { GameMode, PlayerInfo } from '@shared/GameTypes';
import { QUALITY_PRESETS, URL_FLAGS, type Settings } from './GameConfig';
import { GameLoop } from './GameLoop';
import { GameSession } from './GameSession';
import { Input } from './Input';
import { Renderer } from '../rendering/Renderer';
import { PhysicsWorld, loadRapier } from '../physics/PhysicsWorld';
import { World, type WorldEvent } from '../world/World';
import { worldToCell } from '../world/Level0Layout';
import { NOTES } from '../world/Notes';
import { PlayerController } from '../player/PlayerController';
import { Flashlight } from '../player/Flashlight';
import { AudioManager } from '../audio/AudioManager';
import { InteractionManager } from '../interaction/InteractionManager';
import { HUD } from '../ui/HUD';
import { escapeHtml } from '../ui/MainMenu';
import type { GameAuthority, AuthorityCallbacks } from '../multiplayer/GameAuthority';
import { LocalAuthority } from '../multiplayer/LocalAuthority';
import { HostAuthority } from '../multiplayer/HostAuthority';
import { RemoteAuthority } from '../multiplayer/RemoteAuthority';
import { RemotePlayers } from '../multiplayer/RemotePlayers';
import type { NetworkManager } from '../multiplayer/NetworkManager';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  settings: Settings;
  mode: GameMode;
  seed: number;
  sessionId: string;
  players?: PlayerInfo[];
  net?: NetworkManager;
  onProgress: (step: string, progress: number) => void;
  onExit: (reason?: string) => void;
  openSettings: (onClose: () => void) => void;
}

const FOG_LIT = new THREE.Color(0x5c4f2a);
const FOG_DARK = new THREE.Color(0x030302);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * Composition root for one play session. Every system here is identical in
 * single-player and multiplayer; only `authority` differs.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(PLAYER.FOV, 1, 0.05, 80);
  readonly session: GameSession;
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly hud = new HUD();
  physics!: PhysicsWorld;
  world!: World;
  player!: PlayerController;
  flashlight!: Flashlight;
  audio!: AudioManager;
  interaction!: InteractionManager;
  remotes!: RemotePlayers;
  authority!: GameAuthority;
  controls: PointerLockControls;
  private loop: GameLoop;
  private time = 0;
  private publishTimer = 0;
  private notesRead = new Set<number>();
  private batteriesFound = 0;
  private exposure = 1;
  private debugOn = URL_FLAGS.debug;
  private everLocked = false;
  private ended = false;
  private names = new Map<string, string>();
  private readonly preset;

  private constructor(private opts: GameOptions) {
    this.session = new GameSession(opts.sessionId, opts.mode, opts.seed);
    this.preset = QUALITY_PRESETS[URL_FLAGS.quality && URL_FLAGS.quality in QUALITY_PRESETS ? URL_FLAGS.quality : opts.settings.quality];
    this.renderer = new Renderer(opts.canvas, this.preset);
    this.controls = new PointerLockControls(this.camera, opts.canvas);
    this.loop = new GameLoop((dt) => this.fixedUpdate(dt), (dt, a) => this.frame(dt, a));
    for (const p of opts.players ?? []) {
      this.session.players.set(p.id, p);
      this.names.set(p.id, p.name);
    }
  }

  static async create(opts: GameOptions): Promise<Game> {
    const g = new Game(opts);
    await g.init();
    return g;
  }

  private async init(): Promise<void> {
    const o = this.opts;
    const preset = this.preset;
    // Authority — the only mode-specific piece. Created before the first await so
    // network events that arrive while the world is loading are buffered, not lost.
    const cb: AuthorityCallbacks = {
      onRemoteState: (id, st) => this.remotes?.onState(id, st),
      onPeerJoined: (id, name) => { this.names.set(id, name); this.remotes?.setName(id, name); this.hud.toast(`${name} 님이 백룸에 들어왔습니다`); },
      onPeerLeft: (id) => { this.hud.toast(`${this.names.get(id) ?? '생존자'} 님의 신호가 끊겼습니다`); this.remotes?.remove(id); },
      onSessionEnded: (reason) => this.exit(reason),
    };
    if (o.mode === 'single') this.authority = new LocalAuthority();
    else if (o.mode === 'host') this.authority = new HostAuthority(o.net!, cb);
    else this.authority = new RemoteAuthority(o.net!, cb);
    o.onProgress('물리 엔진 초기화', 0.1);
    await nextFrame();
    this.physics = new PhysicsWorld(await loadRapier());

    o.onProgress('Level 0 생성 · 조명 베이크 · 텍스처 생성', 0.3);
    await nextFrame();
    this.world = new World(this.session.mapSeed, this.physics, preset, this.renderer.maxAnisotropy);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.FogExp2(FOG_LIT.getHex(), 0.042);
    this.scene.background = new THREE.Color(0x000000);

    o.onProgress('플레이어 · 사운드 준비', 0.75);
    await nextFrame();
    this.scene.add(this.camera);
    const spawnIndex = Math.max(0, [...this.session.players.keys()].indexOf(o.net?.id ?? ''));
    const spawn = this.world.spawnPoint(spawnIndex);
    this.player = new PlayerController(this.physics, spawn, this.camera, this.input);
    this.camera.position.set(spawn.x, spawn.y + PLAYER.EYE_HEIGHT, spawn.z);
    this.camera.rotation.set(0, Math.PI * 0.25 * spawnIndex, 0, 'YXZ');
    this.flashlight = new Flashlight(preset.flashlightShadow);
    this.scene.add(this.flashlight.light, this.flashlight.target, this.flashlight.bounce);

    this.audio = new AudioManager(this.scene, this.camera);
    this.world.lighting.poolLights.forEach((l) => this.audio.attachHum(l));
    this.interaction = new InteractionManager(this.physics, this.world, this.player.collider);
    this.remotes = new RemotePlayers(this.audio, (p) => this.isOccluded(p));
    this.scene.add(this.remotes.group);
    this.names.forEach((n, id) => this.remotes.setName(id, n));

    this.player.onFootstep = (e) => this.audio.footstep(e.gait);
    this.player.onLand = (k) => this.audio.footstep(k > 0.6 ? 'run' : 'walk');
    this.world.onEvent = (e) => this.onWorldEvent(e);

    await this.authority.startSession(this.world);

    this.applySettings(o.settings);
    this.renderer.attach(this.scene, this.camera);
    this.renderer.resize(this.camera);
    window.addEventListener('resize', this.onResize);
    this.setupPointerLock();

    o.onProgress('셰이더 컴파일', 0.95);
    await nextFrame();
    this.renderer.renderer.compile(this.scene, this.camera);

    (window as unknown as { __LS?: Game }).__LS = this;
  }

  start(): void {
    void this.audio.resume().then(() => this.audio.startAmbience());
    this.loop.start();
    if (URL_FLAGS.debug) {
      this.input.enabled = true;
      this.hud.showPause(false);
    } else {
      this.input.enabled = false;
      this.hud.showPause(true, '<p class="big">화면을 클릭하여 시작</p><p>노란 벽지, 젖은 카펫, 끊이지 않는 형광등 소리.<br>당신은 Level 0에 noclip 되었다.</p>');
    }
    if (this.session.mode !== 'single') this.hud.toast(`협동 세션 · ${this.session.players.size}명`);
  }

  private setupPointerLock(): void {
    const tryLock = () => { if (!this.ended) Promise.resolve(this.controls.lock()).catch(() => undefined); };
    this.hud.root.querySelector('.pause')!.addEventListener('click', tryLock);
    this.opts.canvas.addEventListener('click', () => { if (!this.controls.isLocked) tryLock(); });
    this.controls.addEventListener('lock', () => {
      this.everLocked = true;
      this.input.enabled = true;
      this.input.flushPresses();
      this.hud.showPause(false);
      void this.audio.resume();
    });
    this.controls.addEventListener('unlock', () => {
      if (this.ended) return;
      this.input.enabled = URL_FLAGS.debug;
      this.input.clear();
      this.hud.hideNote();
      this.hud.showInventory(false);
      this.hud.showPause(true, this.pauseInfo());
    });
    this.hud.onPauseAction((act) => {
      if (act === 'resume') tryLock();
      else if (act === 'settings') this.opts.openSettings(() => this.applySettings(this.opts.settings));
      else this.exit();
    });
  }

  private pauseInfo(): string {
    const s = this.session;
    const mode = s.mode === 'single' ? '싱글플레이 · 게임이 일시정지되지 않습니다' : `${s.mode === 'host' ? '호스트' : '참가자'} · 방 코드 <strong>${escapeHtml(s.sessionId)}</strong> · ${this.remotes.count + 1}명`;
    return `<p>${this.everLocked ? '일시정지' : ''}</p><p class="dim">${mode}<br>Seed ${s.mapSeed}</p>`;
  }

  applySettings(s: Settings): void {
    this.controls.pointerSpeed = s.mouseSensitivity;
    this.audio.setMasterVolume(s.masterVolume);
    this.world.lighting.flickerIntensity = s.flickerIntensity;
    this.player.headBob = s.headBob;
    this.exposure = s.brightness;
  }

  private onResize = () => this.renderer.resize(this.camera);

  private isOccluded(p: THREE.Vector3): boolean {
    const from = this.camera.position;
    const dir = p.clone().sub(from);
    const d = dir.length();
    if (d < 0.01) return false;
    const hit = this.physics.castRay(from, dir.normalize(), d - 0.4, this.player.collider);
    return !!hit && !hit.collider.isSensor();
  }

  private onWorldEvent(e: WorldEvent): void {
    if (e.type === 'door') {
      const p = e.door.position();
      this.audio.playAt(e.state === 0 ? 'doorClose' : 'doorOpen', p, 1.4, 0.95 + Math.random() * 0.1, this.isOccluded(p));
      if (p.distanceTo(this.camera.position) < NOISE.DOOR) this.player.status.emitNoise(NOISE.DOOR * 0.6);
    } else if (e.type === 'item') {
      if (e.byPlayerId === this.authority.localPlayerId) {
        this.player.status.addBattery(SURVIVAL.BATTERY_PICKUP);
        this.batteriesFound++;
        this.audio.play('pickup', 0.8);
        this.hud.toast(`배터리를 넣었다  +${SURVIVAL.BATTERY_PICKUP}%`);
      } else {
        this.hud.toast(`${this.names.get(e.byPlayerId) ?? '다른 생존자'} 님이 배터리를 주웠습니다`);
      }
    }
  }

  private fixedUpdate(dt: number): void {
    this.player.flashlightOn = this.flashlight.on;
    this.player.fixedUpdate(dt);
    this.world.fixedUpdate(dt);
    this.physics.step();
  }

  private frame(dt: number, alpha: number): void {
    this.time += dt;
    const inp = this.input;

    // ── Actions ─────────────────────────────────────────────
    if (this.hud.noteOpen) {
      if (inp.wasPressed('KeyE') || inp.wasPressed('Escape')) { this.hud.hideNote(); this.audio.play('paper', 0.5); }
    } else {
      if (inp.wasPressed('KeyF')) {
        this.flashlight.toggle();
        this.audio.play('click', 0.5);
      }
      if (inp.wasPressed('KeyE') && this.interaction.focus) {
        const f = this.interaction.focus;
        if (f.kind === 'note') {
          const idx = this.world.level.notes.find((n) => n.id === f.id)?.noteIndex ?? 0;
          this.notesRead.add(idx);
          this.hud.showNote(NOTES[idx]);
          this.audio.play('paper', 0.7);
        } else {
          this.authority.requestInteraction(f.id, this.camera.position.clone());
        }
      }
    }
    if (inp.wasPressed('F3')) this.debugOn = !this.debugOn;
    const tab = inp.isDown('Tab');
    this.hud.showInventory(tab, tab ? this.inventoryLines() : []);

    // ── Systems ─────────────────────────────────────────────
    this.player.updateCamera(dt, alpha);
    const viewDir = this.camera.getWorldDirection(new THREE.Vector3());
    const beamHit = this.flashlight.on ? this.physics.castRay(this.camera.position, viewDir, 14, this.player.collider) : null;
    this.flashlight.update(dt, this.camera, this.player.status.battery, this.time, beamHit?.distance ?? Infinity);
    const viewer = this.camera.position;
    this.world.update(dt, this.time, viewer);
    this.interaction.update(this.camera);
    this.remotes.update(dt);
    this.authority.update(dt);

    const light = this.world.baked.sample(viewer.x, viewer.z) * this.world.lighting.power;
    this.audio.update(dt, light, viewer);

    // fog + gentle eye adaptation follow the local light level
    const lit = THREE.MathUtils.clamp(light / 0.9, 0, 1);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(FOG_DARK.clone().lerp(FOG_LIT, lit), 1 - Math.exp(-dt * 1.5));
    fog.density = THREE.MathUtils.lerp(0.075, 0.042, lit);
    this.renderer.setExposure(this.exposure * THREE.MathUtils.lerp(1.35, 1, lit));
    this.renderer.distress = 1 - lit;

    // ── HUD ─────────────────────────────────────────────────
    const st = this.player.status;
    this.hud.setPrompt(this.hud.noteOpen ? null : this.interaction.focus?.prompt() ?? null);
    this.hud.setMeters(st.stamina, st.battery, this.flashlight.on, st.noise, dt);
    if (this.debugOn) {
      const c = worldToCell(this.world.level, viewer.x, viewer.z);
      const info = this.renderer.renderer.info.render;
      this.hud.setDebug(
        `${this.loop.fps.toFixed(0)} fps · draw ${info.calls} · tris ${(info.triangles / 1000).toFixed(1)}k\n` +
        `pos ${viewer.x.toFixed(1)}, ${viewer.y.toFixed(2)}, ${viewer.z.toFixed(1)} · cell ${c.cx},${c.cy}${this.world.level.dark[c.cy]?.[c.cx] ? ' (dark)' : ''}\n` +
        `light ${light.toFixed(2)} · noise ${st.noise.toFixed(1)}m · ${this.player.grounded ? 'ground' : 'air'}\n` +
        `seed ${this.session.mapSeed} · ${this.session.mode} · peers ${this.remotes.count}`,
      );
    } else this.hud.setDebug(null);

    // ── Network ─────────────────────────────────────────────
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publishTimer = 1 / NET.PLAYER_STATE_HZ;
      this.authority.publishState(this.player.netState(this.flashlight.on));
    }

    this.renderer.render(this.scene, this.camera, this.time);
  }

  private inventoryLines(): string[] {
    const st = this.player.status;
    return [
      `손전등 — 배터리 ${Math.ceil(st.battery)}%${this.flashlight.on ? ' (켜짐)' : ''}`,
      `찾은 배터리 — ${this.batteriesFound}개`,
      `문서 — ${this.notesRead.size} / ${NOTES.length}`,
      `<span class="dim">신호 녹음기 — 아직 찾지 못했다</span>`,
    ];
  }

  /** Teleport helper for testing (window.__LS.debugTeleport(cx, cy)). */
  debugTeleport(cx: number, cy: number): void {
    const s = WORLD.CELL_SIZE;
    const L = this.world.level;
    this.player.teleport(new THREE.Vector3((cx + 0.5) * s - (L.w * s) / 2, 0.05, (cy + 0.5) * s - (L.h * s) / 2));
  }

  exit(reason?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.loop.stop();
    if (this.controls.isLocked) this.controls.unlock();
    this.authority?.shutdown();
    this.dispose();
    this.opts.onExit(reason);
  }

  private dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.input.dispose();
    this.audio?.dispose();
    this.remotes?.dispose();
    this.world?.dispose();
    this.physics?.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    delete (window as unknown as { __LS?: Game }).__LS;
  }
}
