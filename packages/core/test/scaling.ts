import { expect } from 'vitest';

/**
 * D-156: whether an operation runs in linear time, judged by how its time grows with the input
 * rather than by a wall-clock limit. A limit like "under 100 ms" fails on a slow or busy machine
 * (a CI runner, the whole suite running at once) although nothing is wrong, and it says little
 * about growth. Here the same operation runs on an input of size `n` and of `4n` (the ratio the
 * median of three samples, after a warm-up): linear code takes about 4 times as long on the
 * larger one, quadratic code about 16 times. A uniformly slower machine leaves the ratio as it is.
 */

/**
 * Linear is about 4 (allocation-heavy linear code, up to about 7); quadratic about 16 and up.
 */
export const LINEAR_RATIO = 10;

/**
 * The smaller input is grown (doubled, up to 16 times) until it takes at least this long, so the
 * timer's resolution and noise never decide the ratio.
 */
const MIN_MS = 4;
const MAX_GROWTH = 16;

/**
 * The best of `tries` runs of `run`, in milliseconds of wall-clock time. Measured only in the
 * timing pass (`*.timing.test.ts`, one file at a time): run among the other tests' workers, the
 * wall clock measured them taking the CPU away, not the code (a linear step's ratio reached 16
 * that way, 9 Nov 2026). CPU time would avoid that, but on Windows it moves in 15.6 ms ticks.
 */
export function bestOf(run: () => void, tries = 3): number {
  let best = Infinity;
  for (let attempt = 0; attempt < tries; attempt++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * The time on an input of size `4n` over the time on one of size `n`: the median of three
 * samples, each the best of three runs per size. Code that allocates much (a large result built
 * piece by piece) now and then meets a garbage collection that throws one sample up to quadratic
 * levels (a linear step measured 22 once, 9 Nov 2026); the median of three is never decided by one.
 */
export function growth<T>(make: (size: number) => T, run: (input: T) => void, n: number): number {
  return ratioAt(make, run, sizeFor(make, run, n));
}

/** `n`, doubled (up to 16 times) until `run` takes at least `MIN_MS` on an input of that size. */
function sizeFor<T>(make: (size: number) => T, run: (input: T) => void, n: number): number {
  run(make(Math.max(1, Math.floor(n / 10)))); // Warms the JIT on the same code paths.
  let size = n;
  const input = (): T => make(size);
  while (size < n * MAX_GROWTH) {
    const small = input();
    if (bestOf(() => run(small)) >= MIN_MS) break;
    size *= 2;
  }
  return size;
}

/** The median of three samples of the time on `4 * size` over the time on `size`. */
function ratioAt<T>(make: (size: number) => T, run: (input: T) => void, size: number): number {
  const small = make(size);
  const large = make(4 * size);
  run(small); // Warm on these inputs.
  const samples = [0, 1, 2].map(
    () =>
      bestOf(() => run(large)) /
      Math.max(
        bestOf(() => run(small)),
        0.01,
      ),
  );
  return samples.sort((x, y) => x - y)[1] ?? Infinity;
}

/**
 * With a baseline: `run` may grow at most this many times as much as the baseline does. Linear
 * code that allocates as the baseline does grows alike (about 1); a quadratic step grows 4 times
 * as much and more.
 */
export const BASELINE_RATIO = 2.5;

/**
 * Expects `run` to grow linearly with its input, `make(size)` building an input of about `size`
 * (characters, rows…), `n` large enough that the smaller input takes a few milliseconds.
 *
 * `baseline`, for input that makes `run` allocate a great deal (a row per line break): there the
 * garbage collector's work grows faster than the input whatever the code does (a loop that only
 * builds the rows grew 9 to 13 times from n to 4n, 9 Nov 2026), so `run` is compared with a
 * baseline doing that unavoidable work: it may not grow much more than the baseline does.
 */
export function expectLinear<T>(
  make: (size: number) => T,
  run: (input: T) => void,
  n: number,
  options: { readonly baseline?: (input: T) => void } = {},
): void {
  const { baseline } = options;
  if (!baseline) {
    expect(growth(make, run, n)).toBeLessThan(LINEAR_RATIO);
    return;
  }
  // One size for both (the garbage collector's share depends on it), chosen for `run`.
  const size = sizeFor(make, run, n);
  baseline(make(Math.max(1, Math.floor(n / 10))));
  expect(ratioAt(make, run, size) / ratioAt(make, baseline, size)).toBeLessThan(BASELINE_RATIO);
}
