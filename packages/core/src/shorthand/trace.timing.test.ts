import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FRAME_LINE, traceLineKinds } from './trace.js';
/**
 * CodeQL js/polynomial-redos (alert 9): the trace patterns run on every line of a paste
 * (`classifyPaste`) and of a stack-trace block in the highlighter, and a pasted line can be long.
 * The two patterns below took time quadratic in the line's length; their replacements recognise the
 * same lines in linear time.
 */
describe('stack traces: long pasted lines stay fast and recognise the same lines', () => {
  /** The patterns as they were (only safe on short lines): the reference for the new ones. */
  const OLD_LOCATED_FRAME =
    /^\s*at\s+\S.*(?:\(.*:\d+(?::\d+)?\)|:\d+(?::\d+)?|\)\s+in\s+.+:line\s+\d+)\s*$/;
  const OLD_GO_FUNCTION = /^\S.*\(.*\)$/;

  /** `traceLineKinds` as it was, with the old patterns, for comparison on short lines. */
  function oldTraceLineKinds(input: readonly string[]): string[] {
    const frame = [OLD_LOCATED_FRAME, ...FRAME_LINE.slice(1)];
    const header = [
      /^(?:Traceback \(most recent call last\):|goroutine \d+ \[[^\]]+\]:)\s*$/,
      /^\s*\.\.\. \d+ more\s*$/,
      /^\s*--- End of (?:inner exception )?stack trace(?: from previous location)? ---\s*$/,
      /^\s*During handling of the above exception, another exception occurred:\s*$/,
      /^\s*The above exception was the direct cause of the following exception:\s*$/,
    ];
    const exception =
      /^\s*(?:Caused by:\s*|Unhandled exception\.\s*)?(?:[\w$]+\.)*[\w$]*(?:Error|Exception|Throwable|Fault|Interrupt|Exit)\b|^\s*panic:/;
    const kinds: string[] = [];
    let underPythonFrame = false;
    input.forEach((line, index) => {
      let kind: string;
      if (header.some((pattern) => pattern.test(line))) kind = 'header';
      else if (frame.some((pattern) => pattern.test(line))) kind = 'frame';
      else if (underPythonFrame && /^\s+\S/.test(line)) kind = 'frame';
      else if (exception.test(line)) kind = 'exception';
      else if (index === 0) kind = 'exception';
      else if (kinds.at(-1) === 'frame' && /^[A-Za-z_][\w.]*: /.test(line)) kind = 'exception';
      else if (OLD_GO_FUNCTION.test(line) && /\.go:\d+/.test(input[index + 1] ?? ''))
        kind = 'frame';
      else kind = 'plain';
      underPythonFrame = /^\s*File\s+".+",\s+line\s+\d+/.test(line);
      kinds.push(kind);
    });
    return kinds;
  }

  // Pieces of real frames, plus the characters the patterns treat specially: spaces and tabs,
  // line separators (`.` doesn't match them, `\s` does), digits, brackets, colons.
  const piece = fc.constantFrom(
    'at',
    ' ',
    '  ',
    '\t',
    '\u00a0',
    '\u2028',
    '\u2029',
    '\r',
    '\n',
    'x',
    'Foo.Bar',
    '(',
    ')',
    ':',
    '1',
    '48',
    ':17',
    'in',
    ' in ',
    ') in ',
    ':line',
    ':line ',
    'line',
    '.go',
    '.go:12',
    ' +0x1d',
    'File "',
    '",',
    'Error',
    'panic:',
    'Caused by: ',
    'main.',
    '$',
  );
  const start = fc.constantFrom('', ' ', '   at ', 'at ', '\tat ', 'at x', 'main.run', '(');
  const line = fc
    .tuple(start, fc.array(piece, { maxLength: 14 }))
    .map(([head, rest]) => head + rest.join(''));

  it('the located-frame pattern accepts exactly the lines the old regex did', () => {
    fc.assert(
      fc.property(line, (text) => {
        expect(FRAME_LINE[0]?.test(text)).toBe(OLD_LOCATED_FRAME.test(text));
      }),
      { numRuns: 20_000 },
    );
  });

  it('every line gets the same kind as before', () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 8 }), (input) => {
        expect(traceLineKinds(input)).toEqual(oldTraceLineKinds(input));
      }),
      { numRuns: 5_000 },
    );
  });

  it.each([
    ['at x(Foo.cs:12)', true],
    ['   at resolveTenant (/app/src/tenant.ts:48:17)  ', true],
    ['at /app/src/tenant.ts:48', true],
    ['at Foo.Bar() in C:\\src\\Foo.cs:line 48', true],
    ['at Foo.Bar()\tin\tC:\\src\\Foo.cs:line\t48 ', true],
    ['at Foo.Bar() in  :line 48', true],
    ['at Foo.Bar() in :line 48', false],
    ['at Foo.Bar() in x:line', false],
    ['at Foo.Bar()in x:line 48', false],
    ['at Foo.Bar() in\u2028x:line 48', true],
    ['at Foo\u2028.Bar() in x:line 48', false],
    ['at Foo.Bar() in x\u2028y:line 48', false],
    ['at x(a:1', true],
    ['at x:1(2)', false],
    ['at x(a:1:2)', true],
    ['at x(a\u2028:1)', false],
    ['meet at 15:00', false],
    ['at 15:00', true],
    ['at  x:00', true],
  ])('a located frame: %j is %s', (text, expected) => {
    expect(FRAME_LINE[0]?.test(text)).toBe(expected);
    expect(OLD_LOCATED_FRAME.test(text)).toBe(expected);
  });

  const size = 50_000;
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));

  it.each([
    ['! then many (', `!${repeat('(')}`],
    ['many ( then )', `!${repeat('(')})`],
    ['at, then many (', `at x${repeat('(')}`],
    ['at, then many (:', `at x${repeat('(:')}`],
    ['at, then many (:1', `at x${repeat('(:1')}!`],
    ['at, then many full locations', ` at x${repeat('(a:1)')}!`],
    ['at, then many .NET locations', `at x${repeat(') in x:line 1')}!`],
    ['at, then many ) in without a file', `at x${repeat(')  in')}:line 1`],
    ['at, then many ) in with line separators', `at x${repeat(') in\u2028')}:line 1`],
    ['at, then spaces', `at x(${' '.repeat(size)}!`],
    ['at, then digits', `at x(:${'1'.repeat(size)}!`],
    ['at, then many :line', `at x) in ${repeat(':line 1 ')}x`],
    ['many (a.go:1', repeat('(a.go:1')],
  ])(
    '%s',
    (_, input) => {
      const begin = performance.now();
      for (const pattern of FRAME_LINE) pattern.test(input);
      traceLineKinds(['panic: x', input, '\t/app/main.go:48 +0x1d']);
      traceLineKinds([input, '\t/app/main.go:48 +0x1d']);
      expect(performance.now() - begin).toBeLessThan(100);
    },
    10_000,
  );
});
