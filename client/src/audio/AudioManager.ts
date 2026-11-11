import * as THREE from 'three';
import * as Synth from './SoundSynth';

export type SoundKey =
  | 'hum' | 'roomTone' | 'doorOpen' | 'doorClose' | 'click' | 'paper' | 'pickup'
  | 'step0' | 'step1' | 'step2' | 'step3' | 'distant0' | 'distant1' | 'distant2';

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

  play(key: SoundKey, volume = 1, rate = 1): void {
    const buf = this.buffers.get(key);
    if (!buf) return;
    const a = this.oneShots[this.oneShotIdx++ % this.oneShots.length];
    if (a.isPlaying) a.stop();
    a.setBuffer(buf);
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
  }

  playAt(key: SoundKey, pos: THREE.Vector3, volume = 1, rate = 1, muffled = false): void {
    const buf = this.buffers.get(key);
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
    const key = `step${this.stepIdx++ % 4}` as SoundKey;
    const vol = gait === 'crouch' ? 0.18 : gait === 'run' ? 0.75 : 0.42;
    const rate = (gait === 'run' ? 1.08 : 1) * (0.92 + Math.random() * 0.16);
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
