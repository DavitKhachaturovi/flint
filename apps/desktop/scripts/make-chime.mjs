// REM-06, D-94, D-95, D-96: a one-off tool, never run by the build, the tests or CI. It is how
// "Nudge" was made: two soft rounded taps on one pitch (G5), each settling slightly downward, the
// second quieter, with a short room tail; about half a second, stereo 44.1 kHz 16-bit, deterministic.
// The bundled sound, src/renderer/main-window/sounds/chime.wav, is Davit's file and the source of
// truth (D-96): this tool writes only to the path it is given and refuses to write over that file.
// Run: node scripts/make-chime.mjs <out.wav> [nudge|drop|mallet]
// FOCUS-05, D-170: Drop (two rising droplets) and Mallet (two soft wooden notes), D-95's runners-up,
// remade here for Focus's alarm choice (the originals were kept outside the repo); Nudge by default.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const bundled = resolve(import.meta.dirname, '../src/renderer/main-window/sounds/chime.wav');
const target = process.argv[2] ? resolve(process.argv[2]) : null;
const sound = process.argv[3] ?? 'nudge';
if (!['nudge', 'drop', 'mallet'].includes(sound)) {
  console.error(`unknown sound ${sound}: nudge, drop or mallet`);
  process.exit(1);
}
if (!target) {
  console.error('usage: node scripts/make-chime.mjs <out.wav> [nudge|drop|mallet]');
  process.exit(1);
}
if (target.toLowerCase() === bundled.toLowerCase()) {
  console.error(
    `refusing to write over the bundled chime (${bundled}); it is the source of truth (D-96)`,
  );
  process.exit(1);
}

const RATE = 44_100;
const TAU = 2 * Math.PI;
const SECONDS = 0.55;
/** The loudest 100 ms sits where the first chime's did (about −13.9 dB), so the volume doesn't jump. */
const LOUDNESS = 0.04057717400386579;
const WET = 0.1; // how much room
const RT60 = 0.4; // how long the room rings, in seconds

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

/** A small seeded PRNG (mulberry32), so the room is the same on every run. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised-cosine attack: rounder than a linear ramp, still click-free. */
const rise = (t, a) => (t >= a ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * t) / a));

/** One tap: a sine that starts a little sharp and settles onto its pitch, with a faint octave. */
function tap(buf, start, f, { gain = 1, decay }) {
  const bend = 0.22;
  const bendTime = 0.01;
  const harmonic = 0.18;
  const from = Math.round(start * RATE);
  const len = Math.min(buf.length - from, Math.round(decay * 9 * RATE));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    phase += (TAU * f * (1 + bend * Math.exp(-t / bendTime))) / RATE;
    const env = rise(t, 0.002) * Math.exp(-t / decay);
    buf[from + i] +=
      gain * env * (Math.sin(phase) + harmonic * Math.sin(2 * phase) * Math.exp(-t / (decay / 2)));
  }
}

/** Drop: a droplet, a sine gliding quickly up onto its pitch, with a soft round body. */
function droplet(buf, start, f, { gain = 1, decay }) {
  const from = Math.round(start * RATE);
  const len = Math.min(buf.length - from, Math.round(decay * 9 * RATE));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    // From about a fifth below up onto the note in ~45 ms.
    phase += (TAU * f * (0.66 + 0.34 * (1 - Math.exp(-t / 0.015)))) / RATE;
    const env = rise(t, 0.003) * Math.exp(-t / decay);
    buf[from + i] += gain * env * Math.sin(phase);
  }
}

/** Mallet: a soft wooden note, a sine with a quickly fading inharmonic partial (a struck bar). */
function mallet(buf, start, f, { gain = 1, decay }) {
  const from = Math.round(start * RATE);
  const len = Math.min(buf.length - from, Math.round(decay * 9 * RATE));
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = rise(t, 0.0025) * Math.exp(-t / decay);
    const knock = 0.35 * Math.exp(-t / (decay / 4)) * Math.sin(TAU * f * 3.93 * t);
    buf[from + i] += gain * env * (Math.sin(TAU * f * t) + knock);
  }
}

// ---- the room: convolution with a seeded noise tail that darkens as it fades ----
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let s = 0; s < n; s += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = s + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function impulse(seed) {
  const random = seeded(seed);
  const pre = Math.round(0.012 * RATE);
  const len = Math.round(RT60 * 1.1 * RATE);
  const ir = new Float64Array(pre + len);
  let lp = 0;
  let energy = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const k = 0.55 - 0.4 * Math.min(1, t / RT60);
    lp += k * (random() * 2 - 1 - lp);
    const v = lp * Math.exp((-6.91 * t) / RT60) * rise(t, 0.004);
    ir[pre + i] = v;
    energy += v * v;
  }
  const norm = 1 / Math.sqrt(energy);
  for (let i = 0; i < ir.length; i++) ir[i] *= norm;
  return ir;
}

function convolve(x, h) {
  let n = 1;
  while (n < x.length + h.length) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(x);
  br.set(h);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return ar.subarray(0, x.length);
}

/** The loudest 100 ms (mean power over both channels): short sounds need a short window. */
function loudest(channels) {
  const win = Math.round(0.1 * RATE);
  const power = (i) => channels.reduce((s, c) => s + c[i] * c[i], 0) / channels.length;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < channels[0].length; i++) {
    sum += power(i);
    if (i >= win) sum -= power(i - win);
    best = Math.max(best, sum / Math.min(win, i + 1));
  }
  return best;
}

// ---- the sound ----
const n = Math.round(SECONDS * RATE);
const dry = new Float64Array(n);
if (sound === 'drop') {
  droplet(dry, 0, midi(76), { decay: 0.06 });
  droplet(dry, 0.14, midi(81), { decay: 0.07, gain: 0.85 });
} else if (sound === 'mallet') {
  mallet(dry, 0, midi(72), { decay: 0.07 });
  mallet(dry, 0.15, midi(76), { decay: 0.08, gain: 0.8 });
} else {
  tap(dry, 0, midi(79), { decay: 0.055 });
  tap(dry, 0.125, midi(79), { decay: 0.06, gain: 0.8 });
}
const wetLeft = convolve(dry, impulse(11));
const wetRight = convolve(dry, impulse(23));
const left = new Float64Array(n);
const right = new Float64Array(n);
for (let i = 0; i < n; i++) {
  left[i] = dry[i] + WET * wetLeft[i];
  right[i] = dry[i] + WET * wetRight[i];
}
// The last 60 ms fade to silence, so it never ends with a click.
const tail = Math.round(0.06 * RATE);
for (let i = n - tail; i < n; i++) {
  const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - tail))) / tail);
  left[i] *= g;
  right[i] *= g;
}
let gain = Math.sqrt(LOUDNESS / loudest([left, right]));
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const ceiling = 10 ** (-1 / 20); // never above −1 dBFS
if (peak * gain > ceiling) gain = ceiling / peak;

const pcm = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32_767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32_767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(2, 22); // stereo
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = target;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${header.length + pcm.length} bytes)`);
