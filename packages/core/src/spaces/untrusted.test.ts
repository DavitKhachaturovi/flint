import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  attachmentEntry,
  FilesArchiveError,
  pruneFiles,
  readFilesArchive,
} from './files-archive.js';
import { sha256 } from './sha256.js';
import { readSpaceArchive, SpaceArchiveError } from './space-archive.js';
import { isSafeAttachmentName, isSafeFileName, isSafeLabel } from './untrusted-names.js';
import { crc32, readZip, writeZip, ZipError, type ZipCodec } from './zip.js';

/** D-190 Q11's review round: each finding, as the content another member's Flint could send. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const space = '{"flint":1,"id":"s-home1","name":"Home"}';
const problemOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (
      error instanceof ZipError ||
      error instanceof SpaceArchiveError ||
      error instanceof FilesArchiveError
    )
      return error.problem;
    throw error;
  }
  return 'none';
};

/** A zip whose central entries all point at one padded deflate body (the review's H1). */
function sharedPaddedBody(entries: number, padding: number): Uint8Array {
  // Empty stored deflate blocks (`00 00 00 FF FF`) padding, then a final block giving `x`.
  const pad = new Uint8Array(padding * 5);
  for (let at = 0; at < pad.length; at += 5) pad.set([0x00, 0x00, 0x00, 0xff, 0xff], at);
  const body = new Uint8Array([...pad, 0x01, 0x01, 0x00, 0xfe, 0xff, 0x78]);
  const crc = crc32(bytes('x'));
  const name = bytes('0.md');
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, body.length, true);
  lv.setUint32(22, 1, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const centrals: Uint8Array[] = [];
  for (let n = 0; n < entries; n++) {
    const entryName = bytes(`${n}.md`);
    const header = new Uint8Array(46 + entryName.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, 1, true);
    cv.setUint16(28, entryName.length, true);
    cv.setUint32(42, 0, true);
    header.set(entryName, 46);
    centrals.push(header);
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries, true);
  ev.setUint16(10, entries, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, local.length + body.length, true);
  const parts = [local, body, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('the Q11 review round’s findings (D-190 Q11)', () => {
  it('H1: entries sharing one padded body are refused at once, never unpacked over and over', () => {
    let unpacked = 0;
    const counting: ZipCodec = {
      inflate: (data, size) => {
        unpacked++;
        return codec.inflate(data, size);
      },
    };
    const zip = sharedPaddedBody(1000, 20_000);
    expect(problemOf(() => readZip(zip, counting, { maxEntries: 10_000, maxTotal: 1e9 }))).toBe(
      'corrupt',
    );
    expect(unpacked).toBe(0);
    // Two entries sharing an unpadded body: overlapping, refused too.
    const twice = writeZip([{ name: 'a.md', data: bytes('hello') }], {});
    const central = twice.length - 22 - (46 + 4);
    const copy = new Uint8Array([
      ...twice.subarray(0, twice.length - 22),
      ...twice.subarray(central, central + 46 + 4),
      ...twice.subarray(twice.length - 22),
    ]);
    copy.set(bytes('b.md'), copy.length - 22 - 4);
    const view = new DataView(copy.buffer);
    view.setUint16(copy.length - 22 + 8, 2, true);
    view.setUint16(copy.length - 22 + 10, 2, true);
    view.setUint32(copy.length - 22 + 12, 2 * (46 + 4), true);
    expect(problemOf(() => readZip(copy, codec, { maxEntries: 10, maxTotal: 1000 }))).toBe(
      'corrupt',
    );
  });

  it('L2: a local header naming another entry than the directory does is refused', () => {
    const zip = writeZip([{ name: 'a.md', data: bytes('hello') }], {});
    zip.set(bytes('b'), 30);
    expect(problemOf(() => readZip(zip, codec, { maxEntries: 10, maxTotal: 1000 }))).toBe(
      'corrupt',
    );
  });

  it('M1: 8.3 short-name aliases are refused (they are another file’s second name)', () => {
    for (const name of ['GROCER~1.md', 'groce~12.md', '202603~1.png', '~1.md'])
      expect([name, isSafeFileName(name)]).toEqual([name, false]);
    expect(isSafeFileName('Groceries list.md')).toBe(true);
    expect(isSafeFileName('Plans ~ maybe.md')).toBe(true);
    const zip = writeZip(
      [
        { name: 'space.json', data: bytes(space) },
        { name: 'Groceries list.md', data: bytes('x') },
        { name: 'GROCER~1.md', data: bytes('y') },
      ],
      codec,
    );
    expect(problemOf(() => readSpaceArchive(zip, codec))).toBe('bad-name');
  });

  it('M2: names NTFS sees as one (the Greek final sigma too) are a clash', () => {
    const zip = writeZip(
      [
        { name: 'space.json', data: bytes(space) },
        { name: 'ΟΔΟΣ.md', data: bytes('x') },
        { name: 'οδοσ.md', data: bytes('y') },
      ],
      codec,
    );
    expect(problemOf(() => readSpaceArchive(zip, codec))).toBe('name-clash');
  });

  it('M3: attachments Flint never attaches or Explorer reads by showing a folder are refused, and names that read as something else', () => {
    for (const name of [
      'evil.library-ms',
      'x.searchConnector-ms',
      'x.search-ms',
      'site.url',
      'site.website',
      'go.lnk',
      'run.exe',
      'a.hta',
      'desktop.ini',
      'Desktop.INI',
      'invoice‮gnp.exe',
      'pic​.png',
      'a／b.png',
      'a：b.png',
      'CONIN$.png',
      'COM0.png',
      'nul .png',
    ])
      expect([name, isSafeAttachmentName(name)]).toEqual([name, false]);
    for (const name of ['20260310-ab12.png', 'report.pdf', 'notes.txt', 'clip.mp4'])
      expect([name, isSafeAttachmentName(name)]).toEqual([name, true]);
  });

  it('L6: who added an attachment is plain text', () => {
    expect(isSafeLabel('Sam <sam@example.com>')).toBe(true);
    expect(isSafeLabel('Sam‮')).toBe(false);
    expect(isSafeLabel('Sam\n')).toBe(false);
    const hash = sha256(bytes('A'));
    const zip = writeZip(
      [
        {
          name: 'index.json',
          data: bytes(
            JSON.stringify({
              flint: 1,
              files: { [hash]: { name: 'a.png', size: 1, addedBy: 'Sam‮moc.elpmaxe' } },
            }),
          ),
        },
        { name: hash, data: bytes('A') },
      ],
      codec,
    );
    expect(problemOf(() => readFilesArchive(zip, codec))).toBe('bad-index');
  });

  it('L5: an attachment linked in another case is kept by pruning', () => {
    const { hash, entry } = attachmentEntry('Photo.PNG', bytes('A'), 'alex@example.com');
    const kept = pruneFiles(
      { index: new Map([[hash, entry]]), data: new Map([[hash, bytes('A')]]) },
      new Set(['photo.png']),
    );
    expect(kept.index.size).toBe(1);
  });

  it('20 MB of text is refused before anything is unpacked', () => {
    let unpacked = 0;
    const counting: ZipCodec = {
      inflate: (data, size) => {
        unpacked++;
        return codec.inflate(data, size);
      },
    };
    const big = writeZip(
      [
        { name: 'space.json', data: bytes(space) },
        { name: 'a.md', data: new Uint8Array(21 * 1024 * 1024).fill(0x61) },
      ],
      codec,
    );
    expect(problemOf(() => readSpaceArchive(big, counting))).toBe('too-big');
    expect(unpacked).toBe(0);
  });
});
