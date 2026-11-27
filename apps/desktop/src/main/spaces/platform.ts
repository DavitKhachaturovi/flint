/**
 * D-190 Q8, Q11: what core's space files need from the platform, the desktop's way: Node's zlib
 * for the archives (inflate stops at the declared size, so no zip bomb unpacks past it), Node's
 * SHA-256 for attachments (core's pure one takes seconds on 100 MB), and Mark-of-the-Web on every
 * attachment written from a space (`Zone.Identifier`, ZoneId=3: Windows then treats it as coming
 * from the internet, as a download).
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ZipCodec } from '@flint/core/spaces';

export const spaceCodec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  // Never more than `size` bytes out (Node refuses a limit of 0, so 1; core checks the size).
  inflate: (data, size) =>
    new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, size) })),
};

export const spaceHash = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Marks a file written from a space as downloaded from the internet (Mark-of-the-Web). */
export async function markFromWeb(path: string, from = 'Flint space'): Promise<void> {
  try {
    await writeFile(
      `${path}:Zone.Identifier`,
      `[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=${from.replace(/[\r\n]/g, ' ')}\r\n`,
    );
  } catch {
    // Not NTFS (a FAT drive, a network share without streams): Windows can't mark it there.
  }
}
