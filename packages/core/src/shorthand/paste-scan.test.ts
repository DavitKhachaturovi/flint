import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  firstFence,
  hasImageLink,
  isBareUrl,
  isSpace,
  removeFields,
  stripEnds,
  trimBlankLines,
} from './paste-scan.js';

/**
 * The linear scanners do exactly what the regexes they replaced did (CAP-06, js/polynomial-redos):
 * each is checked against its old regex on many short random texts, where the regex is still fast.
 */

const OLD = {
  strip: /^[\s{}[\],"]+|[\s{}[\],"]+$/g,
  blankLines: /^\s*\n|\s+$/g,
  imagePlain: /!\[[^\]]*\]\([^)\s]+\)/,
  image: /!\[[^\]]*\]\([^)]*\)/,
  field: /\[[\w-]+::[^\]]*\]/g,
  url: /^\s*\S+:\/\/\S+\s*$/,
  fence: /^(`{3,}|~{3,})(\w*)\s*\n([\s\S]*?)\n\1\s*$/m,
};

const RUNS = { numRuns: 3000 };

function text(pieces: readonly string[], maxLength = 30): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...pieces), { maxLength }).map((parts) => parts.join(''));
}

/** Spaces of every kind `\s` matches, line breaks included. */
const SPACES = [' ', '\t', '\n', '\r', '\u00a0', '\u2028', '\u3000', '\ufeff'];

describe('paste scanners match the regexes they replace (CAP-06)', () => {
  it('trimEnd and trim remove exactly what \\s+$ and ^\\s+ did, over every BMP code unit', () => {
    // paste.ts replaced `.replace(/\s+$/, '')` with `.trimEnd()`; the scanners use isSpace.
    const differ: number[] = [];
    for (let code = 0; code < 0x10000; code += 1) {
      const char = String.fromCharCode(code);
      const padded = `a${char}${char}`;
      if (padded.trimEnd() !== padded.replace(/\s+$/, '')) differ.push(code);
      if (`${char}a`.trim() !== `${char}a`.replace(/^\s+/, '')) differ.push(code);
      if (isSpace(char) !== (char.trim() === '')) differ.push(code);
    }
    expect(differ).toEqual([]);
    expect(isSpace('')).toBe(false);
  });

  it('stripEnds: spaces, brackets, commas and quotes around a title', () => {
    const strip = (char: string): boolean => isSpace(char) || '{}[],"'.includes(char);
    fc.assert(
      fc.property(text([...SPACES, '{', '}', '[', ']', ',', '"', 'a', 'b', ':']), (value) => {
        expect(stripEnds(value, strip)).toBe(value.replace(OLD.strip, ''));
      }),
      RUNS,
    );
  });

  it('trimBlankLines: leading blank lines and trailing spaces', () => {
    fc.assert(
      fc.property(text([...SPACES, '\n', '\n', 'a', 'b']), (value) => {
        expect(trimBlankLines(value)).toBe(value.replace(OLD.blankLines, ''));
      }),
      RUNS,
    );
  });

  it('hasImageLink: with and without spaces in the target', () => {
    const pieces = ['!', '[', ']', '(', ')', '![', '](', ' ', '\t', '\n', 'a', 'b'];
    const noise = text(pieces, 4);
    const link = fc.tuple(noise, noise).map(([alt, target]) => `![${alt}](${target})`);
    const value = fc.array(fc.oneof(noise, link), { maxLength: 5 }).map((parts) => parts.join(''));
    let found = 0;
    fc.assert(
      fc.property(value, (value) => {
        if (OLD.imagePlain.test(value)) found += 1;
        expect(hasImageLink(value, true), JSON.stringify(value)).toBe(OLD.imagePlain.test(value));
        expect(hasImageLink(value, false), JSON.stringify(value)).toBe(OLD.image.test(value));
      }),
      RUNS,
    );
    // The random texts hold image links often enough to compare both answers.
    expect(found).toBeGreaterThan(RUNS.numRuns / 20);
  });

  it('removeFields: Dataview fields', () => {
    const pieces = ['[', ']', ':', '::', 'a', 'Z', '0', '_', '-', ' ', 'é', '[id::', '[a-b::'];
    fc.assert(
      fc.property(text(pieces), (value) => {
        expect(removeFields(value)).toBe(value.replace(OLD.field, ''));
      }),
      RUNS,
    );
  });

  it('isBareUrl: one URL-like word', () => {
    const word = text([':', '/', '://', 'a', 'b', '.'], 8);
    const padded = fc
      .tuple(text(SPACES, 3), word, fc.constantFrom('', ' ', '\t'), word, text(SPACES, 3))
      .map((parts) => parts.join(''));
    let found = 0;
    fc.assert(
      fc.property(fc.oneof(text([...SPACES, ':', '/', '://', 'a', 'b', '.']), padded), (value) => {
        if (OLD.url.test(value)) found += 1;
        expect(isBareUrl(value), JSON.stringify(value)).toBe(OLD.url.test(value));
      }),
      RUNS,
    );
    expect(found).toBeGreaterThan(RUNS.numRuns / 20);
    expect(isBareUrl('https://example.com/a')).toBe(true);
    expect(isBareUrl('  https://example.com/a \n')).toBe(true);
    expect(isBareUrl('see https://example.com/a')).toBe(false);
  });

  it('firstFence: the first fenced block, its info string and content', () => {
    const old = (value: string): unknown => {
      const match = OLD.fence.exec(value);
      return match ? { info: match[2], content: match[3] } : null;
    };
    const pieces = [
      '`',
      '~',
      '```',
      '````',
      '~~~',
      '\n',
      '\n',
      '\n',
      '\r',
      ' ',
      '\u2028',
      '\u00a0',
      '\t',
      'json',
      'a',
      '_',
      '-',
      'x y',
    ];
    // Random pieces, and blocks shaped like fences with random fences, info strings, blank space,
    // content and endings, so that many texts hold a block and many almost do.
    const fence = fc.constantFrom('```', '````', '~~~', '``');
    const block = fc
      .tuple(
        fence,
        fc.constantFrom('', 'json', 'a_b', ' x'),
        text([' ', '\t', '\n', '\r', '\u2028'], 3),
        text(pieces, 8),
        fence,
        fc.constantFrom('', ' ', '\n', '\r', 'x', '`', ' \nx', '\u2028'),
      )
      .map(([open, info, space, content, close, end]) =>
        [open, info, space, '\n', content, '\n', close, end].join(''),
      );
    const value = fc
      .array(fc.oneof(text(pieces, 6), block), { maxLength: 4 })
      .map((parts) => parts.join(''));
    let found = 0;
    fc.assert(
      fc.property(value, (value) => {
        if (OLD.fence.test(value)) found += 1;
        expect(firstFence(value), JSON.stringify(value)).toEqual(old(value));
      }),
      { numRuns: 10000 },
    );
    expect(found).toBeGreaterThan(10000 / 20);
    for (const value of [
      '```\n```',
      '```\n\n```',
      '```\n \n```',
      '```\n\n\n```',
      '```js\nconst a = 1;\n```',
      '````\na\n```\nb\n````  \nafter',
      '~~~json\n{"a": 1}\n~~~',
      'intro\n```\ncode\n```\nouter\n```\nmore\n```',
      '```\nnot closed',
      '```a\n```a\n```a\n',
    ])
      expect(firstFence(value), JSON.stringify(value)).toEqual(old(value));
  });
});
