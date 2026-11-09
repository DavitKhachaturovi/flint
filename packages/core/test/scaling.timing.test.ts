import { describe, expect, it } from 'vitest';
import { growth, LINEAR_RATIO } from './scaling.js';

/** D-156: the linear-time check tells linear from quadratic, whatever the machine's speed. */
describe('expectLinear (D-156)', () => {
  const text = (n: number): string => 'ab'.repeat(n / 2);
  /** One pass over the text. */
  const linear = (input: string): number => {
    let sum = 0;
    for (let at = 0; at < input.length; at++) sum += input.charCodeAt(at);
    return sum;
  };
  /** For every 8th character, a search through the rest: quadratic. */
  const quadratic = (input: string): number => {
    let found = 0;
    for (let at = 0; at < input.length; at += 8) found += input.indexOf('z', at) < 0 ? 1 : 0;
    return found;
  };

  it('passes a linear pass and fails a quadratic one', () => {
    expect(growth(text, linear, 400_000)).toBeLessThan(LINEAR_RATIO);
    expect(growth(text, quadratic, 20_000)).toBeGreaterThan(LINEAR_RATIO);
  });

  it('keeps the ratio when the machine is uniformly slower', () => {
    // Every run made three times as slow, as on a busy runner: the ratio stays linear.
    const slow = (input: string): void => {
      for (let again = 0; again < 3; again++) linear(input);
    };
    expect(growth(text, slow, 400_000)).toBeLessThan(LINEAR_RATIO);
  });
});
