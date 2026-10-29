import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Georgia (UTC+4, no daylight saving) is where Flint is used first. Time tests that need a
    // daylight-saving zone set process.env.TZ themselves.
    env: { TZ: 'Asia/Tbilisi' },
  },
});
