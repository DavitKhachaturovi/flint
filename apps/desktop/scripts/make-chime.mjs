// REM-06, D-94: writes Flint's reminder chime (src/renderer/main-window/sounds/chime.wav), made
// here rather than taken from anywhere: two soft bell tones, a fifth apart, fading out.
// Run: node scripts/make-chime.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const rate = 22_050;
const seconds = 1.1;
const samples = Math.round(rate * seconds);
const tones = [
  { start: 0, frequency: 1046.5, gain: 0.32 }, // C6
  { start: 0.14, frequency: 1568.0, gain: 0.26 }, // G6
];
const data = new Float32Array(samples);
for (const tone of tones) {
  const from = Math.round(tone.start * rate);
  for (let at = from; at < samples; at++) {
    const t = (at - from) / rate;
    // A 6 ms attack, then a bell-like fade; a quiet octave above for some shimmer.
    const envelope = Math.min(1, t / 0.006) * Math.exp(-t / 0.28);
    const wave =
      Math.sin(2 * Math.PI * tone.frequency * t) +
      0.18 * Math.sin(2 * Math.PI * tone.frequency * 2 * t) * Math.exp(-t / 0.12);
    data[at] += tone.gain * envelope * wave;
  }
}
// The last 40 ms fade to silence, so it never ends with a click.
const tail = Math.round(0.04 * rate);
for (let at = samples - tail; at < samples; at++) data[at] *= (samples - at) / tail;

const pcm = Buffer.alloc(samples * 2);
for (let at = 0; at < samples; at++) {
  const value = Math.max(-1, Math.min(1, data[at]));
  pcm.writeInt16LE(Math.round(value * 32_767), at * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = join(import.meta.dirname, '../src/renderer/main-window/sounds/chime.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${header.length + pcm.length} bytes)`);
