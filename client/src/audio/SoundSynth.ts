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
