/**
 * Procedural sound synthesis. All buffers are generated at load time so the
 * prototype needs no audio files; real recordings (Freesound CC0) can replace any
 * of these later by key in AudioManager.
 */
type Ctx = BaseAudioContext;

function rngFrom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function buffer(ctx: Ctx, seconds: number, fill: (t: number, i: number, sr: number) => number, channels = 1): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const b = ctx.createBuffer(channels, len, sr);
  for (let c = 0; c < channels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = fill(i / sr, i, sr);
  }
  return b;
}

function normalize(b: AudioBuffer, peak = 0.9): AudioBuffer {
  let max = 0;
  for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= peak / max;
  }
  return b;
}

/** Magnetic-ballast fluorescent hum: 120 Hz + harmonics with a gritty buzz. Seamless 2 s loop. */
export function fluorescentHum(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(77);
  let lp = 0;
  return normalize(buffer(ctx, 2, (t) => {
    const w = 2 * Math.PI * t;
    const tone =
      Math.sin(w * 120) * 0.5 +
      Math.sin(w * 240 + 0.3) * 0.32 +
      Math.sin(w * 360 + 1.1) * 0.18 +
      Math.sin(w * 480) * 0.08 +
      Math.sin(w * 1080 + 0.7) * 0.05;
    // buzz: clipped 120 Hz gives the characteristic rasp
    const buzz = Math.max(-0.4, Math.min(0.4, Math.sin(w * 120) * 3)) * 0.18;
    lp += (noise() - lp) * 0.08;
    return tone + buzz + lp * 0.12;
  }), 0.7);
}

/** Low room tone / building rumble, 4 s loop with crossfaded seam. */
export function roomTone(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(5);
  let brown = 0;
  const b = buffer(ctx, 4, (t) => {
    brown = (brown + noise() * 0.02) * 0.995;
    return brown * 3 + Math.sin(2 * Math.PI * 55 * t) * 0.02;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
  }
  return normalize(b, 0.5);
}

/** Footstep on old, damp carpet: muffled thud + soft squelch. */
export function carpetStep(ctx: Ctx, variant: number): AudioBuffer {
  const noise = rngFrom(1000 + variant * 31);
  let lp1 = 0, lp2 = 0;
  const cutoff = 0.06 + variant * 0.012;
  const len = 0.24;
  return normalize(buffer(ctx, len, (t) => {
    const env = t < 0.006 ? t / 0.006 : Math.exp(-(t - 0.006) * 28);
    const n = noise();
    lp1 += (n - lp1) * cutoff;
    lp2 += (lp1 - lp2) * cutoff;
    const thump = Math.sin(2 * Math.PI * (68 + variant * 6) * t) * Math.exp(-t * 45) * 0.9;
    // wet squish shortly after the heel strike
    const squish = t > 0.05 ? (noise() * 0.18) * Math.exp(-(t - 0.05) * 40) * (lp1 * 4) : 0;
    return lp2 * 5 * env + thump + squish;
  }), 0.85);
}

export function doorOpen(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(4242);
  let phase = 0;
  let lp = 0;
  return normalize(buffer(ctx, 1.3, (t, _i, sr) => {
    // latch click
    const click = t < 0.012 ? noise() * (1 - t / 0.012) : 0;
    // hinge creak: stick-slip — pitch wanders 280..620 Hz with grainy amplitude
    let creak = 0;
    if (t > 0.08) {
      const ct = t - 0.08;
      const f = 300 + Math.sin(ct * 3.1) * 140 + Math.sin(ct * 11.7) * 60 + ct * 120;
      phase += (2 * Math.PI * f) / sr;
      const grain = 0.5 + 0.5 * Math.sin(ct * 2 * Math.PI * 38) ;
      const env = Math.min(1, ct * 6) * Math.exp(-ct * 1.6);
      lp += (noise() - lp) * 0.3;
      creak = (Math.sin(phase) * 0.6 + Math.sin(phase * 2.01) * 0.25 + lp * 0.15) * grain * env * 0.5;
    }
    return click * 0.9 + creak;
  }), 0.8);
}

export function doorClose(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(99);
  let lp = 0;
  return normalize(buffer(ctx, 0.7, (t) => {
    lp += (noise() - lp) * 0.12;
    const thud = Math.sin(2 * Math.PI * 85 * t) * Math.exp(-t * 18) + lp * 2 * Math.exp(-t * 30);
    const latch = t > 0.03 && t < 0.045 ? noise() * 0.7 : 0;
    const rattle = t > 0.05 ? Math.sin(2 * Math.PI * 900 * t) * Math.exp(-(t - 0.05) * 50) * 0.15 : 0;
    return thud + latch + rattle;
  }), 0.85);
}

export function click(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(12);
  return normalize(buffer(ctx, 0.09, (t) => {
    const a = t < 0.004 ? noise() * (1 - t / 0.004) : 0;
    const b = t > 0.05 && t < 0.053 ? noise() * 0.6 : 0;
    return a + b + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 300) * 0.4;
  }), 0.6);
}

export function paperRustle(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(321);
  let hp = 0, prev = 0;
  return normalize(buffer(ctx, 0.5, (t) => {
    const n = noise();
    hp = 0.85 * (hp + n - prev);
    prev = n;
    const crinkle = Math.abs(Math.sin(t * 70)) * Math.abs(Math.sin(t * 23 + 1));
    return hp * crinkle * Math.min(1, t * 20) * Math.exp(-t * 5);
  }), 0.6);
}

export function pickup(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(55);
  return normalize(buffer(ctx, 0.25, (t) => {
    const tick = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 80);
    const scrape = noise() * Math.exp(-t * 25) * 0.25;
    return tick * 0.6 + scrape;
  }), 0.6);
}

/** Far-away, muffled impact somewhere in the building. */
export function distantThud(ctx: Ctx, variant: number): AudioBuffer {
  const noise = rngFrom(800 + variant);
  let lp = 0;
  return normalize(buffer(ctx, 2.2, (t) => {
    lp += (noise() - lp) * 0.02;
    const boom = Math.sin(2 * Math.PI * (45 + variant * 8) * t) * Math.exp(-t * 3.2);
    const hits = variant % 2 === 0 && t > 0.6 ? Math.sin(2 * Math.PI * 52 * t) * Math.exp(-(t - 0.6) * 5) * 0.6 : 0;
    return (boom + hits) * 0.8 + lp * 4 * Math.exp(-t * 1.5);
  }), 0.9);
}

// ── The Receiver ──────────────────────────────────────────────

/** Slow, wet, rasping breath — 3.2 s loop (in, hold, long out). */
export function receiverBreath(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(4040);
  let bp1 = 0, bp2 = 0;
  const b = buffer(ctx, 3.2, (t) => {
    const n = noise();
    // crude band-pass around a throat formant
    bp1 += (n - bp1) * 0.25;
    bp2 += (bp1 - bp2) * 0.25;
    const band = bp1 - bp2;
    const inhale = t < 0.9 ? Math.sin((t / 0.9) * Math.PI) : 0;
    const exhale = t > 1.3 && t < 3.0 ? Math.sin(((t - 1.3) / 1.7) * Math.PI) : 0;
    const rattle = 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 23) * Math.sin(t * 2 * Math.PI * 3.1);
    return band * (inhale * 0.7 + exhale * rattle) * 3;
  });
  return normalize(b, 0.8);
}

/** Radio static with crackles and a faint buried carrier tone. Seamless 2 s loop. */
export function signalStatic(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(777);
  let hp = 0, prev = 0, lp = 0;
  const b = buffer(ctx, 2, (t) => {
    const n = noise();
    hp = 0.6 * (hp + n - prev);
    prev = n;
    lp += (hp - lp) * 0.35;
    const crackle = noise() > 0.995 ? noise() * 3 : 0;
    const carrier = Math.sin(2 * Math.PI * 1000 * t) * 0.04 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t));
    const flutter = 0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t);
    return (lp * 0.9 * flutter) + crackle + carrier;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.1);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[d.length - fade + i] * (1 - k); }
  return normalize(b, 0.7);
}

/** Heavy, slightly scraping step — bare and wrong on the damp carpet. */
export function receiverStep(ctx: Ctx, variant: number): AudioBuffer {
  const noise = rngFrom(1700 + variant * 13);
  let lp = 0;
  return normalize(buffer(ctx, 0.45, (t) => {
    lp += (noise() - lp) * 0.05;
    const thud = Math.sin(2 * Math.PI * (48 + variant * 5) * t) * Math.exp(-t * 22);
    const drag = t > 0.08 ? lp * 3 * Math.exp(-(t - 0.08) * 9) * (variant % 2 ? 1 : 0.4) : 0;
    const knuckle = t > 0.02 && t < 0.03 ? noise() * 0.4 : 0;
    return thud + drag + knuckle + lp * 2 * Math.exp(-t * 35);
  }), 0.9);
}

/** Attack wind-up: a rising, distorted, radio-like shriek (kept short, not deafening). */
export function receiverScreech(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(31337);
  let phase = 0;
  return normalize(buffer(ctx, 0.75, (t, _i, sr) => {
    const f = 380 + t * 1400 + Math.sin(t * 90) * 60;
    phase += (2 * Math.PI * f) / sr;
    const tone = Math.tanh(Math.sin(phase) * 4 + Math.sin(phase * 1.5) * 2) * 0.5;
    const env = Math.min(1, t * 8) * (t > 0.55 ? Math.max(0, 1 - (t - 0.55) / 0.2) : 1);
    return (tone + noise() * 0.35) * env;
  }), 0.75);
}

export function hitImpact(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(66);
  let lp = 0;
  return normalize(buffer(ctx, 0.6, (t) => {
    lp += (noise() - lp) * 0.15;
    return Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 12) + lp * 2.5 * Math.exp(-t * 18) + noise() * 0.5 * Math.exp(-t * 60);
  }), 0.95);
}

/** Short static burst (chase start / signal lost). */
export function staticBurst(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(2024);
  return normalize(buffer(ctx, 0.9, (t) => {
    const gate = Math.sin(t * 2 * Math.PI * 17) > -0.2 ? 1 : 0.3;
    return noise() * gate * Math.min(1, t * 30) * Math.exp(-t * 3);
  }), 0.6);
}

export function heartbeat(ctx: Ctx): AudioBuffer {
  return normalize(buffer(ctx, 0.9, (t) => {
    const beat = (t0: number, a: number) => (t > t0 ? Math.sin(2 * Math.PI * 52 * (t - t0)) * Math.exp(-(t - t0) * 20) * a : 0);
    return beat(0, 1) + beat(0.22, 0.7);
  }), 0.8);
}

// ── Signal Recorder & objectives ──────────────────────────────

/** Direct-form biquad band-pass (RBJ cookbook). */
function bandpass(f: number, q: number, sr: number) {
  const w = (2 * Math.PI * f) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const VOWELS: [number, number][] = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1700]];

/**
 * A voice on a bad radio: formant-synthesised babble (no real words — the
 * subtitles carry the text) pushed through a band-limited, clipped, static-laden
 * channel with dropouts. `pitch` ~ 0.9–1.1 shifts the speaker.
 */
export function radioVoice(ctx: Ctx, seconds: number, seed: number, pitch = 1, whisper = false): AudioBuffer {
  const sr = ctx.sampleRate;
  const noise = rngFrom(seed * 7 + 1);
  const pick = rngFrom(seed * 13 + 5);
  const len = Math.floor(seconds * sr);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let phase = 0;
  let sylEnd = 0, sylStart = 0, f1 = bandpass(700, 6, sr), f2 = bandpass(1200, 8, sr);
  let pause = false;
  let hp = 0, prevIn = 0, lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if (i >= sylEnd) {
      // next syllable (or a short pause between "words")
      pause = Math.abs(pick()) < 0.18;
      sylStart = i;
      sylEnd = i + Math.floor(sr * (pause ? 0.08 + Math.abs(pick()) * 0.18 : 0.1 + Math.abs(pick()) * 0.14));
      const v = VOWELS[Math.floor(Math.abs(pick()) * VOWELS.length) % VOWELS.length];
      f1 = bandpass(v[0] * pitch, 5, sr);
      f2 = bandpass(v[1] * pitch, 7, sr);
    }
    const sp = (i - sylStart) / Math.max(1, sylEnd - sylStart);
    const env = pause ? 0 : Math.sin(Math.PI * Math.min(1, sp * 1.15)) ** 0.6;
    // glottal source: falling sawtooth with drifting pitch; whispers use noise
    const f0 = (108 + Math.sin(t * 2.3) * 9 + Math.sin(t * 11) * 3) * pitch;
    phase = (phase + f0 / sr) % 1;
    const src = whisper ? noise() * 0.6 : (1 - 2 * phase) * 0.7 + noise() * 0.05;
    const consonant = sp < 0.12 && !pause ? noise() * (0.12 - sp) * 4 : 0;
    let s = (f1(src) * 1.0 + f2(src) * 0.6) * env + consonant * 0.3;
    // radio channel: band-limit, clip, static, dropouts
    hp = 0.95 * (hp + s - prevIn); prevIn = s;
    lp += (hp - lp) * 0.45;
    s = Math.tanh(lp * 3) * 0.8;
    const drop = Math.sin(t * 1.7 + seed) > 0.93 ? 0.15 : 1;
    d[i] = s * drop + noise() * (whisper ? 0.05 : 0.07) + (noise() > 0.996 ? noise() * 0.5 : 0);
  }
  return normalize(b, whisper ? 0.5 : 0.8);
}

export function beep(ctx: Ctx): AudioBuffer {
  return normalize(buffer(ctx, 0.06, (t) => Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 40) * (t < 0.05 ? 1 : 0)), 0.5);
}

export function relayClunk(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(5150);
  let lp = 0;
  return normalize(buffer(ctx, 1.4, (t) => {
    lp += (noise() - lp) * 0.2;
    const clunk = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 14) + lp * 2 * Math.exp(-t * 25);
    const arc = t > 0.05 && t < 0.4 ? noise() * 0.3 * Math.exp(-(t - 0.05) * 8) * (Math.sin(t * 900) > 0 ? 1 : 0.3) : 0;
    const hum = t > 0.2 ? Math.sin(2 * Math.PI * 120 * t) * 0.2 * Math.min(1, (t - 0.2) * 2) * Math.exp(-(t - 0.2) * 1.2) : 0;
    return clunk + arc + hum;
  }), 0.9);
}

/** Power returning to the whole floor: a deep thump and a rising, building hum. */
export function powerSurge(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(60);
  let phase = 0;
  return normalize(buffer(ctx, 4, (t, _i, sr) => {
    const f = 40 + t * 30;
    phase += (2 * Math.PI * f) / sr;
    const thump = Math.sin(2 * Math.PI * 38 * t) * Math.exp(-t * 3) * 1.2;
    const rise = (Math.sin(phase) + Math.sin(phase * 2) * 0.4) * Math.min(1, t / 3) * 0.5 * (t > 3.6 ? (4 - t) / 0.4 : 1);
    return thump + rise + noise() * 0.04;
  }), 0.9);
}

export function elevatorDing(ctx: Ctx): AudioBuffer {
  return normalize(buffer(ctx, 2, (t) => {
    const a = Math.sin(2 * Math.PI * 1046 * t) * Math.exp(-t * 2.5);
    const b = t > 0.35 ? Math.sin(2 * Math.PI * 784 * (t - 0.35)) * Math.exp(-(t - 0.35) * 2.2) : 0;
    return (a + b) * 0.6;
  }), 0.7);
}

export function elevatorDoor(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(808);
  let lp = 0;
  return normalize(buffer(ctx, 1.8, (t) => {
    lp += (noise() - lp) * 0.04;
    const motor = Math.sin(2 * Math.PI * 95 * t + Math.sin(t * 40) * 0.4) * 0.3;
    const env = Math.min(1, t * 4) * Math.min(1, (1.8 - t) * 3);
    const stop = t > 1.55 ? Math.sin(2 * Math.PI * 60 * t) * Math.exp(-(t - 1.55) * 20) : 0;
    return (motor + lp * 3) * env + stop;
  }), 0.8);
}

export function knock(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(4321);
  let lp = 0;
  const hits = [0, 0.32, 0.6];
  return normalize(buffer(ctx, 1.2, (t) => {
    lp += (noise() - lp) * 0.3;
    let s = 0;
    for (const h of hits) if (t >= h) s += (Math.sin(2 * Math.PI * 140 * (t - h)) + lp) * Math.exp(-(t - h) * 35);
    return s;
  }), 0.8);
}

// ── Dread & endings ───────────────────────────────────────────

/** Low, detuned, slowly beating drone with a breathing noise bed. Seamless 8 s loop. */
export function dreadDrone(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(13);
  let lp = 0;
  const b = buffer(ctx, 8, (t) => {
    const w = 2 * Math.PI * t;
    // all frequencies are multiples of 1/8 Hz → seamless
    const tones = Math.sin(w * 41.125) * 0.5 + Math.sin(w * 41.5) * 0.45 + Math.sin(w * 61.75 + 1) * 0.25 + Math.sin(w * 82.25) * 0.12;
    const swell = 0.6 + 0.4 * Math.sin(w * 0.125);
    lp += (noise() - lp) * 0.01;
    const dissonance = Math.sin(w * 233.125) * Math.sin(w * 0.25) * 0.05;
    return (tones * swell + lp * 2.5 + dissonance) * 0.6;
  });
  return normalize(b, 0.8);
}

export function elevatorRumble(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(707);
  let lp = 0;
  const b = buffer(ctx, 4, (t) => {
    lp += (noise() - lp) * 0.03;
    const motor = Math.sin(2 * Math.PI * 55 * t + Math.sin(2 * Math.PI * 0.5 * t) * 2) * 0.25;
    const rattle = Math.sin(2 * Math.PI * 9 * t) > 0.97 ? noise() * 0.3 : 0;
    return lp * 3 + motor + rattle;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.2);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[d.length - fade + i] * (1 - k); }
  return normalize(b, 0.7);
}

/** Something hitting the elevator cab from outside. */
export function cabinBang(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(1313);
  let lp = 0;
  const hits = [0, 0.45, 0.62, 1.3];
  return normalize(buffer(ctx, 2.2, (t) => {
    lp += (noise() - lp) * 0.25;
    let s = 0;
    for (const h of hits) if (t >= h) {
      const k = t - h;
      s += (Math.sin(2 * Math.PI * 70 * k) * 1.2 + lp * 1.5 + Math.sin(2 * Math.PI * 410 * k) * 0.3) * Math.exp(-k * 9);
    }
    return s;
  }), 0.95);
}

/** Steady rain on asphalt — 4 s seamless loop. */
export function rain(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(1999);
  let lp = 0, hp = 0, prev = 0;
  const b = buffer(ctx, 4, () => {
    const n = noise();
    hp = 0.97 * (hp + n - prev); prev = n;
    lp += (hp - lp) * 0.5;
    const drop = noise() > 0.9985 ? noise() * 1.5 : 0;
    return lp * 0.6 + drop;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[d.length - fade + i] * (1 - k); }
  return normalize(b, 0.6);
}

/** Distant traffic and a city hum. 6 s loop. */
export function cityHum(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(42);
  let lp = 0;
  const b = buffer(ctx, 6, (t) => {
    lp += (noise() - lp) * 0.008;
    const pass = Math.exp(-((t - 2.2) ** 2) * 1.5) * Math.sin(2 * Math.PI * (90 - (t - 2.2) * 12) * t) * 0.15;
    return lp * 4 + pass;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.4);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[d.length - fade + i] * (1 - k); }
  return normalize(b, 0.6);
}

export function drip(ctx: Ctx): AudioBuffer {
  return normalize(buffer(ctx, 0.5, (t) => {
    const f = 900 + 1400 * Math.exp(-t * 30);
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 18) * 0.7;
  }), 0.6);
}

/** Wading through standing water. */
export function splash(ctx: Ctx, variant: number): AudioBuffer {
  const noise = rngFrom(2500 + variant * 7);
  let hp = 0, prev = 0, lp = 0;
  return normalize(buffer(ctx, 0.45, (t) => {
    const n = noise();
    hp = 0.9 * (hp + n - prev); prev = n;
    lp += (hp - lp) * 0.35;
    const env = Math.min(1, t * 60) * Math.exp(-t * 9);
    const bubble = Math.sin(2 * Math.PI * (500 + variant * 120 - t * 600) * t) * Math.exp(-t * 20) * 0.3;
    return lp * env * 1.6 + bubble;
  }), 0.8);
}

/** Distant warehouse machinery: a slow industrial thrum. 6 s loop. */
export function machinery(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(31);
  let lp = 0;
  const b = buffer(ctx, 6, (t) => {
    lp += (noise() - lp) * 0.006;
    const thrum = Math.sin(2 * Math.PI * 47 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (1 / 1.5) * t)) * 0.25;
    const clank = (t % 3) < 0.04 ? noise() * 0.4 * (1 - (t % 3) / 0.04) : 0;
    return lp * 5 + thrum + clank;
  });
  const d = b.getChannelData(0);
  const fade = Math.floor(ctx.sampleRate * 0.4);
  for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[d.length - fade + i] * (1 - k); }
  return normalize(b, 0.6);
}

/** A pipe venting steam: sharp onset, long roaring hiss. */
export function steamHiss(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(9090);
  let hp = 0, prev = 0;
  return normalize(buffer(ctx, 2.2, (t) => {
    const n = noise();
    hp = 0.98 * (hp + n - prev); prev = n;
    const env = Math.min(1, t * 25) * (t < 1.4 ? 1 : Math.max(0, 1 - (t - 1.4) / 0.8));
    return hp * env * (0.8 + 0.2 * Math.sin(t * 40));
  }), 0.85);
}

/** Boot on a steel grate: a ringing clank. */
export function grateClang(ctx: Ctx, variant: number): AudioBuffer {
  const noise = rngFrom(4400 + variant);
  return normalize(buffer(ctx, 0.6, (t) => {
    const ring = Math.sin(2 * Math.PI * (620 + variant * 90) * t) * 0.4 + Math.sin(2 * Math.PI * (1430 + variant * 130) * t) * 0.25;
    const hit = t < 0.01 ? noise() : 0;
    return (ring * Math.exp(-t * 9) + hit * 0.8 + Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 30) * 0.6);
  }), 0.8);
}

/** Something moving inside a duct. */
export function ventScrape(ctx: Ctx): AudioBuffer {
  const noise = rngFrom(707070);
  let lp = 0;
  return normalize(buffer(ctx, 2.6, (t) => {
    lp += (noise() - lp) * 0.08;
    const drag = Math.max(0, Math.sin(t * 9)) * Math.max(0, Math.sin(t * 2.3 + 1));
    const tap = Math.sin(t * 27) > 0.97 ? noise() * 0.6 : 0;
    return (lp * 2.5 * drag + tap) * Math.min(1, t * 3) * Math.min(1, (2.6 - t) * 2);
  }), 0.7);
}
