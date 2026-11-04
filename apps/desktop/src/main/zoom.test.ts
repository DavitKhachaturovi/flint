import { describe, expect, it } from 'vitest';
import { displayKey, isZoomRequest, readZooms, stepZoom, zoomKey } from './zoom.js';

describe('interface size (UI-12, D-81)', () => {
  it("steps through Chrome's zoom levels and back to 100 %", () => {
    expect(stepZoom(1, 'in')).toBe(1.1);
    expect(stepZoom(1.1, 'in')).toBe(1.25);
    expect(stepZoom(1, 'out')).toBe(0.9);
    expect(stepZoom(0.67, 'out')).toBe(0.67);
    expect(stepZoom(2, 'in')).toBe(2);
    expect(stepZoom(1.3, 'out')).toBe(1.25);
    expect(stepZoom(1.3, 'in')).toBe(1.5);
    expect(stepZoom(1.75, 'reset')).toBe(1);
  });

  it('remembers per display, by name and size', () => {
    expect(displayKey({ id: 7, label: 'DELL P2422H', size: { width: 1920, height: 1080 } })).toBe(
      'DELL P2422H 1920x1080',
    );
    expect(displayKey({ id: 7, label: '', size: { width: 1440, height: 900 } })).toBe(
      'display 7 1440x900',
    );
  });

  it('knows the zoom keys, the keypad ones included', () => {
    expect(zoomKey('=', 'Equal')).toBe('in');
    expect(zoomKey('+', 'Equal')).toBe('in');
    expect(zoomKey('+', 'NumpadAdd')).toBe('in');
    expect(zoomKey('-', 'Minus')).toBe('out');
    expect(zoomKey('0', 'Digit0')).toBe('reset');
    expect(zoomKey('9', 'Digit9')).toBeNull();
  });

  it('reads the file tolerantly', () => {
    expect(readZooms({ a: 1.25, b: 'big', c: 9, d: 0.1 })).toEqual({ a: 1.25 });
    expect(readZooms(null)).toEqual({});
  });
});

describe('D-102: an exact interface size', () => {
  it('is set as asked, from any level, never one step from the current one', () => {
    expect(stepZoom(0.9, 1.1)).toBe(1.1);
    expect(stepZoom(1.5, 0.8)).toBe(0.8);
    expect(stepZoom(1, 1.25)).toBe(1.25);
  });

  it('is only one of the steps', () => {
    expect(isZoomRequest(1.1)).toBe(true);
    expect(isZoomRequest('in')).toBe(true);
    expect(isZoomRequest(1.05)).toBe(false);
    expect(isZoomRequest(3)).toBe(false);
    expect(isZoomRequest('bigger')).toBe(false);
    expect(stepZoom(1, 1.05)).toBe(1);
  });
});
