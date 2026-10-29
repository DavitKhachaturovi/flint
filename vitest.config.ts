import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const core = (path: string): string =>
  fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

export default defineConfig({
  // The app uses @flint/core from source, as electron-vite bundles it.
  resolve: {
    alias: [
      { find: /^@flint\/core\/(.+)$/, replacement: core('$1/index.ts') },
      { find: /^@flint\/core$/, replacement: core('index.ts') },
    ],
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/desktop/src/main/**/*.test.ts',
    ],
    // Georgia (UTC+4, no daylight saving) is where Flint is used first. Time tests that need a
    // daylight-saving zone set process.env.TZ themselves.
    env: { TZ: 'Asia/Tbilisi' },
  },
});
