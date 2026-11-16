import * as THREE from 'three';
import { NOISE, OBJECTIVE } from '@shared/Constants';
import type { AudioManager } from '../audio/AudioManager';
import { radioVoice } from '../audio/SoundSynth';
import type { World } from '../world/World';
import { cellCenter } from '../world/Level0Layout';
import { allStoryLogs } from '../world/levels/StoryLogs';

export interface LogLine { at: number; text: string }
export interface RecorderLog { title: string; lines: LogLine[]; duration: number; pitch: number }

/**
 * Recordings in the player's own voice that the player never made (design doc 2.1).
 * They describe what the player is about to do. Log 3 names the frequency that
 * actually leads out — and admits the speaker chose the other one.
 */
export function buildLogs(rightFrequency: string): RecorderLog[] {
  return [
    {
      title: '녹음 01', pitch: 1, duration: 14.5,
      lines: [
        { at: 0, text: '…녹음 중인가? …됐다.' },
        { at: 2.6, text: '이걸 듣고 있다면, 넌 방금 이 녹음기를 주웠을 거야.' },
        { at: 6.0, text: '신호가 강해지는 쪽으로 가. 패널이 세 개 있어.' },
        { at: 9.6, text: '그리고… 지금 뒤를 돌아보고 싶겠지.' },
        { at: 12.4, text: '돌아보지 마.' },
      ],
    },
    {
      title: '녹음 02', pitch: 1, duration: 13.5,
      lines: [
        { at: 0, text: '레버를 내릴 때마다 소리가 나. 아주 멀리까지.' },
        { at: 3.4, text: '그게 듣고 있어. 처음엔 멀리서 보기만 해.' },
        { at: 7.0, text: '눈을 떼면… 가까워져 있어.' },
        { at: 10.0, text: '불빛이 떨리면, 이미 뒤에 있는 거야.' },
      ],
    },
    {
      title: '녹음 03', pitch: 0.96, duration: 15,
      lines: [
        { at: 0, text: '엘리베이터 안에 주파수가 두 개 있을 거야.' },
        { at: 3.2, text: `${rightFrequency} 메가헤르츠. 그쪽이야.` },
        { at: 6.4, text: '다른 쪽은… 돌아가는 길이 아니야.' },
        { at: 9.6, text: '나는 다른 쪽을 눌렀어.' },
        { at: 12.2, text: '그래서 지금 이걸 녹음하고 있는 거야.' },
      ],
    },
    {
      title: '녹음 04', pitch: 0.97, duration: 14,
      lines: [
        { at: 0, text: '여긴 Level 1이야. 창고. 끝이 없어.' },
        { at: 3.0, text: '불이 나가면 움직이지 마. 상자 뒤에 숨어.' },
        { at: 6.6, text: '상자 안에 아몬드 워터가 있을 거야. 이상한 맛이지만, 마셔.' },
        { at: 10.4, text: '차단기가 두 개 있어. B3 계단을 열어 줄 거야.' },
      ],
    },
    {
      title: '녹음 05', pitch: 0.94, duration: 14.5,
      lines: [
        { at: 0, text: '계단 아래는 배관뿐이래. 어둡고, 뜨겁고, 끝이 없대.' },
        { at: 4.0, text: '나는 여기서 너를 기다렸어.' },
        { at: 6.6, text: '아니… 네가 나를 기다린 건가.' },
        { at: 9.4, text: '신호가 약해져. 아래로 갈수록. 그런데 그건… 계속 따라와.' },
      ],
    },
    {
      title: '녹음 06', pitch: 0.95, duration: 15,
      lines: [
        { at: 0, text: '신호는 여기서 나와. 이 배관 끝, 무전실에서.' },
        { at: 3.6, text: '그것은 신호를 받아. 그래서 리시버야. 우리 목소리를 받아서… 따라 해.' },
        { at: 8.4, text: '밸브 두 개를 돌리면 무전실 문이 열려.' },
        { at: 11.4, text: '기계 옆에 붙어 있어. 그 소리가 널 숨겨 줘.' },
      ],
    },
    {
      title: '녹음 07', pitch: 0.92, duration: 17,
      lines: [
        { at: 0, text: '송신기 앞에 버튼이 두 개 있을 거야.' },
        { at: 3.2, text: '녹음하면, 다음 사람이 이걸 듣게 돼. 처음부터 다시.' },
        { at: 7.0, text: '끄면… 신호가 사라져. 그것도, 이 목소리도.' },
        { at: 10.6, text: '나는 매번 녹음을 골랐어. 혼자가 되는 게 무서워서.' },
        { at: 14.0, text: '이번엔… 네가 정해.' },
      ],
    },
  ];
}

export interface RecorderView {
  has: boolean;
  on: boolean;
  strength: number;     // 0..1 signal toward the objective
  voiceNear: boolean;   // a recording is close
  playing: string | null;
}

/**
 * Signal Recorder (design doc 4.3). R toggles it. While on it tracks the next
 * objective (nearest live relay, then the elevator) by ear and on its display,
 * and plays any recording it is close to — at the cost of noise.
 */
export class Recorder {
  has = false;
  on = false;
  strength = 0;
  voiceNear = false;
  readonly heard = new Set<number>();
  readonly logs: RecorderLog[];
  private playing: { index: number; t: number; src: THREE.Audio; line: number } | null = null;
  private hiss: THREE.Audio;
  private filter: BiquadFilterNode;
  private beepTimer = 0;
  private logSpots: { pos: THREE.Vector3; index: number }[];
  onSubtitle?: (text: string | null, title?: string) => void;

  constructor(private audio: AudioManager, private world: World) {
    // 01–07 (Levels 0–2) + 08–23 (two per level of the Expanded Campaign)
    this.logs = [...buildLogs(OBJECTIVE.FREQUENCIES[world.level.correctFrequency]), ...allStoryLogs()];
    this.logSpots = world.level.logSpots.map((s) => {
      const c = cellCenter(world.level, s.cx, s.cy);
      return { pos: new THREE.Vector3(c.x, 0, c.z), index: s.logIndex };
    });
    this.hiss = new THREE.Audio(audio.listener);
    this.hiss.setBuffer(audio.buffers.get('rStatic')!);
    this.hiss.setLoop(true);
    this.hiss.setVolume(0);
    this.filter = audio.listener.context.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = 0.8;
    this.hiss.setFilter(this.filter);
  }

  pickUp(): void {
    this.has = true;
  }

  toggle(): boolean {
    if (!this.has) return false;
    this.on = !this.on;
    this.audio.play('click', 0.6, 0.8);
    if (this.on) { if (!this.hiss.isPlaying) this.hiss.play(); }
    else {
      if (this.hiss.isPlaying) this.hiss.stop();
      this.stopLog();
    }
    return this.on;
  }

  /** Next objective the recorder homes in on. */
  target(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    const cam = this.lastPos;
    for (const r of this.world.relays.values()) {
      if (r.active) continue;
      const d = r.position().distanceTo(cam);
      if (d < bestD) { bestD = d; best = r.position(); }
    }
    if (!best && !this.world.elevator.ending) best = this.world.elevator.doorPosition;
    return best;
  }
  private lastPos = new THREE.Vector3();

  private playLog(index: number): void {
    const log = this.logs[index];
    const buf = radioVoice(this.audio.listener.context, log.duration, 300 + index * 17, log.pitch);
    const src = this.audio.playBuffer(buf, 0.9);
    this.playing = { index, t: 0, src, line: -1 };
  }

  private stopLog(): void {
    if (!this.playing) return;
    if (this.playing.src.isPlaying) this.playing.src.stop();
    this.playing = null;
    this.onSubtitle?.(null);
  }

  /** @returns the noise radius it is making right now (0 when off) */
  /** @param interference 0..1 — the Receiver is close: the signal goes wild */
  update(dt: number, camPos: THREE.Vector3, camDir: THREE.Vector3, interference = 0): number {
    this.lastPos.copy(camPos);
    if (!this.on) { this.strength = 0; this.voiceNear = false; return 0; }

    // ── tracking ────────────────────────────────────────────
    const tgt = this.target();
    let s = 0;
    if (tgt) {
      const to = tgt.clone().sub(camPos).setY(0);
      const d = to.length();
      const facing = camDir.clone().setY(0).normalize().dot(to.normalize()) * 0.5 + 0.5;
      s = THREE.MathUtils.clamp(1 - d / 45, 0, 1) ** 1.3 * (0.3 + 0.7 * facing ** 2);
    }
    this.strength += (s - this.strength) * Math.min(1, dt * 4);
    if (interference > 0) this.strength = THREE.MathUtils.clamp(this.strength + (Math.random() - 0.5) * interference * 1.4, 0, 1);
    this.filter.frequency.value = 400 + this.strength * 2600;
    this.hiss.setVolume((this.playing ? 0.04 : 0.1 + (1 - this.strength) * 0.12) + interference * 0.35);
    this.beepTimer -= dt;
    if (!this.playing && this.beepTimer <= 0) {
      this.beepTimer = THREE.MathUtils.lerp(1.5, 0.12, this.strength ** 1.4);
      this.audio.play('beep', 0.12 + this.strength * 0.25, 0.9 + this.strength * 0.3);
    }

    // ── recordings ──────────────────────────────────────────
    this.voiceNear = this.logSpots.some((l) => !this.heard.has(l.index) && l.pos.distanceTo(camPos.clone().setY(0)) < OBJECTIVE.LOG_RADIUS * 2);
    if (!this.playing) {
      if (!this.heard.has(0)) this.playLog(0);
      else {
        const spot = this.logSpots.find((l) => !this.heard.has(l.index) && l.pos.distanceTo(camPos.clone().setY(0)) < OBJECTIVE.LOG_RADIUS);
        if (spot) this.playLog(spot.index);
      }
    }
    if (this.playing) {
      const p = this.playing;
      p.t += dt;
      const log = this.logs[p.index];
      let line = -1;
      log.lines.forEach((l, i) => { if (p.t >= l.at) line = i; });
      if (line !== p.line) {
        p.line = line;
        if (line >= 0) this.onSubtitle?.(log.lines[line].text, log.title);
      }
      if (p.t >= log.duration) {
        this.heard.add(p.index);
        this.stopLog();
      }
      return NOISE.RECORDER_PLAY;
    }
    return NOISE.RECORDER_SCAN;
  }

  get view(): RecorderView {
    return {
      has: this.has, on: this.on, strength: this.strength, voiceNear: this.voiceNear,
      playing: this.playing ? this.logs[this.playing.index].title : null,
    };
  }

  dispose(): void {
    this.stopLog();
    if (this.hiss.isPlaying) this.hiss.stop();
  }
}
