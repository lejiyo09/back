import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { NET, NOISE, OBJECTIVE, PLAYER, PLAYER_HEALTH, RECEIVER, SURVIVAL, WORLD } from '@shared/Constants';
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
import { EntityManager } from '../entities/EntityManager';
import type { AITarget } from '../entities/ReceiverAI';
import { Recorder } from '../player/Recorder';
import { ScareDirector } from '../horror/ScareDirector';
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
  entities!: EntityManager;
  private dead = false;
  private respawnTimer = 0;
  private entityPublishTimer = 0;
  private spawnIndex = 0;
  private hitKick = 0;
  private forceLook = 0;
  recorder!: Recorder;
  scares!: ScareDirector;
  private downed = false;
  private bleedTimer = 0;
  private holdTarget: string | null = null;
  private holdProgress = 0;
  private reviveFocus: string | null = null;
  private powerSeq = -1;
  private endingSeq = -1;
  private endingFreq = -1;
  private lastRelayPos = new THREE.Vector3();
  private deaths = 0;

  /** Accessibility: the flicker-intensity setting also scales screen glitching. */
  private settingsGlitch(v: number): number {
    return Math.min(1, v) * (0.25 + 0.75 * this.opts.settings.flickerIntensity);
  }
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
      onEntityStates: (list) => this.entities?.applySnapshots(list),
      getLocal: () => ({ pos: this.player.feet.clone(), downed: this.downed, dead: this.dead }),
      onHit: (hit) => this.onHit(hit.damage, new THREE.Vector3(hit.from[0], 0, hit.from[1])),
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
    this.spawnIndex = spawnIndex;
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

    // The Receiver — simulated here in single-player / on the host, replicated on clients.
    this.entities = new EntityManager({
      scene: this.scene,
      world: this.world,
      physics: this.physics,
      audio: this.audio,
      simulate: this.authority.simulates,
      seed: this.session.entitySeed,
      enabled: URL_FLAGS.ai !== 'off',
      // ?ai=now → compressed reveal for testing; ?ai=hunt → skip the reveal entirely
      revealMode: URL_FLAGS.ai === 'hunt' ? 'skip' : URL_FLAGS.ai === 'now' ? 'fast' : 'normal',
      ignoreColliders: [this.player.collider],
      hooks: {
        openDoor: (id, from) => this.authority.entityRequest(id, from),
        hit: (targetId, damage, from) => {
          if (targetId === this.authority.localPlayerId) this.onHit(damage, from);
          else this.authority.deliverHit({ target: targetId, damage, from: [from.x, from.z] });
        },
      },
    });

    // Signal Recorder + Scare Director (both local to this player)
    this.recorder = new Recorder(this.audio, this.world);
    this.recorder.onSubtitle = (text, title) => this.hud.setSubtitle(text, title ? `녹음기 · ${title}` : '');
    this.scares = new ScareDirector({
      camera: this.camera,
      feet: () => this.player.feet,
      hasRecorder: () => this.recorder.has,
      progress: () => this.world.activeRelays / OBJECTIVE.RELAY_COUNT,
      blocked: () => this.dead || this.downed || this.hud.noteOpen || this.endingSeq !== -1 || this.powerSeq >= 0,
      subtitle: (t) => this.hud.setSubtitle(t, t ? '녹음기' : ''),
      now: () => this.time,
    }, this.audio, this.world, this.entities, this.physics, this.session.eventSeed,
    this.authority.localPlayerId || 'local', URL_FLAGS.ai === 'now', [this.player.collider]);

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
      if (e.byPlayerId !== 'receiver') this.entities?.hearNoise(p, NOISE.DOOR);
    } else if (e.type === 'item') {
      if (e.byPlayerId === this.authority.localPlayerId) {
        this.player.status.addBattery(SURVIVAL.BATTERY_PICKUP);
        this.batteriesFound++;
        this.audio.play('pickup', 0.8);
        this.hud.toast(`배터리를 넣었다  +${SURVIVAL.BATTERY_PICKUP}%`);
      } else {
        this.hud.toast(`${this.names.get(e.byPlayerId) ?? '다른 생존자'} 님이 배터리를 주웠습니다`);
      }
    } else if (e.type === 'relay') {
      const p = e.panel.position();
      this.lastRelayPos.copy(p);
      this.audio.playAt('relay', p, 2.2, 1, this.isOccluded(p));
      this.entities.hearNoise(p, NOISE.RELAY);   // throwing a breaker carries far
      this.scares.hush(20);
      const who = e.byPlayerId === this.authority.localPlayerId ? '' : `${this.names.get(e.byPlayerId) ?? '다른 생존자'} 님이 `;
      this.hud.toast(`${who}전력 패널을 작동시켰다  ${e.activeCount}/${OBJECTIVE.RELAY_COUNT}`);
    } else if (e.type === 'power') {
      // blackout → power returns → the elevator wakes up, and so does everything else
      this.powerSeq = 0;
      this.audio.play('surge', 0.9);
      this.scares.hush(40);
      if (this.authority.simulates) this.entities.finalHunt(this.lastRelayPos);
    } else if (e.type === 'elevator') {
      const p = this.world.elevator.doorPosition;
      this.audio.playAt('ding', p, 1.6);
      this.audio.playAt('elevDoor', p, 1.4);
      this.entities.hearNoise(p, NOISE.DOOR * 1.5);
    } else if (e.type === 'ending') {
      this.endingFreq = e.frequency;
      this.endingSeq = 0;
      this.audio.playAt('elevDoor', this.world.elevator.doorPosition, 1.4);
      if (this.recorder.on) this.recorder.toggle();
    } else if (e.type === 'custom') {
      if (e.targetId === `revive:${this.authority.localPlayerId}` && this.downed) this.revivedByTeammate(e.byPlayerId);
    }
  }

  private aiTargets(): AITarget[] {
    const p = this.player;
    const local: AITarget = {
      id: this.authority.localPlayerId,
      feet: p.feet.clone(),
      crouching: p.crouching,
      flashlight: this.flashlight.on && p.status.battery > 0,
      noise: p.status.noise,
      dead: this.dead || this.downed || this.endingSeq !== -1,
      speed: p.horizontalSpeed,
      eye: this.camera.position.clone(),
      viewDir: this.camera.getWorldDirection(new THREE.Vector3()),
    };
    return [local, ...this.remotes.targets()];
  }

  private fixedUpdate(dt: number): void {
    this.player.flashlightOn = this.flashlight.on;
    if (!this.dead && !this.downed && this.endingSeq === -1) this.player.fixedUpdate(dt);
    this.world.fixedUpdate(dt);
    this.entities.fixedUpdate(dt, this.aiTargets());
    this.physics.step();
  }

  private onHit(damage: number, from: THREE.Vector3): void {
    if (this.dead || this.downed || this.endingSeq !== -1) return;
    this.scares.hush(25);
    const killed = this.player.status.damage(damage);
    this.audio.play('hit', 0.9);
    const toAttacker = from.clone().sub(this.camera.position).setY(0);
    const fwd = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    const angle = Math.atan2(fwd.x * toAttacker.z - fwd.z * toAttacker.x, fwd.dot(toAttacker));
    this.hud.flashHit(-angle);
    this.hitKick = 1;
    if (this.entities.present) this.forceLook = 0.35;
    if (killed) {
      // co-op: go down and wait for a teammate; alone: the signal is simply lost
      if (this.session.mode !== 'single' && this.remotes.count > 0) this.goDown();
      else this.die();
    }
  }

  private goDown(): void {
    this.downed = true;
    this.bleedTimer = OBJECTIVE.BLEED_OUT;
    this.audio.play('staticBurst', 0.5);
    this.hud.hideNote();
    if (this.recorder.on) this.recorder.toggle();
    this.hud.showDowned(true, this.bleedTimer);
    this.entities.forget(this.authority.localPlayerId);
  }

  private revivedByTeammate(by: string): void {
    this.downed = false;
    this.player.status.revive();
    this.player.status.health = 50;
    this.hud.showDowned(false);
    this.camera.rotation.set(0, this.camera.rotation.y, 0, 'YXZ');
    this.hud.toast(`${this.names.get(by) ?? '동료'} 님이 일으켜 세웠다`);
  }

  private die(): void {
    this.downed = false;
    this.hud.showDowned(false);
    this.deaths++;
    if (this.recorder.on) this.recorder.toggle();
    this.dead = true;
    this.respawnTimer = PLAYER_HEALTH.RESPAWN_DELAY;
    this.audio.play('staticBurst', 0.8);
    this.hud.hideNote();
    this.hud.showDeath(true, this.respawnTimer);
    this.entities.forget(this.authority.localPlayerId);
  }

  private respawn(): void {
    this.dead = false;
    this.player.status.revive();
    this.player.teleport(this.world.spawnPoint(this.spawnIndex));
    this.camera.rotation.set(0, this.camera.rotation.y, 0, 'YXZ');
    this.hud.showDeath(false);
  }

  private frame(dt: number, alpha: number): void {
    this.time += dt;
    const inp = this.input;

    // ── Actions ─────────────────────────────────────────────
    this.reviveFocus = null;
    if (this.endingSeq !== -1) {
      this.hud.setHold(null);
    } else if (this.dead) {
      this.respawnTimer -= dt;
      this.hud.showDeath(true, this.respawnTimer);
      if (this.respawnTimer <= 0) this.respawn();
    } else if (this.downed) {
      this.bleedTimer -= dt;
      this.hud.showDowned(true, this.bleedTimer);
      if (this.bleedTimer <= 0) this.die();
    } else if (this.hud.noteOpen) {
      if (inp.wasPressed('KeyE') || inp.wasPressed('Escape')) { this.hud.hideNote(); this.audio.play('paper', 0.5); }
    } else {
      if (inp.wasPressed('KeyF')) {
        this.flashlight.toggle();
        this.audio.play('click', 0.5);
      }
      if (inp.wasPressed('KeyR') && this.recorder.has) this.recorder.toggle();
      this.handleInteraction(dt);
    }
    if (inp.wasPressed('F3')) this.debugOn = !this.debugOn;
    const tab = inp.isDown('Tab');
    this.hud.showInventory(tab, tab ? this.inventoryLines() : []);

    // ── Systems ─────────────────────────────────────────────
    this.player.updateCamera(dt, alpha);
    if (this.dead || this.downed) {
      // collapsed on the carpet
      const k = this.dead ? Math.min(1, (PLAYER_HEALTH.RESPAWN_DELAY - this.respawnTimer) * 2) : Math.min(1, (OBJECTIVE.BLEED_OUT - this.bleedTimer) * 2) * 0.8;
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.player.feet.y + 0.25, k);
      this.camera.rotation.z = THREE.MathUtils.lerp(0, 1.2, k);
    }
    if (this.hitKick > 0) {
      this.hitKick = Math.max(0, this.hitKick - dt * 3);
      const s = this.hitKick * this.hitKick * 0.06;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    const viewDir = this.camera.getWorldDirection(new THREE.Vector3());
    const beamHit = this.flashlight.on ? this.physics.castRay(this.camera.position, viewDir, 14, this.player.collider) : null;
    this.flashlight.update(dt, this.camera, this.player.status.battery, this.time, beamHit?.distance ?? Infinity);
    const viewer = this.camera.position;
    this.world.update(dt, this.time, viewer);
    this.interaction.update(this.camera);
    this.remotes.update(dt);
    this.authority.update(dt);
    this.camera.getWorldDirection(this.entities.viewDir);
    const threat = this.entities.update(dt, alpha, this.camera.position, (p) => this.isOccluded(p));
    this.renderer.glitch = this.settingsGlitch(this.entities.glitch + (this.dead ? 0.5 : 0));
    if (this.entities.revealHit) this.hitKick = 0.8;
    if (this.forceLook > 0) {
      // on a hit you are made to look at it
      this.forceLook -= dt;
      const q0 = this.camera.quaternion.clone();
      this.camera.lookAt(this.entities.headPosition());
      const q1 = this.camera.quaternion.clone();
      this.camera.quaternion.copy(q0).slerp(q1, Math.min(1, dt * 18));
    }

    this.updatePowerSequence(dt);
    this.updateEndingSequence(dt);
    if (!this.dead && !this.downed && this.endingSeq === -1) {
      const recNoise = this.recorder.update(dt, this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
      if (recNoise > 0) this.player.status.emitNoise(recNoise);
    } else if (this.recorder.on) this.recorder.toggle();
    this.scares.update(dt);

    const light = this.world.baked.sample(viewer.x, viewer.z) * this.world.lighting.power * this.world.lighting.surge;
    this.audio.update(dt, light, viewer);

    // fog + gentle eye adaptation follow the local light level
    const lit = THREE.MathUtils.clamp(light / 0.9, 0, 1);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(FOG_DARK.clone().lerp(FOG_LIT, lit), 1 - Math.exp(-dt * 1.5));
    fog.density = THREE.MathUtils.lerp(0.075, 0.042, lit);
    this.renderer.setExposure(this.exposure * THREE.MathUtils.lerp(1.35, 1, lit));
    this.renderer.distress = Math.min(1, Math.max(1 - lit, threat * 1.3) + (this.dead ? 1 : 0));

    // ── HUD ─────────────────────────────────────────────────
    const st = this.player.status;
    const focus = this.interaction.focus;
    const prompt = focus ? `${focus.prompt()}${focus.holdTime?.() ? ' (길게)' : ''}` : this.reviveFocus ? '동료 일으키기 (길게)' : null;
    this.hud.setPrompt(this.hud.noteOpen || this.dead || this.downed || this.endingSeq !== -1 ? null : prompt);
    this.hud.setRecorder(this.recorder.view, dt);
    this.hud.setObjective(this.objectiveText());
    this.hud.tick(dt);
    this.hud.setMeters(st.stamina, st.battery, this.flashlight.on, st.noise, dt);
    this.hud.setHealth(st.health);
    if (this.debugOn) {
      const c = worldToCell(this.world.level, viewer.x, viewer.z);
      const info = this.renderer.renderer.info.render;
      this.hud.setDebug(
        `${this.loop.fps.toFixed(0)} fps · draw ${info.calls} · tris ${(info.triangles / 1000).toFixed(1)}k\n` +
        `pos ${viewer.x.toFixed(1)}, ${viewer.y.toFixed(2)}, ${viewer.z.toFixed(1)} · cell ${c.cx},${c.cy}${this.world.level.dark[c.cy]?.[c.cx] ? ' (dark)' : ''}\n` +
        `light ${light.toFixed(2)} · noise ${st.noise.toFixed(1)}m · ${this.player.grounded ? 'ground' : 'air'}\n` +
        `seed ${this.session.mapSeed} · ${this.session.mode} · peers ${this.remotes.count} · hp ${st.health.toFixed(0)}\n` +
        this.entities.debugInfo(),
      );
    } else this.hud.setDebug(null);

    // ── Network ─────────────────────────────────────────────
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publishTimer = 1 / NET.PLAYER_STATE_HZ;
      this.authority.publishState(this.player.netState(this.flashlight.on, this.dead, this.downed));
    }
    if (this.session.mode === 'host') {
      this.entityPublishTimer -= dt;
      if (this.entityPublishTimer <= 0) {
        this.entityPublishTimer = 1 / RECEIVER.SNAPSHOT_HZ;
        const list = this.entities.snapshots();
        if (list.length) this.authority.publishEntities(list);
      }
    }

    this.renderer.render(this.scene, this.camera, this.time);
  }

  /** Instant and hold-to-use interactions (design doc 4.4), plus reviving teammates. */
  private handleInteraction(dt: number): void {
    const inp = this.input;
    const f = this.interaction.focus;
    if (!f && this.session.mode !== 'single') {
      this.reviveFocus = this.remotes.downedNear(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()), OBJECTIVE.REVIVE_DISTANCE);
    }
    const focusId = f?.id ?? (this.reviveFocus ? `revive:${this.reviveFocus}` : null);
    const hold = f?.holdTime?.() ?? (this.reviveFocus ? OBJECTIVE.REVIVE_HOLD : 0);

    if (focusId && hold > 0) {
      inp.wasPressed('KeyE');
      if (inp.isDown('KeyE')) {
        if (this.holdTarget !== focusId) { this.holdTarget = focusId; this.holdProgress = 0; }
        this.holdProgress += dt;
        if (this.holdProgress >= hold) {
          this.authority.requestInteraction(focusId, this.camera.position.clone());
          this.holdTarget = null;
          this.holdProgress = 0;
        }
      } else {
        this.holdTarget = null;
        this.holdProgress = 0;
      }
      this.hud.setHold(this.holdTarget ? this.holdProgress / hold : null);
      return;
    }
    this.holdTarget = null;
    this.hud.setHold(null);
    if (!inp.wasPressed('KeyE') || !f) return;
    if (f.kind === 'note') {
      const idx = this.world.level.notes.find((n) => n.id === f.id)?.noteIndex ?? 0;
      this.notesRead.add(idx);
      this.hud.showNote(NOTES[idx]);
      this.audio.play('paper', 0.7);
    } else if (f.kind === 'tool') {
      // the recorder is personal: everyone finds their own
      this.world.recorder.setCollected(true);
      this.recorder.pickUp();
      this.audio.play('pickup', 0.8);
      this.hud.toast('녹음기를 주웠다 — R 로 켜기');
    } else if (f.id === 'elevator-call' && !this.world.elevator.powered) {
      this.audio.play('click', 0.4, 0.6);
      this.hud.toast('아무 반응이 없다. 전원이 들어오지 않는다.');
    } else if (f.id.startsWith('freq-') && this.session.mode !== 'single' &&
      this.remotes.targets().some((t) => !t.dead && !this.world.elevator.contains(t.feet.clone().setY(1)))) {
      this.hud.toast('모든 생존자가 엘리베이터 안에 있어야 한다');
    } else {
      this.authority.requestInteraction(f.id, this.camera.position.clone());
    }
  }

  private objectiveText(): string {
    const el = this.world.elevator;
    const n = this.world.activeRelays;
    if (el.ending) return '…';
    if (el.open) return this.session.mode === 'single' ? '엘리베이터에 타서 주파수를 선택하라' : '모든 생존자가 탑승한 뒤 주파수를 선택하라';
    if (el.powered) return '엘리베이터를 찾아 호출하라';
    if (!this.recorder.has) return n ? `전력 패널을 찾아 작동시켜라 (${n}/${OBJECTIVE.RELAY_COUNT})` : '주변을 조사하라';
    return `녹음기(R)로 신호를 따라가 전력 패널을 작동시켜라 (${n}/${OBJECTIVE.RELAY_COUNT})`;
  }

  /** Blackout → power returns. */
  private updatePowerSequence(dt: number): void {
    if (this.powerSeq < 0) return;
    this.powerSeq += dt;
    const t = this.powerSeq;
    let s: number;
    if (t < 0.5) s = Math.random() > 0.5 ? 1 : 0.1;
    else if (t < 3.2) s = 0;
    else if (t < 4.4) s = Math.random() > 0.35 ? (t - 3.2) / 1.2 : 0.05;
    else { s = 1; this.powerSeq = -1; this.audio.playAt('ding', this.world.elevator.doorPosition, 1.8); this.hud.toast('어딘가에서 엘리베이터가 깨어났다'); }
    this.world.lighting.surge = s;
  }

  private updateEndingSequence(dt: number): void {
    if (this.endingSeq < 0 || this.ended) return;
    this.endingSeq += dt;
    if (this.endingSeq < 3) return;
    this.endingSeq = -2; // done: freeze
    const escaped = this.endingFreq === this.world.level.correctFrequency;
    const secs = Math.floor(this.time);
    const stats = [
      `시간 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      `사망 ${this.deaths}`,
      `녹음 ${this.recorder.heard.size}/${this.recorder.logs.length}`,
      `문서 ${this.notesRead.size}/${NOTES.length}`,
      `주파수 ${OBJECTIVE.FREQUENCIES[this.endingFreq]} MHz`,
      `Seed ${this.session.mapSeed}`,
    ];
    this.input.enabled = false;
    if (this.controls.isLocked) this.controls.unlock();
    this.hud.showPause(false);
    this.hud.showEnding(escaped ? {
      kicker: 'ENDING A',
      title: 'ESCAPE',
      body: '문이 닫히고, 형광등 소리가 멈췄다.\n\n긴 하강. 그리고 정적.\n\n문이 열리자 차가운 공기가 들어왔다. 아스팔트 냄새, 멀리서 들리는 차 소리. 가로등 아래, 평범한 밤이다.\n\n주머니 속에서 녹음기가 혼자 켜진다.\n지직거리는 잡음 사이로, 네 목소리가 말한다.\n\n“…녹음 중인가?”',
      stats,
    } : {
      kicker: 'ENDING B',
      title: 'WRONG FREQUENCY',
      body: '문이 닫히고, 형광등 소리가 멈췄다.\n\n하강은 끝나지 않았다. 몇 분인지, 몇 시간인지.\n\n문이 열린다. 콘크리트 바닥과 콘크리트 벽. 천장의 배관에서 물이 떨어지고, 짙은 습기가 통로를 채우고 있다. 형광등이 깜빡인다. 창고 같은 통로가 끝없이 이어진다.\n\nLevel 1.\n\n녹음기가 켜진다.\n“이걸 듣고 있다면, 넌 다른 쪽을 눌렀어.”',
      stats,
    }, () => this.exit());
  }

  private inventoryLines(): string[] {
    const st = this.player.status;
    return [
      `손전등 — 배터리 ${Math.ceil(st.battery)}%${this.flashlight.on ? ' (켜짐)' : ''}`,
      `찾은 배터리 — ${this.batteriesFound}개`,
      this.recorder.has ? `신호 녹음기 — 녹음 ${this.recorder.heard.size}/${this.recorder.logs.length}` : '',
      `문서 — ${this.notesRead.size} / ${NOTES.length}`,
      this.recorder.has ? '' : `<span class="dim">신호 녹음기 — 아직 찾지 못했다</span>`,
      `<span class="dim">목표 — ${this.objectiveText()}</span>`,
    ].filter(Boolean);
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
    this.entities?.dispose();
    this.recorder?.dispose();
    this.world?.dispose();
    this.physics?.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    delete (window as unknown as { __LS?: Game }).__LS;
  }
}
