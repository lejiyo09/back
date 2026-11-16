import * as THREE from 'three';
import * as Synth from './SoundSynth';

export type FloorKind = 'carpet' | 'concrete' | 'wood' | 'tile';

/** a room's acoustic: reverb tail (s), wet level, damping 0..1 (soft furnishings → dark tail) */
export interface RoomAcoustic { decay: number; wet: number; damp: number }

export type SoundKey =
  | 'hum' | 'roomTone' | 'doorOpen' | 'doorClose' | 'click' | 'paper' | 'pickup'
  | 'step0' | 'step1' | 'step2' | 'step3' | 'distant0' | 'distant1' | 'distant2'
  | 'rBreath' | 'rStatic' | 'rStep0' | 'rStep1' | 'rStep2' | 'rScreech' | 'hit' | 'staticBurst' | 'heartbeat'
  | 'beep' | 'relay' | 'surge' | 'ding' | 'elevDoor' | 'knock' | 'whisper0' | 'whisper1'
  | 'drone' | 'rumble' | 'bang' | 'rain' | 'city' | 'drip' | 'splash0' | 'splash1' | 'machinery'
  | 'steam' | 'grate0' | 'grate1' | 'vent' | 'growl' | 'snap' | 'flutter' | 'giggle';

/**
 * Web Audio + three.js positional audio (design doc 10). One listener on the
 * camera; pooled one-shots; looping hums attached to the real-time light pool.
 */
export class AudioManager {
  readonly listener: THREE.AudioListener;
  readonly buffers = new Map<SoundKey, AudioBuffer>();
  private oneShots: THREE.Audio[] = [];
  private oneShotIdx = 0;
  private spatialShots: THREE.PositionalAudio[] = [];
  private spatialIdx = 0;
  private loops: (THREE.Audio | THREE.PositionalAudio)[] = [];
  private globalHum?: THREE.Audio;
  private distantTimer = 25;
  private stepIdx = 0;
  /** recorded variants (assets/audio/sfx.json), preferred over the synthesized buffer when loaded */
  private variants = new Map<string, AudioBuffer[]>();
  private lastVariant = new Map<string, number>();
  private floor: FloorKind = 'carpet';
  private convolver: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  /** resolves when the recorded set has been decoded (or failed — synth stays) */
  readonly samplesReady: Promise<void>;

  constructor(private scene: THREE.Scene, camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    const ctx = this.listener.context;
    this.buffers.set('hum', Synth.fluorescentHum(ctx));
    this.buffers.set('roomTone', Synth.roomTone(ctx));
    this.buffers.set('doorOpen', Synth.doorOpen(ctx));
    this.buffers.set('doorClose', Synth.doorClose(ctx));
    this.buffers.set('click', Synth.click(ctx));
    this.buffers.set('paper', Synth.paperRustle(ctx));
    this.buffers.set('pickup', Synth.pickup(ctx));
    for (let i = 0; i < 4; i++) this.buffers.set(`step${i}` as SoundKey, Synth.carpetStep(ctx, i));
    for (let i = 0; i < 3; i++) this.buffers.set(`distant${i}` as SoundKey, Synth.distantThud(ctx, i));
    this.buffers.set('rBreath', Synth.receiverBreath(ctx));
    this.buffers.set('rStatic', Synth.signalStatic(ctx));
    for (let i = 0; i < 3; i++) this.buffers.set(`rStep${i}` as SoundKey, Synth.receiverStep(ctx, i));
    this.buffers.set('rScreech', Synth.receiverScreech(ctx));
    this.buffers.set('hit', Synth.hitImpact(ctx));
    this.buffers.set('staticBurst', Synth.staticBurst(ctx));
    this.buffers.set('heartbeat', Synth.heartbeat(ctx));
    this.buffers.set('beep', Synth.beep(ctx));
    this.buffers.set('relay', Synth.relayClunk(ctx));
    this.buffers.set('surge', Synth.powerSurge(ctx));
    this.buffers.set('ding', Synth.elevatorDing(ctx));
    this.buffers.set('elevDoor', Synth.elevatorDoor(ctx));
    this.buffers.set('knock', Synth.knock(ctx));
    this.buffers.set('whisper0', Synth.radioVoice(ctx, 1.6, 91, 0.95, true));
    this.buffers.set('whisper1', Synth.radioVoice(ctx, 2.2, 92, 1.05, true));
    this.buffers.set('drone', Synth.dreadDrone(ctx));
    this.buffers.set('rumble', Synth.elevatorRumble(ctx));
    this.buffers.set('bang', Synth.cabinBang(ctx));
    this.buffers.set('rain', Synth.rain(ctx));
    this.buffers.set('city', Synth.cityHum(ctx));
    this.buffers.set('drip', Synth.drip(ctx));
    this.buffers.set('splash0', Synth.splash(ctx, 0));
    this.buffers.set('splash1', Synth.splash(ctx, 1));
    this.buffers.set('machinery', Synth.machinery(ctx));
    this.buffers.set('steam', Synth.steamHiss(ctx));
    this.buffers.set('grate0', Synth.grateClang(ctx, 0));
    this.buffers.set('grate1', Synth.grateClang(ctx, 1));
    this.buffers.set('vent', Synth.ventScrape(ctx));
    this.buffers.set('growl', Synth.houndGrowl(ctx));
    this.buffers.set('snap', Synth.houndSnap(ctx));
    this.buffers.set('flutter', Synth.mothFlutter(ctx));
    this.buffers.set('giggle', Synth.smilerGiggle(ctx));

    this.samplesReady = this.loadSamples('assets/audio/');

    for (let i = 0; i < 8; i++) this.oneShots.push(new THREE.Audio(this.listener));
    for (let i = 0; i < 6; i++) {
      const p = new THREE.PositionalAudio(this.listener);
      p.setRefDistance(1.5);
      p.setRolloffFactor(1.4);
      p.setDistanceModel('inverse');
      scene.add(p);
      this.spatialShots.push(p);
    }
  }

  /** Recorded CC0 set (Kenney packs + modelled hinge creaks), decoded in the background. */
  private async loadSamples(base: string): Promise<void> {
    const ctx = this.listener.context;
    try {
      const res = await fetch(`${base}sfx.json`);
      if (!res.ok) return;
      const man = (await res.json()) as Record<string, string[]>;
      await Promise.all(Object.entries(man).map(async ([key, files]) => {
        const bufs = await Promise.all(files.map(async (f) => {
          try { return await ctx.decodeAudioData(await (await fetch(base + f)).arrayBuffer()); } catch { return null; }
        }));
        const ok = bufs.filter((b): b is AudioBuffer => !!b);
        if (ok.length) this.variants.set(key, ok);
      }));
    } catch { /* offline without cache, or blocked: the synthesized set stays */ }
  }

  /** a variant for this key (never the same one twice in a row), else the synthesized buffer */
  private pick(key: string): AudioBuffer | undefined {
    const v = this.variants.get(key);
    if (v?.length) {
      let i = Math.floor(Math.random() * v.length);
      if (v.length > 1 && i === this.lastVariant.get(key)) i = (i + 1) % v.length;
      this.lastVariant.set(key, i);
      return v[i];
    }
    return this.buffers.get(key as SoundKey);
  }

  /** what the player's feet are on (per level) */
  setFloor(kind: FloorKind): void { this.floor = kind; }

  /**
   * The space everything is heard in: a generated impulse response (early
   * reflections + a decaying, darkening tail) on a parallel send after the master.
   */
  setRoom(room: RoomAcoustic): void {
    const ctx = this.listener.context;
    if (!this.convolver) {
      this.convolver = ctx.createConvolver();
      this.wet = ctx.createGain();
      this.listener.gain.connect(this.convolver);
      this.convolver.connect(this.wet);
      this.wet.connect(ctx.destination);
    }
    this.convolver.buffer = impulseResponse(ctx, room);
    this.wet!.gain.value = room.wet;
  }

  async resume(): Promise<void> {
    if (this.listener.context.state !== 'running') await this.listener.context.resume().catch(() => undefined);
  }

  setMasterVolume(v: number): void {
    this.listener.setMasterVolume(v);
  }

  /** Start ambient loops: room tone everywhere + a quiet global hum bed. */
  startAmbience(): void {
    const tone = new THREE.Audio(this.listener);
    tone.setBuffer(this.buffers.get('roomTone')!);
    tone.setLoop(true);
    tone.setVolume(0.12);
    tone.play();
    this.loops.push(tone);

    const hum = new THREE.Audio(this.listener);
    hum.setBuffer(this.buffers.get('hum')!);
    hum.setLoop(true);
    hum.setVolume(0.035);
    hum.play();
    this.globalHum = hum;
    this.loops.push(hum);
  }

  /** Generic looping positional source attached to an object (entities). */
  attachLoop(obj: THREE.Object3D, key: SoundKey, volume: number, refDistance = 1.5, rolloff = 1.4): THREE.PositionalAudio {
    const p = new THREE.PositionalAudio(this.listener);
    p.setBuffer(this.buffers.get(key)!);
    p.setLoop(true);
    p.setRefDistance(refDistance);
    p.setRolloffFactor(rolloff);
    p.setDistanceModel('inverse');
    p.setVolume(volume);
    p.offset = Math.random() * 1.5;
    obj.add(p);
    p.play();
    this.loops.push(p);
    return p;
  }

  /** Non-positional loop with live volume control (drone, rain, rumble…). */
  loop(key: SoundKey, volume = 0): THREE.Audio {
    const a = new THREE.Audio(this.listener);
    a.setBuffer(this.buffers.get(key)!);
    a.setLoop(true);
    a.setVolume(volume);
    a.play();
    this.loops.push(a);
    return a;
  }

  /** Attach a looping positional hum to a light (follows the pooled light). */
  attachHum(obj: THREE.Object3D, volume = 0.22): THREE.PositionalAudio {
    const p = new THREE.PositionalAudio(this.listener);
    p.setBuffer(this.buffers.get('hum')!);
    p.setLoop(true);
    p.setRefDistance(0.9);
    p.setRolloffFactor(1.6);
    p.setMaxDistance(12);
    p.setVolume(volume);
    // de-correlate loops so many fixtures don't phase together
    p.offset = Math.random() * 2;
    p.setPlaybackRate(0.985 + Math.random() * 0.03);
    obj.add(p);
    p.play();
    this.loops.push(p);
    return p;
  }

  /** Play an ad-hoc buffer (e.g. a generated recorder voice); returns the source for stopping. */
  playBuffer(buf: AudioBuffer, volume = 1): THREE.Audio {
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(volume);
    a.play();
    return a;
  }

  /** One-shot positional ad-hoc buffer (mimicked voices). */
  playBufferAt(buf: AudioBuffer, pos: THREE.Vector3, volume = 1, muffled = false): void {
    const a = this.spatialShots[this.spatialIdx++ % this.spatialShots.length];
    if (a.isPlaying) a.stop();
    a.position.copy(pos);
    a.updateMatrixWorld();
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(1);
    if (muffled) {
      const f = this.listener.context.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      a.setFilter(f);
    } else if (a.getFilters().length) a.setFilters([]);
    a.play();
  }

  play(key: SoundKey, volume = 1, rate = 1): void {
    const buf = this.pick(key);
    if (!buf) return;
    const a = this.oneShots[this.oneShotIdx++ % this.oneShots.length];
    if (a.isPlaying) a.stop();
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
  }

  playAt(key: SoundKey, pos: THREE.Vector3, volume = 1, rate = 1, muffled = false): void {
    const buf = this.pick(key);
    if (!buf) return;
    const a = this.spatialShots[this.spatialIdx++ % this.spatialShots.length];
    if (a.isPlaying) a.stop();
    a.position.copy(pos);
    a.updateMatrixWorld();
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    if (muffled) {
      const f = this.listener.context.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      a.setFilter(f);
    } else if (a.getFilters().length) {
      a.setFilters([]);
    }
    a.play();
  }

  footstep(gait: 'crouch' | 'walk' | 'run', at?: THREE.Vector3, muffled = false): void {
    const recorded = this.variants.has(`step:${this.floor}`);
    const key = (recorded ? `step:${this.floor}` : `step${this.stepIdx++ % 4}`) as SoundKey;
    const vol = (gait === 'crouch' ? 0.18 : gait === 'run' ? 0.75 : 0.42) * (recorded ? 0.85 : 1);
    const rate = (gait === 'run' ? 1.05 : gait === 'crouch' ? 0.94 : 1) * (0.95 + Math.random() * 0.1);
    if (at) this.playAt(key, at, vol * 1.4, rate, muffled);
    else this.play(key, vol, rate);
  }

  /** Per frame: hum bed follows local light level; occasional distant sounds. */
  update(dt: number, localLight: number, listenerPos: THREE.Vector3): void {
    if (this.globalHum) {
      const target = 0.012 + Math.min(1, localLight) * 0.03;
      const cur = this.globalHum.getVolume();
      this.globalHum.setVolume(cur + (target - cur) * Math.min(1, dt * 2));
    }
    this.distantTimer -= dt;
    if (this.distantTimer <= 0) {
      this.distantTimer = 35 + Math.random() * 50;
      const a = Math.random() * Math.PI * 2;
      const d = 14 + Math.random() * 10;
      const p = listenerPos.clone().add(new THREE.Vector3(Math.cos(a) * d, 1.2, Math.sin(a) * d));
      this.playAt(`distant${Math.floor(Math.random() * 3)}` as SoundKey, p, 2.2, 0.9 + Math.random() * 0.2, true);
    }
  }

  dispose(): void {
    for (const l of this.loops) { if (l.isPlaying) l.stop(); l.removeFromParent(); }
    this.loops = [];
    for (const s of this.spatialShots) { if (s.isPlaying) s.stop(); s.removeFromParent(); }
    for (const s of this.oneShots) if (s.isPlaying) s.stop();
    this.listener.removeFromParent();
    void this.scene;
  }
}

/** Stereo impulse response: sparse early reflections, then noise decaying to −60 dB over `decay`, losing highs as it goes. */
function impulseResponse(ctx: BaseAudioContext, room: RoomAcoustic): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * Math.min(4, room.decay * 1.1)));
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let seed = 1234567 + ch * 7919;
    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.pow(10, (-3 * t) / room.decay);           // −60 dB at `decay`
      const k = Math.max(0.02, (1 - room.damp) * Math.exp(-t * (1 + room.damp * 6)) + 0.04);
      lp += (rnd() - lp) * k;                                   // the tail gets darker
      const onset = Math.min(1, t / 0.012);                      // a little pre-delay
      d[i] = lp * env * onset * 0.6;
    }
    // early reflections off nearby walls
    for (let r = 0; r < 7; r++) {
      const at = Math.floor(sr * (0.006 + r * (0.007 + room.decay * 0.004) + Math.abs(rnd()) * 0.004));
      if (at < len) d[at] += (rnd() > 0 ? 1 : -1) * 0.5 * Math.pow(0.72, r);
    }
  }
  return b;
}
