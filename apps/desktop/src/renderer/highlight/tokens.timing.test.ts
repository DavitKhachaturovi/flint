import { describe, expect, it } from 'vitest';
import { jsonTokens, traceLocation } from './tokens.js';

/** D-156: the timing pass (`npm test` runs it after the other tests, one file at a time). */

/**
 * Before D-143 each of these took time quadratic in the line's length: about 0.2 to 1.1 s at
 * 40,000 characters. They now take a few milliseconds; the limit is generous for slow CI machines.
 */
describe('highlighter matchers: long lines stay fast (D-143)', () => {
  const SIZE = 50_000;

  function fast<T>(run: () => T): T {
    run(); // Warm up: the first call also compiles the code.
    let best = Infinity;
    let result = run();
    for (let round = 0; round < 3; round += 1) {
      const start = performance.now();
      result = run();
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(100);
    return result;
  }

  it('locations in long frame lines', { timeout: 10_000 }, () => {
    expect(fast(() => traceLocation(`at ${'a.'.repeat(SIZE / 2)}(x)`))).toBeNull();
    expect(fast(() => traceLocation(`at ${'a'.repeat(SIZE)}(x)`))).toBeNull();
    expect(fast(() => traceLocation(`at ${'a.b-'.repeat(SIZE / 4)}`))).toBeNull();
    expect(fast(() => traceLocation('C:a.b '.repeat(SIZE / 6)))).toBeNull();
    expect(fast(() => traceLocation(`${'a.b:line '.repeat(SIZE / 9)}x`))).toBeNull();
    const long = `at ${'a.'.repeat(SIZE / 2)}js:12:5`;
    expect(fast(() => traceLocation(long))).toEqual({ index: 3, text: long.slice(3) });
  });

  it('JSON tokens in long lines', { timeout: 10_000 }, () => {
    const escaped = '"\\'.repeat(SIZE / 2);
    expect(fast(() => jsonTokens(escaped))).toEqual([]);
    expect(fast(() => jsonTokens(`${escaped} 1`))).toEqual([
      { index: SIZE + 1, text: '1', number: '1' },
    ]);
    expect(fast(() => jsonTokens(`"${'a'.repeat(SIZE)}`))).toEqual([]);
    expect(fast(() => jsonTokens('"a" '.repeat(SIZE / 4)))).toHaveLength(SIZE / 4);
    expect(fast(() => jsonTokens(`"a"${' '.repeat(SIZE)}x`))).toHaveLength(1);
    expect(fast(() => jsonTokens('-1.5e+3,'.repeat(SIZE / 8)))).toHaveLength(SIZE / 8);
  });
});
