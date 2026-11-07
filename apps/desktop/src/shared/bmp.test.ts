import { describe, expect, it } from 'vitest';
import { decodeBmp, shrink } from './bmp.js';

/** A BMP: `rows` top row first, each pixel [b, g, r, a]; bottom-up unless `topDown`. */
function bmp(
  rows: readonly (readonly (readonly number[])[])[],
  options: { bits?: 24 | 32; topDown?: boolean; bitfields?: boolean } = {},
): Uint8Array {
  const bits = options.bits ?? 32;
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const offset = 14 + 40 + (options.bitfields ? 12 : 0);
  const bytes = new Uint8Array(offset + stride * height);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, options.topDown ? -height : height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bits, true);
  view.setUint32(30, options.bitfields ? 3 : 0, true);
  if (options.bitfields) {
    view.setUint32(54, 0x00ff0000, true);
    view.setUint32(58, 0x0000ff00, true);
    view.setUint32(62, 0x000000ff, true);
  }
  rows.forEach((row, y) => {
    const line = options.topDown ? y : height - 1 - y;
    row.forEach((pixel, x) => {
      const at = offset + line * stride + x * (bits / 8);
      for (let channel = 0; channel < bits / 8; channel++)
        bytes[at + channel] = pixel[channel] ?? 0;
    });
  });
  return bytes;
}

const RED = [0, 0, 255, 255];
const BLUE = [255, 0, 0, 255];

describe('clipboard pictures as Windows hands them over (NAV-08, D-129)', () => {
  it('reads a 32-bit bottom-up BMP, top row first; an all-zero alpha is opaque', () => {
    const picture = decodeBmp(
      bmp([
        [
          [0, 0, 255, 0],
          [255, 0, 0, 0],
        ],
        [
          [0, 255, 0, 0],
          [9, 9, 9, 0],
        ],
      ]),
    );
    expect(picture?.width).toBe(2);
    expect(picture?.height).toBe(2);
    expect([...(picture?.data.subarray(0, 8) ?? [])]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
    expect([...(picture?.data.subarray(8, 12) ?? [])]).toEqual([0, 255, 0, 255]);
  });

  it('reads 24-bit (padded rows), top-down and bit-mask BMPs; refuses what isn’t one', () => {
    const three = decodeBmp(bmp([[RED, BLUE, RED]], { bits: 24 }));
    expect([...(three?.data.subarray(4, 8) ?? [])]).toEqual(BLUE);
    const down = decodeBmp(bmp([[RED], [BLUE]], { topDown: true }));
    expect([...(down?.data.subarray(0, 4) ?? [])]).toEqual(RED);
    const masked = decodeBmp(bmp([[RED]], { bitfields: true }));
    expect([...(masked?.data.subarray(0, 3) ?? [])]).toEqual([0, 0, 255]);
    expect(decodeBmp(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('shrinks to fit, averaging, never enlarging', () => {
    const picture = decodeBmp(
      bmp([
        [RED, BLUE, RED, BLUE],
        [RED, BLUE, RED, BLUE],
      ]),
    );
    if (!picture) throw new Error('no picture');
    const small = shrink(picture, 2, 10);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect([...small.data.subarray(0, 4)]).toEqual([128, 0, 128, 255]);
    expect(shrink(picture, 100, 100)).toBe(picture);
  });
});
