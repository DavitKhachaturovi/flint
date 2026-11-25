import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256.js';

/** Core's SHA-256 against the standard's test vectors and Node's own. */
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('sha256 (D-190 Q8)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256(text(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256(text('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches Node’s for any bytes, across block boundaries', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (data) => {
        expect(sha256(data)).toBe(createHash('sha256').update(data).digest('hex'));
      }),
      { numRuns: 2000 },
    );
  });
});
