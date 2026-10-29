import { describe, expect, it } from 'vitest';

// The time tests rely on two things about the test environment: the default zone is Georgia
// (vitest.config.ts), and a test file can switch zones at runtime to cover daylight saving.
describe('test environment', () => {
  it('runs in Asia/Tbilisi (UTC+4, no daylight saving) by default', () => {
    expect(process.env.TZ).toBe('Asia/Tbilisi');
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-240);
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-240);
  });

  it('applies a TZ change made at runtime', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Berlin';
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-60);
      expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-120);
    } finally {
      process.env.TZ = original;
    }
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-240);
  });
});
