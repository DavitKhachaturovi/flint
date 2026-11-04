import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

/**
 * DATA-05, D-97: the Flint folder as one zip file (Export Flint folder…). Written by Flint itself
 * (Node's deflate, no dependency): each file compressed, UTF-8 names, the folder's structure kept.
 * Skips what snapshots skip (temp files, `.git`). Written to a temporary name first, then renamed,
 * so a half-written zip never takes the chosen name.
 */

const SKIPPED = new Set(['.tmp', 'node_modules', '.git']);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as zip files store them (local time, 2-second steps). */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date:
      ((Math.max(1980, at.getFullYear()) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

async function filesIn(folder: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (at: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    for (const item of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      const path = join(at, item.name);
      if (item.isDirectory()) {
        if (!SKIPPED.has(item.name)) await walk(path, depth + 1);
      } else if (item.isFile() && !item.name.endsWith('.tmp')) files.push(path);
    }
  };
  await walk(folder, 0);
  return files.sort();
}

/** Zips `folder` into `out`, its files under a top folder named `root`; how many files. */
export async function zipFolder(folder: string, out: string, root = 'Flint'): Promise<number> {
  const temp = `${out}.part`;
  const handle = await open(temp, 'w');
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  try {
    for (const path of await filesIn(folder)) {
      const data = await readFile(path).catch(() => null);
      const info = await stat(path).catch(() => null);
      if (!data || !info) continue;
      const name = Buffer.from(`${root}/${relative(folder, path).split(sep).join('/')}`, 'utf8');
      const packed = deflateRawSync(data);
      const stored = packed.length >= data.length;
      const body = stored ? data : packed;
      const crc = crc32(data);
      const { time, date } = dosTime(info.mtime);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(stored ? 0 : 8, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await handle.write(local);
      await handle.write(name);
      await handle.write(body);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(stored ? 0 : 8, 10);
      entry.writeUInt16LE(time, 12);
      entry.writeUInt16LE(date, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(body.length, 20);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt16LE(name.length, 28);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, name);
      offset += local.length + name.length + body.length;
      count++;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    await handle.write(directory);
    await handle.write(end);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  await rename(temp, out);
  return count;
}
