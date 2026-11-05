/**
 * D-107: end-to-end tests run on a fixed clock, so what they see never depends on when the suite
 * runs. The test runner picks a moment (a set date at a daytime hour, or just before midnight for the
 * day-change tests) and hands Flint the offset from the real time (`FLINT_E2E_CLOCK_OFFSET`, test
 * mode only). The main process and every window then read the time through a `Date` shifted by it;
 * the clock still runs, so timers, countdowns and the day change behave as they would for real.
 */

/** The argument a window's preload reads the offset from. */
export const CLOCK_ARGUMENT = '--flint-test-clock=';

/**
 * Shifts this world's `Date` by `offset` ms. Self-contained (no imports, no outer names): a preload
 * runs it in its page's own world as source, before the page's scripts.
 */
export function installTestClock(offset: number): void {
  const Real = Date;
  const marked = Real as unknown as { flintTestClock?: boolean };
  if (marked.flintTestClock) return;
  const now = (): number => Real.now() + offset;
  // `new Date()` is the shifted now; `new Date(x)` is untouched; `Date()` is the shifted string.
  const Shifted = function (this: unknown, ...args: unknown[]): Date | string {
    if (new.target === undefined) return new Real(now()).toString();
    return args.length === 0 ? new Real(now()) : (Reflect.construct(Real, args) as Date);
  } as unknown as DateConstructor;
  Object.defineProperties(Shifted, {
    prototype: { value: Real.prototype },
    now: { value: now, writable: true, configurable: true },
    parse: { value: Real.parse.bind(Real), writable: true, configurable: true },
    UTC: { value: Real.UTC.bind(Real), writable: true, configurable: true },
    flintTestClock: { value: true },
  });
  globalThis.Date = Shifted;
}
