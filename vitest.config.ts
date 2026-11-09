import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const core = (path: string): string =>
  fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

/** Where the unit tests are. */
const TESTS = [
  'packages/*/src/**/*.test.ts',
  'packages/*/test/**/*.test.ts',
  'apps/desktop/src/main/**/*.test.ts',
  'apps/desktop/src/shared/**/*.test.ts',
  // M5: the note editor's commands (no DOM needed).
  'apps/desktop/src/renderer/editor/**/*.test.ts',
  'apps/desktop/src/renderer/panel/**/*.test.ts',
  // D-107: the main window's pure helpers (the greeting's part of the day).
  'apps/desktop/src/renderer/main-window/**/*.test.ts',
  // D-143: the highlighter's linear matchers (no DOM needed).
  'apps/desktop/src/renderer/highlight/**/*.test.ts',
];
/** D-156: the tests that measure time. */
const TIMING = '**/*.timing.test.ts';

export default defineConfig({
  // The app uses @flint/core from source, as electron-vite bundles it.
  resolve: {
    alias: [
      { find: /^@flint\/core\/(.+)$/, replacement: core('$1/index.ts') },
      { find: /^@flint\/core$/, replacement: core('index.ts') },
    ],
  },
  test: {
    // D-156: two passes. `unit`, every file at once; `timing` (the linear-time checks,
    // `*.timing.test.ts`) after it, one file at a time (`npm test` runs it with
    // --no-file-parallelism), so no other test takes the CPU while they measure.
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: TESTS, exclude: [...configDefaults.exclude, TIMING] },
      },
      { extends: true, test: { name: 'timing', include: [TIMING] } },
    ],
    // Georgia (UTC+4, no daylight saving) is where Flint is used first. Time tests that need a
    // daylight-saving zone set process.env.TZ themselves.
    env: { TZ: 'Asia/Tbilisi' },
    // D-141 Q13: FLINT_FUZZ_SEED fixes fast-check's seed (npm run fuzz prints it each round).
    setupFiles: ['scripts/fuzz-seed.mjs'],
  },
});
