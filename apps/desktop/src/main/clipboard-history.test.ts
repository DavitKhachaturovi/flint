import { describe, expect, it } from 'vitest';
import { clipboardHistoryEnabled } from './clipboard-history.js';

describe('Windows clipboard history, the WinRT binding (NAV-08, D-127)', () => {
  // Only whether history is on (a setting): the tests never read the history itself (D-93).
  it('loads and answers whether history is on, without throwing', () => {
    const enabled = clipboardHistoryEnabled();
    expect(enabled === null || typeof enabled === 'boolean').toBe(true);
  });
});
