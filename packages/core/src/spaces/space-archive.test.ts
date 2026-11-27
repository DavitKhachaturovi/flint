import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  readSpaceArchive,
  SpaceArchiveError,
  writeSpaceArchive,
  type SpaceArchive,
} from './space-archive.js';
import { writeZip, type ZipCodec } from './zip.js';

/** D-190 Q8, Q11: `.flintspace`, checked whole before anything is written. */
const codec: ZipCodec = {
  deflate: (data) => new Uint8Array(deflateRawSync(data)),
  inflate: (data, size) => new Uint8Array(inflateRawSync(data, { maxOutputLength: size })),
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const space = '{"flint":1,"id":"s-home1","name":"Home"}';
const problem = (zip: Uint8Array): string => {
  try {
    readSpaceArchive(zip, codec);
  } catch (error) {
    if (error instanceof SpaceArchiveError) return error.problem;
    throw error;
  }
  return 'none';
};
const archiveWith = (...names: string[]): Uint8Array =>
  writeZip(
    [
      { name: 'space.json', data: bytes(space) },
      ...names.map((name) => ({ name, data: bytes('x') })),
    ],
    codec,
  );

describe('.flintspace (D-190 Q8, Q11)', () => {
  it('writes and reads back: bookkeeping and lists', () => {
    const archive: SpaceArchive = {
      lists: new Map([
        ['Groceries', '---\nflint: 1\nid: gro1\nmode: tasks\n---\n- [ ] Eggs [id:: eg01]\n'],
        ['Flat repairs', '---\nflint: 1\nid: fla1\nmode: note\n---\n# Leaks\n'],
      ]),
      meta: new Map([
        ['space.json', space],
        ['items.json', '{}'],
      ]),
    };
    const back = readSpaceArchive(writeSpaceArchive(archive, codec), codec);
    expect(back.lists).toEqual(archive.lists);
    expect(back.meta).toEqual(archive.meta);
  });

  it('refuses names that aren’t a list’s: folders, `..`, absolute paths, dot files, Windows’ reserved names', () => {
    for (const name of [
      '../evil.md',
      'attachments/x.md',
      'C:/Windows/x.md',
      '/etc/x.md',
      '.flint.md',
      'CON.md',
      'trailing .md',
      'notes.txt',
      'a\\b.md',
      'x:y.md',
      '~flint-moving Notes.md',
    ])
      expect([name, problem(archiveWith(name))]).toEqual([name, 'bad-name']);
  });

  it('refuses two names Windows would see as one file', () => {
    expect(problem(archiveWith('Groceries.md', 'groceries.md'))).toBe('name-clash');
    // The same name in two Unicode forms (é as one character, and as e and an accent).
    expect(problem(archiveWith('Caf\u00e9.md', 'Cafe\u0301.md'))).toBe('name-clash');
  });

  it('refuses text that isn’t UTF-8, and an archive without space.json', () => {
    const latin = writeZip(
      [
        { name: 'space.json', data: bytes(space) },
        { name: 'a.md', data: new Uint8Array([0xff, 0xfe, 0x41]) },
      ],
      codec,
    );
    expect(problem(latin)).toBe('not-text');
    expect(problem(writeZip([{ name: 'a.md', data: bytes('x') }], codec))).toBe('no-space-json');
  });

  it('refuses more than 20 MB of text before unpacking', () => {
    const big = writeZip(
      [
        { name: 'space.json', data: bytes(space) },
        { name: 'a.md', data: new Uint8Array(21 * 1024 * 1024).fill(0x61) },
      ],
      codec,
    );
    expect(problem(big)).toBe('too-big');
  });

  it('never writes a name it wouldn’t read', () => {
    expect(() =>
      writeSpaceArchive(
        { lists: new Map([['../x', '']]), meta: new Map([['space.json', space]]) },
        codec,
      ),
    ).toThrow(SpaceArchiveError);
  });
});
