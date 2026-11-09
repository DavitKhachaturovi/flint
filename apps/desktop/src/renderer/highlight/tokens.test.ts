import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jsonTokens, traceLocation } from './tokens.js';

/**
 * The highlighter's matchers (D-143): the same results as the regexes they replaced, on many short
 * random lines where the regexes are still fast, and linear time on long pathological lines.
 */

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);

const OLD_JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
const OLD_LOCATION = /((?:[A-Za-z]:)?[\\/\w.-]+\.\w+(?::line)?[:\s]\d+(?::\d+)?)|(line \d+)/;

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NBSP = String.fromCharCode(0xa0);

function oldTokens(line: string): unknown[] {
  return [...line.matchAll(OLD_JSON_TOKEN)].map((match) => {
    const [text, string, colon, number, literal] = match;
    return { index: match.index, text, string, colon, number, literal };
  });
}

function newTokens(line: string): unknown[] {
  return jsonTokens(line).map(({ index, text, string, colon, number, literal }) => ({
    index,
    text,
    string,
    colon,
    number,
    literal,
  }));
}

function oldLocation(line: string): { index: number; text: string } | null {
  const match = OLD_LOCATION.exec(line);
  return match ? { index: match.index, text: match[0] } : null;
}

function line(pieces: readonly string[], maxLength = 24): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...pieces), { maxLength }).map((parts) => parts.join(''));
}

describe('highlighter matchers find what the regexes found (D-143)', () => {
  it('JSON tokens: strings, keys, numbers and literals', () => {
    const pieces = [
      ...['"', '"', '\\', '\\"', '\\\\', 'a', ' ', '\t', ':', ',', '{', '}', '[', ']'],
      ...['-', '1', '0', '.', 'e', 'E', '+', 'true', 'fals', 'null', 'nul', '\r', LS, PS, NBSP],
    ];
    let found = 0;
    fc.assert(
      fc.property(line(pieces), (value) => {
        const expected = oldTokens(value);
        if (expected.length > 0) found += 1;
        expect(newTokens(value), JSON.stringify(value)).toEqual(expected);
      }),
      { numRuns: RUNS * 5 },
    );
    expect(found).toBeGreaterThan(RUNS);
  });

  it('JSON tokens: real lines', () => {
    for (const value of [
      '  "name": "Alex", "age": 42, "ok": true, "x": null,',
      '{"a":{"b":[1,-2.5e+3,false]}}',
      '"key"   :   "va\\"lue"',
      '"unclosed \\" string 12 true',
      `"broken \\${LS}" "next": 1`,
      '',
    ])
      expect(newTokens(value), value).toEqual(oldTokens(value));
  });

  it('stack-trace locations: file, line and column', () => {
    const pieces = [
      ...['a', 'Z', '_', '1', '9', '.', '-', '/', '\\', ':', ' ', '\t', '(', ')', 'js'],
      ...['C:', 'line', 'line ', ':line', '.cs', ' in ', LS, NBSP],
    ];
    // Frame-shaped lines (text, a path, an extension, a separator, numbers, text), so that many of
    // them hold a location and the comparison covers matches, not only misses.
    const framed = fc
      .tuple(
        line(pieces, 6),
        line(['a', 'b1', '_', '.', '-', '/', '\\', 'C:'], 8),
        fc.constantFrom('.js', '.cs', '.', '.a1', '', '.js.map'),
        fc.constantFrom(':', ' ', ':line ', ':line:', '\t', '', ':line', LS),
        fc.constantFrom('12', '1:2', '', '3:', '7:x', '0:0:0'),
        line(pieces, 6),
      )
      .map((parts) => parts.join(''));
    let found = 0;
    fc.assert(
      fc.property(fc.oneof(line(pieces), framed), (value) => {
        const expected = oldLocation(value);
        if (expected) found += 1;
        expect(traceLocation(value), JSON.stringify(value)).toEqual(expected);
      }),
      { numRuns: RUNS * 5 },
    );
    expect(found).toBeGreaterThan(RUNS / 2);
  });

  it('stack-trace locations: real frames', () => {
    for (const value of [
      '    at Object.<anonymous> (C:\\work\\app\\index.js:12:5)',
      '    at fn (/home/alex/src/app.ts:7:13)',
      '\tat com.acme.Main.run(Main.java:42)',
      '   at Contoso.Program.Main() in C:\\src\\Program.cs:line 17',
      '  File "/srv/app/main.py", line 3, in <module>',
      'main.main()\n\t/home/alex/go/src/main.go:12 +0x1d',
      '    at async Promise.all (index 0)',
      '    at a.b.c',
    ])
      expect(traceLocation(value), value).toEqual(oldLocation(value));
  });
});
