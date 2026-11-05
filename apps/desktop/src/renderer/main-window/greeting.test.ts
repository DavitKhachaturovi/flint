import { describe, expect, it } from 'vitest';
import { dayPart } from './greeting.js';

describe('dayPart (D-107)', () => {
  it('keeps the evening until 04:00, then morning, afternoon and evening', () => {
    expect([0, 3, 4, 11, 12, 17, 18, 23].map(dayPart)).toEqual([
      'evening',
      'evening',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });
});
