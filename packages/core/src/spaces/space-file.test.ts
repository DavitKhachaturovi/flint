import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanSpaceName, readSpaceFile, writeSpaceFile } from './space-file.js';

/** 04 §9, D-190 Q14: `.flint/space.json`, what makes a folder in `Spaces/` a space. */
describe('space.json (SPACE-01)', () => {
  it('reads a space and writes it back with unknown keys kept', () => {
    const text = '{ "flint": 1, "id": "s-k3f9", "name": "Home", "colour": "blue" }';
    const space = readSpaceFile(text);
    expect(space).toEqual({ id: 's-k3f9', name: 'Home', extra: { colour: 'blue' } });
    if (!space) return;
    const written = writeSpaceFile(space);
    expect(JSON.parse(written)).toEqual({ flint: 1, id: 's-k3f9', name: 'Home', colour: 'blue' });
    expect(readSpaceFile(written)).toEqual(space);
  });

  it('is no space without a valid id and name: missing, broken, or someone else’s file', () => {
    const bad = [
      null,
      '',
      'not json',
      '[]',
      'null',
      '{"flint":1,"name":"Home"}',
      '{"flint":1,"id":"k3f9","name":"Home"}',
      '{"flint":1,"id":"s-K3F9","name":"Home"}',
      '{"flint":1,"id":"s-k3","name":"Home"}',
      '{"flint":1,"id":"s-k3f9/../x","name":"Home"}',
      '{"flint":1,"id":"s-k3f9"}',
      '{"flint":1,"id":"s-k3f9","name":"   "}',
      '{"flint":1,"id":"s-k3f9","name":"a\\u0000b"}',
      `{"flint":1,"id":"s-k3f9","name":"${'x'.repeat(61)}"}`,
      '{"flint":1,"id":"s-k3f9","name":42}',
    ];
    for (const text of bad) expect(readSpaceFile(text)).toBeNull();
  });

  it('cleans a typed name: trimmed, spaces collapsed, at most 60 characters', () => {
    expect(cleanSpaceName('  Trip   crew ')).toBe('Trip crew');
    expect(cleanSpaceName('ქ'.repeat(60))).toBe('ქ'.repeat(60));
    expect(cleanSpaceName('ქ'.repeat(61))).toBeNull();
    expect(cleanSpaceName('')).toBeNull();
  });

  it('round-trips any valid space', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^s-[a-z0-9]{4,32}$/),
        fc.string({ minLength: 1, maxLength: 60 }),
        (id, rawName) => {
          const name = cleanSpaceName(rawName);
          fc.pre(name !== null);
          const space = { id, name: name as string, extra: {} };
          expect(readSpaceFile(writeSpaceFile(space))).toEqual(space);
        },
      ),
    );
  });
});
