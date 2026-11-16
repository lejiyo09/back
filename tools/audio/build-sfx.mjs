#!/usr/bin/env node
/**
 * Builds the recorded sound set in client/public/assets/audio/ from Kenney's
 * CC0 packs (RPG Audio, Impact Sounds, Foley Sounds, Sci-fi Sounds) plus a
 * physically modelled door-hinge creak, and writes sfx.json (key → variants).
 *
 *   node tools/audio/build-sfx.mjs <kenney-source-dir>
 *
 * The source dir holds one folder per pack (kenney-rpg-audio/, kenney-impact-sounds/, …)
 * with the original .ogg files; SOURCES below pins every file by SHA-256 (from
 * the packs as mirrored in github.com/series-ai/jam-ready-assets, Git LFS).
 * Every pack ships a License.txt: Creative Commons Zero (CC0 1.0).
 * Requires ffmpeg with libmp3lame.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.argv[2] ?? '');
const OUT = resolve('client/public/assets/audio');
const TMP = resolve('.sfx-tmp');
if (!process.argv[2] || !existsSync(SRC)) { console.error('usage: node tools/audio/build-sfx.mjs <kenney-source-dir>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const SR = 44100;

// ── helpers ────────────────────────────────────────────────────────────────
const src = (pack, name) => {
  const p = join(SRC, pack, name);
  if (!existsSync(p)) throw new Error(`missing source ${pack}/${name}`);
  return p;
};
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
function maxDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

/** mix inputs [{file, at (s), gain (dB), filters}] → wav */
function mix(outWav, inputs, post = '') {
  const args = [];
  const parts = [];
  inputs.forEach((inp, i) => {
    args.push('-i', inp.file);
    const f = [`aresample=${SR}`, 'aformat=channel_layouts=mono'];
    if (inp.filters) f.push(inp.filters);
    if (inp.gain) f.push(`volume=${inp.gain}dB`);
    if (inp.at) f.push(`adelay=${Math.round(inp.at * 1000)}`);
    parts.push(`[${i}:a]${f.join(',')}[a${i}]`);
  });
  const ins = inputs.map((_, i) => `[a${i}]`).join('');
  const graph = `${parts.join(';')};${ins}amix=inputs=${inputs.length}:normalize=0:duration=longest${post ? ',' + post : ''}[m]`;
  ff([...args, '-filter_complex', graph, '-map', '[m]', '-ar', String(SR), '-ac', '1', outWav]);
}

/** peak-normalise to `peak` dBFS, trim trailing silence, encode mp3 */
function finish(wav, name, peak = -1, extra = '') {
  const max = maxDb(wav);
  const gain = peak - max;
  const out = join(OUT, `${name}.mp3`);
  const f = [`volume=${gain.toFixed(2)}dB`, 'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB', 'afade=t=in:d=0.004', 'areverse'];
  if (extra) f.unshift(extra);
  ff(['-i', wav, '-af', f.join(','), '-ar', String(SR), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
  return `${name}.mp3`;
}

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let max = 1e-9;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round((samples[i] / max) * 0.95 * 32767), 44 + i * 2);
  writeFileSync(file, buf);
}

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

/**
 * Door-hinge creak, stick-slip model: the hinge pin sticks and slips in bursts;
 * each slip is an impulse into the door's body modes (a wooden/steel panel).
 * The slip rate follows the swing speed (a few ticks → a continuous squeal),
 * with friction jitter and stutters, which is what makes a creak sound real.
 */
function hingeCreak(file, { seconds, seed, f0, f1, shape, modes, stutter = 0.15, rough = 0.25 }) {
  const r = rng(seed);
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  // body modes: [freq Hz, decay s, gain]
  const st = modes.map(([f, d, g]) => ({ c: 2 * Math.exp(-1 / (d * SR)) * Math.cos(2 * Math.PI * f / SR), r2: Math.exp(-2 / (d * SR)), g, y1: 0, y2: 0 }));
  let phase = 0, press = 0.5, stutterT = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // swing speed profile → slip rate
    const env = shape(t);
    if (stutterT > 0) stutterT -= 1 / SR; else if (r() < stutter / SR * 6) stutterT = 0.02 + r() * 0.07;
    const rate = (f0 + (f1 - f0) * env) * (1 + (r() - 0.5) * rough) * (stutterT > 0 ? 0.25 : 1);
    press += ((0.5 + 0.5 * env) - press) * 0.0005 + (r() - 0.5) * 0.002;
    phase += rate / SR;
    let x = 0;
    if (phase >= 1) { phase -= 1; x = (0.6 + r() * 0.8) * press * Math.min(1, env * 3 + 0.05); }
    let y = 0;
    for (const m of st) { const v = m.c * m.y1 - m.r2 * m.y2 + x * m.g; m.y2 = m.y1; m.y1 = v; y += v; }
    const fade = Math.min(1, i / (0.01 * SR)) * Math.min(1, (n - i) / (0.05 * SR));
    out[i] = y * fade;
  }
  writeWav(file, out);
  return file;
}

// ── sources (pinned) ───────────────────────────────────────────────────────
const SOURCES = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url)));
for (const [rel, sha] of Object.entries(SOURCES)) {
  const p = join(SRC, rel);
  if (!existsSync(p)) throw new Error(`missing ${rel}`);
  const h = createHash('sha256').update(readFileSync(p)).digest('hex');
  if (h !== sha) throw new Error(`hash mismatch ${rel}`);
}
console.log(`sources verified: ${Object.keys(SOURCES).length} files`);

const RPG = 'kenney-rpg-audio', IMP = 'kenney-impact-sounds', FOL = 'kenney-foley-sounds', SCI = 'kenney-sci-fi-sounds';
const manifest = {};
const add = (key, file) => { (manifest[key] ??= []).push(file); };
const tmp = (n) => join(TMP, n);

// ── door hinge creaks (synth) ──────────────────────────────────────────────
const WOOD = [[190, 0.05, 1], [430, 0.04, 0.8], [880, 0.03, 0.6], [1650, 0.02, 0.45], [2900, 0.012, 0.3], [4300, 0.008, 0.15]];
const STEEL = [[310, 0.12, 0.7], [740, 0.09, 0.9], [1520, 0.07, 0.8], [2380, 0.05, 0.5], [3900, 0.03, 0.3]];
const swing = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 1.4);
const late = (t) => Math.pow(Math.sin(Math.PI * t), 0.8) * (0.4 + 0.6 * t);
hingeCreak(tmp('creakA.wav'), { seconds: 1.5, seed: 11, f0: 18, f1: 240, shape: swing, modes: WOOD });
hingeCreak(tmp('creakB.wav'), { seconds: 1.25, seed: 23, f0: 30, f1: 330, shape: late, modes: WOOD, stutter: 0.3 });
hingeCreak(tmp('creakC.wav'), { seconds: 1.7, seed: 37, f0: 12, f1: 180, shape: swing, modes: STEEL, rough: 0.35 });
hingeCreak(tmp('creakShort.wav'), { seconds: 0.55, seed: 41, f0: 40, f1: 260, shape: (t) => Math.sin(Math.PI * t), modes: WOOD });
hingeCreak(tmp('creakShort2.wav'), { seconds: 0.5, seed: 53, f0: 60, f1: 300, shape: (t) => Math.sin(Math.PI * t), modes: STEEL });

// ── doors ──────────────────────────────────────────────────────────────────
// open: handle latch, the slab moving, a long hinge creak with a little of the recorded creak under it
mix(tmp('do1.wav'), [
  { file: src(RPG, 'metalLatch.ogg'), gain: -4 },
  { file: tmp('creakA.wav'), at: 0.1, gain: -5, filters: 'highpass=f=240' },
  { file: src(RPG, 'doorOpen_1.ogg'), at: 0.06, gain: -6 },
  { file: src(RPG, 'creak2.ogg'), at: 0.35, gain: -9, filters: 'asetrate=44100*0.82,aresample=44100' },
], 'highpass=f=60,lowpass=f=9000');
add('doorOpen', finish(tmp('do1.wav'), 'door_open_1'));
mix(tmp('do2.wav'), [
  { file: src(RPG, 'metalLatch.ogg'), gain: -5, filters: 'asetrate=44100*0.9,aresample=44100' },
  { file: tmp('creakB.wav'), at: 0.12, gain: -4, filters: 'highpass=f=240' },
  { file: src(RPG, 'doorOpen_2.ogg'), at: 0.0, gain: -7 },
], 'highpass=f=60,lowpass=f=9000');
add('doorOpen', finish(tmp('do2.wav'), 'door_open_2'));
mix(tmp('do3.wav'), [
  { file: src(RPG, 'metalClick.ogg'), gain: 4 },
  { file: tmp('creakC.wav'), at: 0.08, gain: -4, filters: 'highpass=f=260' },
  { file: src(RPG, 'creak1.ogg'), at: 0.6, gain: -8, filters: 'asetrate=44100*0.75,aresample=44100' },
], 'highpass=f=60,lowpass=f=8500');
add('doorOpen', finish(tmp('do3.wav'), 'door_open_3'));
// close: a short creak as it swings, the slam, the latch catching
[['doorClose_1.ogg', 'creakShort.wav'], ['doorClose_3.ogg', 'creakShort2.wav'], ['doorClose_4.ogg', 'creakShort.wav']].forEach(([slam, cr], i) => {
  mix(tmp(`dc${i}.wav`), [
    { file: tmp(cr), gain: -7, filters: 'highpass=f=240' },
    { file: src(RPG, slam), at: 0.38, gain: 0 },
    { file: src(RPG, 'metalLatch.ogg'), at: 0.46, gain: -8 },
  ], 'highpass=f=50,lowpass=f=9000');
  add('doorClose', finish(tmp(`dc${i}.wav`), `door_close_${i + 1}`));
});

// ── footsteps per floor ────────────────────────────────────────────────────
for (let i = 0; i < 5; i++) {
  add('step:carpet', finish(src(IMP, `footstep_carpet_00${i}.ogg`), `step_carpet_${i}`, -2, 'highpass=f=70,lowpass=f=6000'));
  add('step:concrete', finish(src(IMP, `footstep_concrete_00${i}.ogg`), `step_concrete_${i}`, -2, 'highpass=f=60'));
  add('step:wood', finish(src(IMP, `footstep_wood_00${i}.ogg`), `step_wood_${i}`, -2, 'highpass=f=60'));
  // hard tile: the concrete takes, brighter and a touch higher
  add('step:tile', finish(src(IMP, `footstep_concrete_00${i}.ogg`), `step_tile_${i}`, -2, 'asetrate=44100*1.12,aresample=44100,highpass=f=180,treble=g=4:f=4000'));
}

// ── impacts, handling, machines ────────────────────────────────────────────
for (let i = 0; i < 3; i++) {
  mix(tmp(`hit${i}.wav`), [
    { file: src(IMP, `impactPunch_heavy_00${i}.ogg`) },
    { file: src(IMP, `impactSoft_heavy_00${i}.ogg`), gain: -4 },
  ], 'lowpass=f=7000');
  add('hit', finish(tmp(`hit${i}.wav`), `hit_${i + 1}`));
}
add('click', finish(src(RPG, 'metalClick.ogg'), 'click_1', -3, 'highpass=f=400'));
add('paper', finish(src(RPG, 'bookFlip1.ogg'), 'paper_1', -3));
add('paper', finish(src(RPG, 'bookFlip2.ogg'), 'paper_2', -3));
mix(tmp('pick1.wav'), [{ file: src(FOL, 'pickup1.ogg') }, { file: src(RPG, 'cloth1.ogg'), at: 0.05, gain: -6 }]);
add('pickup', finish(tmp('pick1.wav'), 'pickup_1', -3));
mix(tmp('pick2.wav'), [{ file: src(FOL, 'pickup2.ogg') }, { file: src(RPG, 'cloth2.ogg'), at: 0.03, gain: -6 }]);
add('pickup', finish(tmp('pick2.wav'), 'pickup_2', -3));
for (let i = 1; i <= 4; i++) add('drip', finish(src(FOL, `drip${i}.ogg`), `drip_${i}`, -2));
// relay / breaker: latch, then a heavy steel clunk
mix(tmp('relay.wav'), [
  { file: src(RPG, 'metalLatch.ogg'), gain: -2 },
  { file: src(IMP, 'impactMetal_heavy_001.ogg'), at: 0.07, gain: 0, filters: 'asetrate=44100*0.78,aresample=44100,lowpass=f=3500' },
]);
add('relay', finish(tmp('relay.wav'), 'relay_1'));
// cabin / wall bang
mix(tmp('bang.wav'), [
  { file: src(IMP, 'impactMetal_heavy_000.ogg'), filters: 'asetrate=44100*0.7,aresample=44100' },
  { file: src(FOL, 'platesHit1.ogg'), at: 0.02, gain: -6 },
  { file: src(IMP, 'impactPunch_heavy_001.ogg'), gain: -3, filters: 'asetrate=44100*0.8,aresample=44100' },
], 'lowpass=f=6000');
add('bang', finish(tmp('bang.wav'), 'bang_1'));
// knocking, heard through a door
mix(tmp('knock.wav'), [0, 0.3, 0.56].map((at, i) => ({ file: src(IMP, `impactWood_heavy_00${i}.ogg`), at, gain: i === 2 ? -2 : 0 })), 'lowpass=f=2400,aecho=0.6:0.5:60:0.25');
add('knock', finish(tmp('knock.wav'), 'knock_1'));
// distant thuds: something heavy, far off, through walls
[
  [['lowFrequency_explosion_000.ogg', SCI, 'asetrate=44100*0.7,aresample=44100'], ['impactWood_heavy_001.ogg', IMP, 'asetrate=44100*0.6,aresample=44100']],
  [['impactMetal_heavy_002.ogg', IMP, 'asetrate=44100*0.55,aresample=44100'], ['lowFrequency_explosion_001.ogg', SCI, 'asetrate=44100*0.8,aresample=44100']],
  [['impactPlate_heavy_000.ogg', IMP, 'asetrate=44100*0.5,aresample=44100'], ['impactWood_heavy_002.ogg', IMP, 'asetrate=44100*0.55,aresample=44100']],
].forEach((pair, i) => {
  mix(tmp(`far${i}.wav`), pair.map(([f, pack, filt], k) => ({ file: src(pack, f), gain: k ? -3 : 0, filters: filt, at: k * 0.04 })),
    'lowpass=f=420,aecho=0.8:0.7:110|240:0.35|0.2');
  add(`distant${i}`, finish(tmp(`far${i}.wav`), `distant_${i + 1}`));
});
// steel floor grates
for (let i = 0; i < 2; i++) {
  mix(tmp(`grate${i}.wav`), [
    { file: src(IMP, `footstep_concrete_00${i + 2}.ogg`), gain: -3 },
    { file: src(IMP, `impactMetal_light_00${i}.ogg`), gain: -2 },
    { file: src(IMP, `impactTin_medium_00${i}.ogg`), gain: -9 },
  ]);
  add(`grate${i}`, finish(tmp(`grate${i}.wav`), `grate_${i + 1}`, -2));
}
// service elevator door: steel sliding in its track, then the stop
mix(tmp('elev.wav'), [
  { file: src(FOL, 'stoneDrag1.ogg'), gain: -4, filters: 'highpass=f=250,asetrate=44100*1.25,aresample=44100' },
  { file: src(SCI, 'doorOpen_000.ogg'), gain: -10, filters: 'lowpass=f=3000' },
  { file: src(IMP, 'impactMetal_heavy_002.ogg'), at: 1.3, gain: -5, filters: 'lowpass=f=4000' },
]);
add('elevDoor', finish(tmp('elev.wav'), 'elevator_door_1'));
// power surge: a deep thump with electrical noise
mix(tmp('surge.wav'), [
  { file: src(SCI, 'lowFrequency_explosion_001.ogg'), gain: 0 },
  { file: src(SCI, 'computerNoise_000.ogg'), gain: -14, filters: 'atrim=0:0.9,afade=t=out:st=0.3:d=0.6' },
], 'lowpass=f=8000');
add('surge', finish(tmp('surge.wav'), 'surge_1'));

// the main creature's footfalls: a heavy body on the floor, a bare foot dragging after
for (let i = 0; i < 3; i++) {
  mix(tmp(`rstep${i}.wav`), [
    { file: src(IMP, `footstep_concrete_00${i + 1}.ogg`), filters: 'asetrate=44100*0.55,aresample=44100' },
    { file: src(IMP, `impactSoft_heavy_00${i}.ogg`), gain: -2, filters: 'asetrate=44100*0.7,aresample=44100' },
    ...(i % 2 ? [{ file: src(FOL, `stoneDrag${(i % 2) + 1}.ogg`), at: 0.09, gain: -14, filters: 'atrim=0:0.35,afade=t=out:st=0.15:d=0.2,lowpass=f=1800' }] : []),
  ], 'lowpass=f=2600');
  add(`rStep${i}`, finish(tmp(`rstep${i}.wav`), `creature_step_${i + 1}`));
}

writeFileSync(join(OUT, 'sfx.json'), JSON.stringify(manifest, null, 1));
if (!process.env.KEEP_TMP) rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${Object.values(manifest).flat().length} files, ${Object.keys(manifest).length} keys → ${OUT}`);
