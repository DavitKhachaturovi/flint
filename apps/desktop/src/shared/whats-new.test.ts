import { describe, expect, it } from 'vitest';
import { compareVersions, entriesSince, readWhatsNew } from './whats-new.js';

const FILE = `# What's new in Flint

Intro text, not an entry.

## 0.8.17 (8 Nov 2026)

- **Tips:** Flint points out shortcuts as you go.

## 0.8.16 (7 Nov 2026)

- **A tour:** eight steps.
- **What's new:** this card.

## 0.8.15

- One line.

## 0.8.14 (6 Nov 2026)
`;

describe("What's new (APP-15, D-117)", () => {
  it('reads each version, newest first, without the intro or empty entries', () => {
    const entries = readWhatsNew(FILE);
    expect(entries.map((entry) => entry.version)).toEqual(['0.8.17', '0.8.16', '0.8.15']);
    expect(entries[0]).toEqual({
      version: '0.8.17',
      date: '8 Nov 2026',
      markdown: '- **Tips:** Flint points out shortcuts as you go.',
    });
    expect(entries[2]?.date).toBeNull();
  });

  it('reads Windows line endings', () => {
    expect(readWhatsNew(FILE.replace(/\n/g, '\r\n'))[1]?.markdown).toBe(
      "- **A tour:** eight steps.\n- **What's new:** this card.",
    );
  });

  it('compares versions by number, not text', () => {
    expect(compareVersions('0.8.9', '0.8.16')).toBeLessThan(0);
    expect(compareVersions('0.9.0', '0.8.16')).toBeGreaterThan(0);
    expect(compareVersions('0.8.16', '0.8.16')).toBe(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('shows every version since the last one seen, up to this one, newest first', () => {
    const entries = readWhatsNew(FILE);
    expect(entriesSince(entries, '0.8.14', '0.8.17').map((each) => each.version)).toEqual([
      '0.8.17',
      '0.8.16',
      '0.8.15',
    ]);
    // Notes written for a later version than this build are not shown.
    expect(entriesSince(entries, '0.8.14', '0.8.16').map((each) => each.version)).toEqual([
      '0.8.16',
      '0.8.15',
    ]);
    expect(entriesSince(entries, '0.8.17', '0.8.17')).toEqual([]);
  });

  it("an install from before What's new sees only the newest entry (D-118)", () => {
    expect(entriesSince(readWhatsNew(FILE), null, '0.8.16').map((each) => each.version)).toEqual([
      '0.8.16',
    ]);
  });
});
