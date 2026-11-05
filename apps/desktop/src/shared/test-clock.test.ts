import { afterEach, describe, expect, it } from 'vitest';
import { installTestClock } from './test-clock.js';

/** D-107: the end-to-end tests' clock: `Date` shifted, still running, everything else untouched. */
describe('installTestClock', () => {
  const Real = Date;
  afterEach(() => {
    globalThis.Date = Real;
  });

  it('shifts now and new Date(), and leaves dates made from values alone', () => {
    const offset = new Real(2026, 2, 10, 23, 59, 30).getTime() - Real.now();
    installTestClock(offset);
    expect(Math.abs(Date.now() - (Real.now() + offset))).toBeLessThan(50);
    const now = new Date();
    expect([now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()]).toEqual([
      2026, 2, 10, 23,
    ]);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date(2026, 0, 1).getMonth()).toBe(0);
    expect(new Date('2026-03-11T00:30:00').getHours()).toBe(0);
    expect(Date.parse('2026-03-11T00:30:00Z')).toBe(Real.parse('2026-03-11T00:30:00Z'));
    expect(Date.UTC(2026, 2, 11)).toBe(Real.UTC(2026, 2, 11));
    expect(typeof (Date as unknown as () => string)()).toBe('string');
  });

  it('keeps instanceof and the prototype, and installs once', () => {
    installTestClock(1000);
    installTestClock(1_000_000);
    expect(new Date()).toBeInstanceOf(Date);
    expect(new Real()).toBeInstanceOf(Date);
    expect(new Date().toISOString()).toMatch(/Z$/);
    expect(Math.abs(Date.now() - (Real.now() + 1000))).toBeLessThan(50);
  });
});
