import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  attachmentEntry,
  FilesArchiveError,
  mergeFiles,
  pruneFiles,
  readFilesArchive,
  writeFilesArchive,
  type FilesArchive,
} from './files-archive.js';
import { sha256 } from './sha256.js';
import { writeZip, type ZipCodec } from './zip.js';

/** D-190 Q8, Q11: `.flintfiles`, attachments by content hash, checked whole. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function archive(...files: [name: string, content: string, by?: string][]): FilesArchive {
  const index = new Map();
  const data = new Map();
  for (const [name, content, by = 'alex@example.com'] of files) {
    const { hash, entry } = attachmentEntry(name, bytes(content), by);
    index.set(hash, entry);
    data.set(hash, bytes(content));
  }
  return { index, data };
}

const problem = (zip: Uint8Array): string => {
  try {
    readFilesArchive(zip, codec);
  } catch (error) {
    if (error instanceof FilesArchiveError) return error.problem;
    throw error;
  }
  return 'none';
};

/** A zip with this index and these entries, as another member's Flint might send. */
const raw = (files: Record<string, unknown>, entries: [string, string][]): Uint8Array =>
  writeZip(
    [
      { name: 'index.json', data: bytes(JSON.stringify({ flint: 1, files })) },
      ...entries.map(([name, content]) => ({ name, data: bytes(content) })),
    ],
    codec,
  );

describe('.flintfiles (D-190 Q8, Q11)', () => {
  it('writes and reads back, each file by the hash of its bytes', () => {
    const files = archive(['20260310-ab12.png', 'png bytes'], ['20260310-cd34.pdf', 'pdf bytes']);
    const back = readFilesArchive(writeFilesArchive(files, codec), codec);
    expect(back.index).toEqual(files.index);
    expect(back.data).toEqual(files.data);
    expect([...back.index.keys()]).toContain(sha256(bytes('png bytes')));
  });

  it('two members adding at once merge as a union; the same either way round', () => {
    const alex = archive(['a.png', 'A']);
    const sam = archive(['b.png', 'B', 'sam@example.com'], ['a.png', 'A']);
    const one = mergeFiles(alex, sam);
    const other = mergeFiles(sam, alex);
    expect([...one.index.values()].map((entry) => entry.name).sort()).toEqual(['a.png', 'b.png']);
    expect(writeFilesArchive(one, codec)).toEqual(writeFilesArchive(other, codec));
  });

  it('an attachment no list links any more is dropped', () => {
    const files = archive(['a.png', 'A'], ['b.png', 'B']);
    const kept = pruneFiles(files, new Set(['b.png']));
    expect([...kept.index.values()].map((entry) => entry.name)).toEqual(['b.png']);
  });

  it('refuses bytes that don’t hash to their name, an index that doesn’t match, and missing files', () => {
    const real = sha256(bytes('A'));
    expect(problem(raw({ [real]: { name: 'a.png', size: 1, addedBy: 'x' } }, [[real, 'B']]))).toBe(
      'hash-mismatch',
    );
    expect(problem(raw({}, [[real, 'A']]))).toBe('missing');
    expect(problem(raw({ [real]: { name: 'a.png', size: 1, addedBy: 'x' } }, []))).toBe('missing');
    expect(problem(raw({ [real]: { name: 'a.png', size: 9, addedBy: 'x' } }, [[real, 'A']]))).toBe(
      'hash-mismatch',
    );
    expect(problem(writeZip([{ name: real, data: bytes('A') }], codec))).toBe('no-index');
    expect(problem(writeZip([{ name: 'index.json', data: bytes('nope') }], codec))).toBe(
      'bad-index',
    );
  });

  it('refuses names that aren’t plain attachment names, other entries, and two files of one name', () => {
    const a = sha256(bytes('A'));
    const b = sha256(bytes('B'));
    for (const name of ['../evil.exe', 'sub/a.png', '.hidden', 'CON.png', 'C:\\x.png', 'a.png '])
      expect([name, problem(raw({ [a]: { name, size: 1, addedBy: 'x' } }, [[a, 'A']]))]).toEqual([
        name,
        'bad-name',
      ]);
    expect(
      problem(
        raw({ [a]: { name: 'a.png', size: 1, addedBy: 'x' } }, [
          [a, 'A'],
          ['x.png', 'A'],
        ]),
      ),
    ).toBe('bad-name');
    expect(
      problem(
        raw(
          {
            [a]: { name: 'a.png', size: 1, addedBy: 'x' },
            [b]: { name: 'A.PNG', size: 1, addedBy: 'x' },
          },
          [
            [a, 'A'],
            [b, 'B'],
          ],
        ),
      ),
    ).toBe('name-clash');
  });

  it('never writes past 100 MB', () => {
    const big = new Uint8Array(101 * 1024 * 1024);
    // The size is refused before anything is hashed or packed: a stand-in hash will do.
    const { hash, entry } = attachmentEntry('big.bin', big, 'alex@example.com', () =>
      'f'.repeat(64),
    );
    expect(() =>
      writeFilesArchive({ index: new Map([[hash, entry]]), data: new Map([[hash, big]]) }, codec),
    ).toThrow(FilesArchiveError);
  });
});
