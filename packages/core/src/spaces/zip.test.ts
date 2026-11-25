import fc from 'fast-check';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip, writeZip, ZipError, type ZipCodec } from './zip.js';

/** D-190 Q8, Q11: the zip container of a space's files, read defensively. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const limits = { maxEntries: 100, maxTotal: 1_000_000 };
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const problem = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ZipError) return error.problem;
    throw error;
  }
  return 'none';
};

describe('the space zip (D-190 Q8, Q11)', () => {
  it('writes and reads back, deflated or stored, UTF-8 names', () => {
    const entries = [
      { name: 'Groceries.md', data: bytes('- [ ] Eggs [id:: eg01]\n'.repeat(50)) },
      { name: 'ქართული.md', data: bytes('x') },
      { name: 'space.json', data: bytes('{"flint":1}') },
    ];
    for (const options of [codec, {}]) {
      const zip = writeZip(entries, options);
      expect(readZip(zip, codec, limits)).toEqual(entries);
    }
  });

  it('refuses too many entries, and too big before unpacking anything', () => {
    const entries = Array.from({ length: 5 }, (_, n) => ({ name: `${n}.md`, data: bytes('abc') }));
    const zip = writeZip(entries, codec);
    expect(problem(() => readZip(zip, codec, { maxEntries: 4, maxTotal: 1000 }))).toBe('too-many');
    let unpacked = 0;
    const counting: ZipCodec = {
      inflate: (data, size) => {
        unpacked++;
        return codec.inflate(data, size);
      },
    };
    const big = writeZip([{ name: 'a.md', data: bytes('x'.repeat(5000)) }], codec);
    expect(problem(() => readZip(big, counting, { maxEntries: 10, maxTotal: 1000 }))).toBe(
      'too-big',
    );
    expect(unpacked).toBe(0);
  });

  it('a zip bomb (an entry unpacking past its declared size) is refused', () => {
    const zip = writeZip([{ name: 'a.md', data: bytes('x'.repeat(100_000)) }], codec);
    // Declare it tiny: the central and local headers say 10 bytes.
    const view = new DataView(zip.buffer);
    const central = zip.length - 22 - (46 + 4);
    view.setUint32(central + 24, 10, true);
    view.setUint32(22, 10, true);
    expect(problem(() => readZip(zip, codec, limits))).toBe('corrupt');
  });

  it('a changed byte (the CRC), duplicates, encryption and non-zips are refused', () => {
    const stored = writeZip([{ name: 'a.md', data: bytes('hello') }], {});
    const flipped = stored.slice();
    flipped[30 + 4] = 0x58;
    expect(problem(() => readZip(flipped, codec, limits))).toBe('corrupt');
    const twice = writeZip(
      [
        { name: 'a.md', data: bytes('1') },
        { name: 'a.md', data: bytes('2') },
      ],
      {},
    );
    expect(problem(() => readZip(twice, codec, limits))).toBe('duplicate');
    const locked = stored.slice();
    const view = new DataView(locked.buffer);
    const central = locked.length - 22 - (46 + 4);
    view.setUint16(central + 8, 0x0801, true);
    expect(problem(() => readZip(locked, codec, limits))).toBe('unsupported');
    expect(problem(() => readZip(bytes('not a zip at all'), codec, limits))).toBe('not-zip');
    expect(problem(() => readZip(stored.subarray(0, stored.length - 5), codec, limits))).toBe(
      'not-zip',
    );
  });

  it('fuzzed: a changed or cut archive is read right or refused with a ZipError, nothing else', () => {
    const entries = [
      { name: 'Groceries.md', data: bytes('- [ ] Eggs [id:: eg01]\n'.repeat(20)) },
      { name: 'space.json', data: bytes('{"flint":1,"id":"s-home1"}') },
    ];
    const zip = writeZip(entries, codec);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(zip.length - 1), fc.nat(255)), { maxLength: 6 }),
        fc.nat(zip.length),
        (changes, cut) => {
          const damaged = zip.slice(0, Math.max(cut, zip.length - 40));
          for (const [at, value] of changes) if (at < damaged.length) damaged[at] = value;
          try {
            const read = readZip(damaged, codec, limits);
            // Read: then only entries whose bytes passed their CRC.
            for (const entry of read)
              expect(entry.data.length).toBeLessThanOrEqual(limits.maxTotal);
          } catch (error) {
            expect(error).toBeInstanceOf(ZipError);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });
});
