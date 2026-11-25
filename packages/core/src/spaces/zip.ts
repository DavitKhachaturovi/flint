/**
 * D-190 Q8, Q11 (docs/04 §9): the zip container of a space's files, in core so the phone can share
 * it. No compression code here: `deflate`/`inflate` are passed in (Node's zlib on the desktop).
 * Reading is defensive, as the bytes come from other people's Flint: limits on the number of
 * entries and the total size are checked against the central directory before anything is
 * unpacked; every entry must inflate to exactly its declared size (no zip bombs) and match its
 * CRC; encrypted, Zip64, split and duplicate entries are refused. What the names may be is the
 * caller's check (`space-archive.ts`).
 */
import { decodeUtf8, encodeUtf8 } from '../sync/utf8.js';

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Raw deflate; `inflate` must refuse (throw) output past `size`. */
export interface ZipCodec {
  readonly deflate?: (data: Uint8Array) => Uint8Array;
  readonly inflate: (data: Uint8Array, size: number) => Uint8Array;
}

export interface ZipLimits {
  readonly maxEntries: number;
  /** The unpacked size of every entry together. */
  readonly maxTotal: number;
}

export type ZipProblem =
  'not-zip' | 'too-many' | 'too-big' | 'unsupported' | 'corrupt' | 'duplicate' | 'bad-name';

export class ZipError extends Error {
  readonly problem: ZipProblem;

  constructor(problem: ZipProblem, message: string = problem) {
    super(message);
    this.name = 'ZipError';
    this.problem = problem;
  }
}

/** UTF-8 that must be valid: decoded, then checked by encoding it back. Throws on bad bytes. */
export function strictUtf8(bytes: Uint8Array): string {
  const text = decodeUtf8(bytes);
  const back = encodeUtf8(text);
  if (back.length !== bytes.length || back.some((byte, index) => byte !== bytes[index]))
    throw new Error('not UTF-8');
  return text;
}

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

/** A zip of these entries, each deflated when that is smaller (stored otherwise). */
export function writeZip(
  entries: readonly ZipEntry[],
  codec: Pick<ZipCodec, 'deflate'>,
): Uint8Array {
  if (entries.length >= 0xffff) throw new ZipError('too-many');
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encodeUtf8(entry.name);
    const packed = codec.deflate?.(entry.data);
    const deflated = packed !== undefined && packed.length < entry.data.length;
    const body = deflated ? packed : entry.data;
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, deflated ? 8 : 0, true);
    view.setUint16(10, 0, true); // time and date: none (the content is what matters)
    view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, deflated ? 8 : 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    header.set(name, 46);
    parts.push(local, body);
    central.push(header);
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The entries of a zip, checked as above. Throws `ZipError`. */
export function readZip(bytes: Uint8Array, codec: ZipCodec, limits: ZipLimits): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record: at the end, after a comment of at most 64 KB.
  let endAt = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      endAt = at;
      break;
    }
  }
  if (endAt < 0) throw new ZipError('not-zip');
  const disk = view.getUint16(endAt + 4, true);
  const count = view.getUint16(endAt + 10, true);
  const centralSize = view.getUint32(endAt + 12, true);
  const centralAt = view.getUint32(endAt + 16, true);
  if (disk !== 0 || count === 0xffff || centralAt === 0xffffffff)
    throw new ZipError('unsupported', 'split or Zip64 archives aren’t read');
  if (count > limits.maxEntries) throw new ZipError('too-many');
  if (centralAt + centralSize > endAt) throw new ZipError('corrupt');
  interface Header {
    name: string;
    method: number;
    crc: number;
    packed: number;
    size: number;
    localAt: number;
  }
  const headers: Header[] = [];
  const names = new Set<string>();
  let total = 0;
  let at = centralAt;
  const centralEnd = centralAt + centralSize;
  for (let index = 0; index < count; index++) {
    if (at + 46 > centralEnd || view.getUint32(at, true) !== 0x02014b50)
      throw new ZipError('corrupt');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (flags & 0x0001) throw new ZipError('unsupported', 'encrypted entries aren’t read');
    if (method !== 0 && method !== 8) throw new ZipError('unsupported');
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    if (packed === 0xffffffff || size === 0xffffffff) throw new ZipError('unsupported');
    // A deflated entry is never larger than what it holds (Flint stores it otherwise): padding
    // can't make unpacking slow (the Q11 review's H1).
    if (method === 8 && packed > size) throw new ZipError('corrupt', 'a padded entry');
    if (at + 46 + nameLength + extraLength + commentLength > centralEnd)
      throw new ZipError('corrupt');
    let name: string;
    try {
      name = strictUtf8(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new ZipError('bad-name');
    }
    if (names.has(name)) throw new ZipError('duplicate', name);
    names.add(name);
    total += size;
    if (total > limits.maxTotal) throw new ZipError('too-big');
    headers.push({
      name,
      method,
      crc: view.getUint32(at + 16, true),
      packed,
      size,
      localAt: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  // Each entry's bytes its own: no two entries share or overlap (one body unpacked many times).
  const ranges: [number, number][] = [];
  for (const header of headers) {
    const local = header.localAt;
    if (local + 30 > centralAt || view.getUint32(local, true) !== 0x04034b50)
      throw new ZipError('corrupt');
    const localName = view.getUint16(local + 26, true);
    const start = local + 30 + localName + view.getUint16(local + 28, true);
    if (start + header.packed > centralAt) throw new ZipError('corrupt');
    // The local header names the same entry as the directory (tools may read either).
    let named: string;
    try {
      named = strictUtf8(bytes.subarray(local + 30, local + 30 + localName));
    } catch {
      throw new ZipError('corrupt');
    }
    if (named !== header.name) throw new ZipError('corrupt', 'headers disagree');
    ranges.push([local, start + header.packed]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ranges.length; index++)
    if ((ranges[index]?.[0] ?? 0) < (ranges[index - 1]?.[1] ?? 0))
      throw new ZipError('corrupt', 'overlapping entries');
  return headers.map((header) => {
    const local = header.localAt;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + header.packed);
    let data: Uint8Array;
    if (header.method === 0) {
      if (header.packed !== header.size) throw new ZipError('corrupt');
      data = body.slice();
    } else {
      try {
        data = codec.inflate(body, header.size);
      } catch {
        throw new ZipError('corrupt', `${header.name} didn’t unpack to its size`);
      }
    }
    if (data.length !== header.size || crc32(data) !== header.crc)
      throw new ZipError('corrupt', `${header.name} isn’t what its header says`);
    return { name: header.name, data };
  });
}
