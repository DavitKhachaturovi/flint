import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { sha256 } from '@flint/core/spaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markFromWeb, spaceCodec, spaceHash } from './platform.js';

/** D-190 Q8, Q11: the desktop's codec, hash and Mark-of-the-Web for space files. */
let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'flint-space-platform-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the platform for space files (D-190 Q8, Q11)', () => {
  it('inflate stops at the declared size: a bomb is refused, never unpacked in full', () => {
    const big = deflateRawSync(new Uint8Array(50_000_000));
    expect(() => spaceCodec.inflate(new Uint8Array(big), 1000)).toThrow();
    const small = new TextEncoder().encode('hello');
    const packed = spaceCodec.deflate?.(small) ?? new Uint8Array();
    expect(spaceCodec.inflate(packed, small.length)).toEqual(small);
  });

  it('the hash is SHA-256, as core’s', () => {
    const data = new TextEncoder().encode('a picture');
    expect(spaceHash(data)).toBe(sha256(data));
  });

  it.runIf(process.platform === 'win32')(
    'an attachment written from a space is marked as from the internet (Mark-of-the-Web)',
    async () => {
      const path = join(folder, 'picture.png');
      await writeFile(path, 'png');
      await markFromWeb(path);
      expect(await readFile(`${path}:Zone.Identifier`, 'utf8')).toContain('ZoneId=3');
    },
  );
});
