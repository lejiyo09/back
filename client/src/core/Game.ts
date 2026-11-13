import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { LEVEL1, NET, NOISE, OBJECTIVE, PLAYER, PLAYER_HEALTH, RECEIVER, SURVIVAL, WORLD } from '@shared/Constants';
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
import { SaveGame, type CarryState } from './SaveGame';
import { Stairwell } from '../interaction/Stairwell';
import { ScareDirector } from '../horror/ScareDirector';
import { EndingScene } from '../world/EndingScenes';
import { radioVoice } from '../audio/SoundSynth';
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
  onExit: (reason?: string, transition?: boolean) => void;
  /** which level to build (0 = Level 0, 1 = Level 1) */
  level?: 0 | 1;
  /** state carried over from the previous level */
  carry?: CarryState;
  /** Ending B → "continue into Level 1" (single-player or host) */
  onContinue?: () => void;
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
  private fovPunch = 0;
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
  // ending sequence
  private endingScene: EndingScene | null = null;
  private arrived = false;
  private arrivalT = 0;
  private finaleT = -1;
  private epilogueWalk = false;
  private endingFlags = new Set<string>();
  private endingLoops: THREE.Audio[] = [];
  private dripTimer = 2;
  private deaths = 0;
  private levelIndex: 0 | 1 = 0;
  private fogLit = FOG_LIT.clone();
  private timeOffset = 0;
  private blackoutTimer = 0;
  private powerTarget = 1;
  private blackoutFlicker = 0;
  private chapterDone = false;
  private ambient: THREE.Audio | null = null;

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
  private authorityCallbacks!: AuthorityCallbacks;
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
      onPeerLeft: (id) => { this.hud.toast(`${this.names.get(id) ?? '생존자'} 님이 세션을 떠났습니다`); this.remotes?.remove(id); this.remotes?.forgetName(id); },
      onSessionEnded: (reason) => this.exit(reason),
      onEntityStates: (list) => this.entities?.applySnapshots(list),
      getLocal: () => ({ pos: this.player.feet.clone(), downed: this.downed, dead: this.dead }),
      onHostChanged: (hostId) => this.onHostChanged(hostId),
      onPeerOffline: (id) => {
        this.remotes?.setOnline(id, false);
        const isHost = this.opts.net?.session?.hostId === id;
        this.hud.toast(`${this.names.get(id) ?? '생존자'} 님의 연결이 끊겼습니다`);
        if (isHost) this.hud.setBanner('호스트 연결이 끊겼습니다 — 재접속을 기다리는 중… (20초 후 다른 생존자가 이어받습니다)');
      },
      onPeerOnline: (id) => {
        this.remotes?.setOnline(id, true);
        this.hud.toast(`${this.names.get(id) ?? '생존자'} 님이 다시 연결되었습니다`);
        if (this.opts.net?.session?.hostId === id) this.hud.setBanner(null);
      },
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
    this.levelIndex = o.level ?? 0;
    this.world = new World(this.session.mapSeed, this.physics, preset, this.renderer.maxAnisotropy, this.levelIndex);
    if (this.levelIndex === 1) this.fogLit = new THREE.Color(0x585b55); // Level 1: grey, low fog
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.FogExp2(this.fogLit.getHex(), 0.042);
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
      // Level 1: you already know what it is — no reveal, it simply arrives after a while
      revealMode: this.levelIndex === 1 || URL_FLAGS.ai === 'hunt' ? 'skip' : URL_FLAGS.ai === 'now' ? 'fast' : 'normal',
      spawnDelay: this.levelIndex === 1 ? (URL_FLAGS.ai === 'now' || URL_FLAGS.ai === 'hunt' ? 4 : 30) : undefined,
      ignoreColliders: [this.player.collider],
      names: () => ({
        local: this.names.get(this.authority?.localPlayerId ?? '') ?? (this.opts.settings.playerName || ''),
        others: [...this.names.entries()].filter(([id]) => id !== this.authority?.localPlayerId).map(([, n]) => n),
      }),
      subtitle: (t, who) => this.hud.setSubtitle(t, who),
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
    const carry = o.carry;
    if (carry) {
      if (carry.recorder) this.recorder.pickUp();
      carry.heard.forEach((h) => this.recorder.heard.add(h));
      this.deaths = carry.deaths;
      this.timeOffset = carry.time;
    }
    if (this.levelIndex === 1) {
      this.recorder.pickUp();          // it came down with you
      this.recorder.heard.add(0);      // and it no longer introduces itself
      this.blackoutTimer = 40 + Math.random() * 20;
    }
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

    if (carry) this.player.status.battery = carry.battery;
    this.player.onFootstep = (e) => {
      if (this.levelIndex === 1 && this.world.isWater(this.player.feet.x, this.player.feet.z)) {
        // wading: loud, and it carries
        this.audio.play(Math.random() < 0.5 ? 'splash0' : 'splash1', e.gait === 'crouch' ? 0.35 : 0.7, 0.9 + Math.random() * 0.2);
        this.player.status.emitNoise(e.gait === 'crouch' ? NOISE.WATER * 0.5 : NOISE.WATER);
      } else this.audio.footstep(e.gait);
    };
    this.player.onLand = (k) => this.audio.footstep(k > 0.6 ? 'run' : 'walk');
    this.world.onEvent = (e) => this.onWorldEvent(e);

    await this.authority.startSession(this.world);
    this.authorityCallbacks = cb;

    // Connection drops: keep playing locally while the WebSocket reconnects and resumes the slot.
    if (o.net) {
      o.net.events = {
        lost: () => this.hud.setBanner('서버 연결이 끊겼습니다 — 재연결 중…'),
        resumed: (info) => {
          this.hud.setBanner(null);
          this.hud.toast('다시 연결되었습니다');
          const shouldHost = info.hostId === info.playerId;
          if (shouldHost !== (this.session.mode === 'host')) this.switchAuthority(shouldHost ? 'host' : 'client');
          else if (this.authority instanceof HostAuthority) this.authority.resync();
          for (const p of info.players) this.remotes.setOnline(p.id, p.online);
        },
        failed: (reason) => this.exit(`재연결 실패: ${reason}`),
      };
    }

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

  /** Embedded frames (and some browsers) refuse pointer lock: fall back to drag-to-look. */
  private dragLook = false;
  private enableDragLook(): void {
    const resume = () => {
      this.everLocked = true;
      this.input.enabled = true;
      this.input.flushPresses();
      this.hud.showPause(false);
      void this.audio.resume();
    };
    if (this.dragLook) { resume(); return; }
    this.dragLook = true;
    const canvas = this.opts.canvas;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousemove', (e) => {
      if (!(e.buttons & 1) || !this.input.enabled) return;
      euler.setFromQuaternion(this.camera.quaternion);
      const k = 0.0035 * this.opts.settings.mouseSensitivity;
      euler.y -= e.movementX * k;
      euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * k, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      this.camera.quaternion.setFromEuler(euler);
    });
    canvas.addEventListener('mousedown', () => { canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', () => { canvas.style.cursor = 'grab'; });
    resume();
    this.hud.toast('마우스 고정을 쓸 수 없는 환경입니다 — 마우스를 누른 채 끌어서 둘러보세요', 6000);
  }

  private setupPointerLock(): void {
    const tryLock = () => {
      if (this.ended) return;
      if (this.dragLook) { this.enableDragLook(); return; }
      try { Promise.resolve(this.controls.lock()).catch(() => this.enableDragLook()); } catch { this.enableDragLook(); }
      setTimeout(() => { if (!this.controls.isLocked && !this.ended && !this.dragLook) this.enableDragLook(); }, 600);
    };
    document.addEventListener('pointerlockerror', () => { if (!this.ended) this.enableDragLook(); });
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
    this.hud.subtitlesEnabled = s.subtitles;
    this.entities.scareIntensity = s.scareIntensity;
  }

  private onResize = () => this.renderer.resize(this.camera);

  /** Host migration / old host returning: swap who simulates, keep everything else. */
  private switchAuthority(mode: 'host' | 'client'): void {
    if (!this.opts.net || this.session.mode === mode) return;
    this.authority.shutdown();
    this.session.mode = mode;
    this.authority = mode === 'host'
      ? new HostAuthority(this.opts.net, this.authorityCallbacks)
      : new RemoteAuthority(this.opts.net, this.authorityCallbacks);
    void this.authority.startSession(this.world);
    this.entities.setAuthority(mode === 'host');
  }

  private onHostChanged(hostId: string): void {
    this.hud.setBanner(null);
    for (const [id] of this.names) {
      const p = this.session.players.get(id);
      if (p) p.isHost = id === hostId;
    }
    if (hostId === this.authority.localPlayerId) {
      this.switchAuthority('host');
      this.hud.toast('호스트가 돌아오지 않아 당신이 세션을 이어받았습니다');
    } else {
      this.switchAuthority('client');
      this.hud.toast(`${this.names.get(hostId) ?? '다른 생존자'} 님이 새 호스트가 되었습니다`);
    }
  }

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
    } else if (e.type === 'item' && this.world.supplyContent.has(e.item.id)) {
      // Level 1 supply crate: opened by someone; whoever opened it gets what is inside
      this.audio.playAt('doorOpen', e.item.position(), 0.5, 1.6);
      if (e.byPlayerId === this.authority.localPlayerId) {
        const c = this.world.supplyContent.get(e.item.id);
        if (c === 'almond') {
          this.player.status.health = Math.min(SURVIVAL.MAX_HEALTH, this.player.status.health + LEVEL1.ALMOND_HEAL);
          this.player.status.stamina = SURVIVAL.MAX_STAMINA;
          this.audio.play('pickup', 0.7, 0.8);
          this.hud.toast(`아몬드 워터를 마셨다 — 체력 +${LEVEL1.ALMOND_HEAL}, 기력 회복`);
        } else if (c === 'battery') {
          this.player.status.addBattery(SURVIVAL.BATTERY_PICKUP);
          this.batteriesFound++;
          this.audio.play('pickup', 0.8);
          this.hud.toast(`상자 안에 배터리가 있었다  +${SURVIVAL.BATTERY_PICKUP}%`);
        } else {
          this.hud.toast(this.world.supplyContent.size % 2 ? '젖은 종이 뭉치뿐이다.' : '비어 있다. 머리카락 한 움큼.');
        }
      }
    } else if (e.type === 'blackout') {
      // Level 1: the lights fail across the whole floor
      this.powerTarget = e.on ? 0.03 : 1;
      this.blackoutFlicker = 1.2;
      this.audio.play('click', 0.6, e.on ? 0.5 : 0.8);
      this.entities.setBlackout(e.on);
      if (e.on) this.scares.hush(30);
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
      // build the destination now; any shader-compile hitch hides behind the closing doors
      const escaped = e.frequency === this.world.level.correctFrequency;
      const origin = this.world.elevator.center.clone().add(new THREE.Vector3(0, 0, 400));
      this.endingScene = new EndingScene(escaped ? 'escape' : 'level1', origin, this.physics, this.session.mapSeed);
      this.scene.add(this.endingScene.group);
      this.renderer.renderer.compile(this.scene, this.camera);
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
    this.player.speedMul = this.levelIndex === 1 && this.world.isWater(this.player.feet.x, this.player.feet.z) ? LEVEL1.WATER_SPEED : 1;
    if (!this.dead && !this.downed && (this.endingSeq === -1 || this.epilogueWalk)) this.player.fixedUpdate(dt);
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
    const k = this.opts.settings.scareIntensity;
    if (this.entities.present) this.forceLook = 0.3 + 0.35 * k;
    this.fovPunch = k;
    this.entities.glitch = Math.max(this.entities.glitch, k);
    this.audio.play('rScreech', 0.5 + 0.5 * k, 0.75);
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
    if (this.dragLook && inp.wasPressed('Escape') && !this.hud.noteOpen && this.endingSeq === -1) {
      this.input.enabled = false;
      this.input.clear();
      this.hud.showPause(true, this.pauseInfo());
    }
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
    if (this.fovPunch > 0.001) {
      this.fovPunch *= Math.exp(-dt * 2.2);
      this.camera.fov = PLAYER.FOV - 20 * this.fovPunch;
      this.camera.updateProjectionMatrix();
    }
    if (this.hitKick > 0) {
      this.hitKick = Math.max(0, this.hitKick - dt * 3);
      const s = this.hitKick * this.hitKick * 0.06;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    const viewDir = this.camera.getWorldDirection(new THREE.Vector3());
    const beamHit = this.flashlight.on ? this.physics.castRay(this.camera.position, viewDir, 14, this.player.collider) : null;
    const jam = this.entities.interference(this.camera.position);
    this.flashlight.update(dt, this.camera, this.player.status.battery, this.time, beamHit?.distance ?? Infinity, jam);
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
    this.updateLevel1(dt);
    this.updateEndingSequence(dt);
    if (!this.dead && !this.downed && this.endingSeq === -1) {
      const recNoise = this.recorder.update(dt, this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()), jam);
      if (recNoise > 0) this.player.status.emitNoise(recNoise);
    } else if (this.recorder.on) this.recorder.toggle();
    this.scares.update(dt);

    const light = this.world.baked.sample(viewer.x, viewer.z) * this.world.lighting.power * this.world.lighting.surge;
    this.audio.update(dt, light, viewer);

    // fog + gentle eye adaptation follow the local light level
    const lit = THREE.MathUtils.clamp(light / 0.9, 0, 1);
    const fog = this.scene.fog as THREE.FogExp2;
    if (this.arrived && this.endingScene) {
      fog.color.lerp(new THREE.Color(this.endingScene.fog.color), 1 - Math.exp(-dt * 3));
      fog.density = this.endingScene.fog.density;
      (this.scene.background as THREE.Color).copy(fog.color);
      this.renderer.setExposure(this.exposure * this.endingScene.exposure);
      this.renderer.distress = 0.15;
    } else {
      fog.color.lerp(FOG_DARK.clone().lerp(this.fogLit, lit), 1 - Math.exp(-dt * 1.5));
      fog.density = THREE.MathUtils.lerp(0.075, 0.042, lit);
      this.renderer.setExposure(this.exposure * THREE.MathUtils.lerp(1.35, 1, lit));
      this.renderer.distress = Math.min(1, Math.max(1 - lit, threat * 1.3) + (this.dead ? 1 : 0));
    }

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
      this.world.recorder?.setCollected(true);
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
    if (this.levelIndex === 1) {
      if (this.chapterDone) return '';
      if (el.powered) return 'B3 계단으로 내려가라';
      return `차단기 두 개를 찾아 계단 문 전원을 살려라 (${n}/${LEVEL1.RELAY_COUNT})`;
    }
    if (el.ending) return '';
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
    else {
      s = 1;
      this.powerSeq = -1;
      if (this.levelIndex === 1) {
        this.audio.playAt('elevDoor', this.world.elevator.doorPosition, 1.8);
        this.hud.toast('어딘가에서 무거운 문이 열렸다');
      } else {
        this.audio.playAt('ding', this.world.elevator.doorPosition, 1.8);
        this.hud.toast('어딘가에서 엘리베이터가 깨어났다');
      }
    }
    this.world.lighting.surge = s;
  }

  private once(flag: string): boolean {
    if (this.endingFlags.has(flag)) return false;
    this.endingFlags.add(flag);
    return true;
  }

  private sayOnRecorder(text: string, seconds: number, pitch = 1): void {
    const buf = radioVoice(this.audio.listener.context, seconds, 777 + text.length, pitch);
    this.audio.playBuffer(buf, 0.9);
    this.hud.setSubtitle(text, '녹음기');
    setTimeout(() => this.hud.setSubtitle(null), seconds * 1000 + 600);
  }

  /**
   * The ride down and the ending (design doc ACT 5): doors close → descent →
   * darkness, banging, breathing → in one flicker it is in the cab with you →
   * arrival → walk out into the destination → finale → fade → ending text.
   */
  private updateEndingSequence(dt: number): void {
    if (this.endingSeq < 0 || this.ended || !this.endingScene) return;
    this.endingSeq += dt;
    const t = this.endingSeq;
    const el = this.world.elevator;
    const S = this.endingScene;
    const k = this.opts.settings.scareIntensity;

    if (!this.arrived) {
      if (t > 2.2 && this.once('rumble')) this.endingLoops.push(this.audio.loop('rumble', 0.45));
      if (t > 2.2) this.hitKick = Math.max(this.hitKick, 0.12);
      // lights: dark 4.4–5.2, one flicker 5.2–5.45, dark to 6.3, then stuttering back
      el.blackout = (t > 4.4 && t < 5.2) || (t > 5.45 && t < 6.3) || (t > 6.3 && t < 6.9 && Math.random() < 0.5);
      if (t > 4.4 && this.once('bang')) {
        this.audio.play('bang', 0.6 + 0.4 * k);
        this.audio.play('rBreath', 0.5 * k + 0.2);
      }
      if (t > 5.2 && this.once('phantom')) {
        // it is standing right behind you, inside the cab
        const dir = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const p = this.camera.position.clone().addScaledVector(dir, -0.95).setY(0);
        p.x = THREE.MathUtils.clamp(p.x, el.center.x - 0.6, el.center.x + 0.6);
        p.z = THREE.MathUtils.clamp(p.z, el.center.z - 0.6, el.center.z + 0.65);
        this.entities.spawnPhantom(p, Math.atan2(dir.x, dir.z), 0.3, 1);
        this.entities.glitch = Math.max(this.entities.glitch, 0.8 * k);
      }
      if (t > 7.4) {
        // arrival: swap into the copy of the cab at the destination
        this.endingLoops.forEach((l) => { if (l.isPlaying) l.stop(); });
        this.endingLoops = [];
        el.blackout = false;
        const delta = S.cabCenter.clone().sub(el.center).setY(0);
        this.player.teleport(this.player.feet.clone().add(delta));
        this.camera.position.add(delta);
        this.audio.play('ding', 0.9);
        this.arrived = true;
        this.arrivalT = t;
        if (S.kind === 'escape') {
          this.endingLoops.push(this.audio.loop('rain', 0.55), this.audio.loop('city', 0.3));
        } else {
          this.endingLoops.push(this.audio.loop('hum', 0.06), this.audio.loop('drone', 0.12));
        }
      }
      return;
    }

    const at = t - this.arrivalT;
    S.openDoors(THREE.MathUtils.clamp((at - 0.6) / 2, 0, 1));
    if (at > 0.6 && this.once('destDoors')) this.audio.play('elevDoor', 0.8);
    this.epilogueWalk = at > 1.4;
    S.update(dt, this.time, this.camera.position);
    if (S.kind === 'level1') {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 1.5 + Math.random() * 3;
        const p = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 2, -Math.random() * 10));
        this.audio.playAt('drip', p, 1.2, 0.9 + Math.random() * 0.3);
      }
    }
    const walked = Math.hypot(this.player.feet.x - S.cabCenter.x, this.player.feet.z - S.cabCenter.z);
    if (this.finaleT < 0 && (at > 24 || walked > 10)) {
      this.finaleT = t;
      if (S.kind === 'escape') {
        this.sayOnRecorder('…녹음 중인가?', 2.2);
      } else {
        S.startCascade();
        const dir = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const p = this.camera.position.clone().addScaledVector(dir, 10).setY(0);
        this.entities.spawnPhantom(p, Math.atan2(-dir.x, -dir.z), 3.4);
        setTimeout(() => this.sayOnRecorder('이걸 듣고 있다면, 넌 다른 쪽을 눌렀어.', 3.4, 0.96), 1400);
      }
    }
    if (this.finaleT >= 0) {
      const ft = t - this.finaleT;
      if (ft > 4.2 && this.once('fade')) this.hud.fade(1, 2.5);
      if (ft > 7) this.showEndingScreen();
    }
  }

  private showEndingScreen(): void {
    this.endingSeq = -2; // done: freeze
    this.epilogueWalk = false;
    this.endingLoops.forEach((l) => { if (l.isPlaying) l.stop(); });
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
      body: '빗소리. 젖은 아스팔트. 가로등이 웅웅거린다 — 형광등과는 다른 소리로.\n\n여기는 현실이다. 그래야만 한다.\n\n주머니 속 녹음기는 꺼지지 않는다. 지직거리는 잡음 사이로, 네 목소리가 다시 처음부터 말하기 시작한다.\n\n“…녹음 중인가?”\n\n누군가 지금 막 녹음기를 주웠다.',
      stats,
    } : {
      kicker: 'ENDING B',
      title: 'WRONG FREQUENCY',
      body: '콘크리트 바닥과 콘크리트 벽. 천장의 배관에서 물이 떨어지고, 짙은 습기가 통로를 채운다. 창고 같은 통로가 끝없이 이어진다.\n\nLevel 1.\n\n불빛이 하나씩 꺼져 왔고, 안개 속에 무언가 서 있었다.\n\n녹음기가 켜진다.\n“이걸 듣고 있다면, 넌 다른 쪽을 눌렀어.”\n\n이제, 네가 녹음할 차례다.',
      stats,
      ...(this.levelIndex === 0 && !escaped ? this.continueOption() : {}),
    }, () => this.exit());
    this.hud.fade(0, 1.5);
  }

  /** Ending B leads on into Level 1 — chosen by the single player or the host. */
  private continueOption(): { continueLabel?: string; onContinue?: () => void; waiting?: string } {
    if (!this.opts.onContinue) return {};
    if (this.session.mode === 'client') return { waiting: '호스트가 Level 1로 계속할지 정하는 중…' };
    return { continueLabel: '계속 — Level 1', onContinue: () => this.opts.onContinue?.() };
  }

  /** What the next level inherits from this one. */
  carryState(): CarryState {
    return {
      recorder: this.recorder.has,
      heard: [...this.recorder.heard],
      deaths: this.deaths,
      time: this.timeOffset + this.time,
      battery: Math.max(30, this.player.status.battery),
    };
  }

  /** Level 1: blackout schedule (simulating side only) and the lights following it (everyone). */
  private updateLevel1(dt: number): void {
    if (this.levelIndex !== 1) return;
    if (!this.ambient) this.ambient = this.audio.loop('machinery', 0.1);
    if (this.authority.simulates && !this.chapterDone) {
      this.blackoutTimer -= dt;
      if (this.blackoutTimer <= 0) {
        const on = !this.world.blackout;
        this.authority.worldEvent('blackout', on ? 1 : 0);
        const [a, b] = on ? LEVEL1.BLACKOUT_LENGTH : LEVEL1.BLACKOUT_EVERY;
        this.blackoutTimer = a + Math.random() * (b - a);
      }
    }
    // lights stutter on the way out and back in, then settle
    let p = this.powerTarget;
    if (this.blackoutFlicker > 0) {
      this.blackoutFlicker -= dt;
      p = Math.random() < 0.5 ? 1 : 0.03;
    }
    this.world.lighting.power = p;
    this.dripTimer -= dt;
    if (this.dripTimer <= 0) {
      this.dripTimer = 2 + Math.random() * 4;
      const q = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 3, (Math.random() - 0.5) * 16));
      this.audio.playAt('drip', q, 1.0, 0.85 + Math.random() * 0.3, this.isOccluded(q));
    }
    // reaching the bottom of the B3 stairs ends the chapter
    const ex = this.world.elevator;
    if (!this.chapterDone && ex instanceof Stairwell && ex.descended(this.player.feet)) this.completeChapter();
  }

  private completeChapter(): void {
    this.chapterDone = true;
    this.endingSeq = -2;
    this.hud.fade(1, 2.2);
    if (this.recorder.on) this.recorder.toggle();
    const carry = this.carryState();
    if (this.session.mode === 'single') SaveGame.save({ chapter: 1, seed: this.session.mapSeed, carry, completed: true });
    setTimeout(() => {
      if (this.ended) return;
      const secs = Math.floor(carry.time);
      this.input.enabled = false;
      if (this.controls.isLocked) this.controls.unlock();
      this.hud.showPause(false);
      this.hud.showEnding({
        kicker: 'CHAPTER 2 COMPLETE · LEVEL 1',
        title: 'B3',
        body: '계단은 생각보다 길었다. 한 층, 또 한 층.\n\n공기가 뜨거워지고, 벽을 타고 배관이 늘어나기 시작한다. 쇠가 식으며 내는 소리, 어디선가 증기가 새는 소리.\n\n녹음기의 잡음이 거의 들리지 않을 만큼 약해졌다.\n그런데 계단 위에서, 무언가 내려오는 발소리가 들린다.\n\nLevel 2 — 다음 장에서 계속.',
        stats: [
          `총 시간 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
          `사망 ${this.deaths}`,
          `녹음 ${this.recorder.heard.size}/${this.recorder.logs.length}`,
          `Seed ${this.session.mapSeed}`,
        ],
      }, () => this.exit());
      this.hud.fade(0, 1.5);
    }, 2600);
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
      ...(this.session.mode === 'single' ? [] : this.remotes.roster().filter((r) => r.id !== this.authority.localPlayerId).map((r) =>
        `동료 · ${escapeHtml(r.name)} — ${r.status}${this.opts.net?.session?.hostId === r.id ? ' (호스트)' : ''}`)),
    ].filter(Boolean);
  }

  /** Teleport helper for testing (window.__LS.debugTeleport(cx, cy)). */
  debugTeleport(cx: number, cy: number): void {
    const s = WORLD.CELL_SIZE;
    const L = this.world.level;
    this.player.teleport(new THREE.Vector3((cx + 0.5) * s - (L.w * s) / 2, 0.05, (cy + 0.5) * s - (L.h * s) / 2));
  }

  exit(reason?: string, transition = false): void {
    if (this.ended) return;
    this.ended = true;
    this.loop.stop();
    if (this.controls.isLocked) this.controls.unlock();
    this.authority?.shutdown();
    this.dispose();
    this.opts.onExit(reason, transition);
  }

  private dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.input.dispose();
    this.audio?.dispose();
    this.remotes?.dispose();
    this.entities?.dispose();
    this.recorder?.dispose();
    this.endingScene?.dispose();
    this.world?.dispose();
    this.physics?.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    delete (window as unknown as { __LS?: Game }).__LS;
  }
}
