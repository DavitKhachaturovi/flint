import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crc32, zipFolder } from './zip.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-zip-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Reads a zip back through its central directory: name → contents. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const body = zip.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

describe('export as zip (DATA-05, D-97)', () => {
  it('has every file under a Flint folder, the structure and UTF-8 names kept, .git skipped', async () => {
    const folder = join(base, 'Flint');
    await mkdir(join(folder, 'attachments'), { recursive: true });
    await mkdir(join(folder, '.flint', 'trash'), { recursive: true });
    await mkdir(join(folder, '.git'), { recursive: true });
    await writeFile(join(folder, 'Inbox.md'), '- [ ] one\n'.repeat(200));
    await writeFile(join(folder, 'შენიშვნა.md'), 'Georgian name');
    await writeFile(join(folder, 'attachments', 'shot.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(folder, '.flint', 'trash', 'x.md'), 'deleted');
    await writeFile(join(folder, '.git', 'HEAD'), 'ref');
    const out = join(base, 'Flint-2026-11-04.zip');
    expect(await zipFolder(folder, out)).toBe(4);
    const files = unzip(await readFile(out));
    expect([...files.keys()].sort()).toEqual([
      'Flint/.flint/trash/x.md',
      'Flint/Inbox.md',
      'Flint/attachments/shot.png',
      'Flint/შენიშვნა.md',
    ]);
    expect(files.get('Flint/Inbox.md')?.toString()).toBe('- [ ] one\n'.repeat(200));
    expect([...(files.get('Flint/attachments/shot.png') ?? [])]).toEqual([1, 2, 3]);
  });

  it('checksums like everyone else (CRC-32)', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});
