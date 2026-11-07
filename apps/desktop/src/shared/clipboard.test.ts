import { describe, expect, it } from 'vitest';
import { clipAge, clipBarWidth, clipPreview } from './clipboard.js';

describe('a clipboard item in the section (NAV-08, D-128)', () => {
  it('shows its first line with text, spaces collapsed, cut long', () => {
    expect(clipPreview('\n\n  npm   run\tdist \nmore')).toBe('npm run dist');
    expect(clipPreview('   ')).toBe('');
    expect(clipPreview('x'.repeat(300), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('says how long ago: now, minutes, hours today, yesterday, then the date', () => {
    const now = new Date(2026, 2, 10, 10, 0).getTime();
    expect(clipAge(now - 20_000, now)).toBe('now');
    expect(clipAge(now - 4 * 60_000, now)).toBe('4m');
    expect(clipAge(now - 2 * 3_600_000, now)).toBe('2h');
    expect(clipAge(new Date(2026, 2, 9, 23, 0).getTime(), now)).toBe('yesterday');
    expect(clipAge(new Date(2026, 2, 7, 12, 0).getTime(), now)).toBe('7 Mar');
  });

  it('a longer text has a longer placeholder bar, within bounds', () => {
    expect(clipBarWidth('ab')).toBe(14);
    expect(clipBarWidth('a'.repeat(40))).toBeGreaterThan(clipBarWidth('a'.repeat(20)));
    expect(clipBarWidth('a'.repeat(500))).toBe(78);
  });
});
