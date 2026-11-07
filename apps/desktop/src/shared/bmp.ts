/**
 * NAV-08, D-129: Windows hands clipboard history pictures over as BMP files, which Electron's
 * `nativeImage` can't open. This reads the kinds Windows uses (24 or 32 bits a pixel, uncompressed
 * or with the standard bit masks, bottom-up or top-down) into BGRA pixels, top row first (the
 * order `nativeImage.createFromBitmap` takes on Windows), and shrinks a picture to a thumbnail.
 */

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** BGRA, 4 bytes a pixel, top row first. */
  readonly data: Uint8Array;
}

const BI_RGB = 0;
const BI_BITFIELDS = 3;
/** Larger than any picture Windows keeps in the history (4 MB). */
const MAX_PIXELS = 64 * 1024 * 1024;

/** The picture in `bytes`, or null when it isn't a BMP this reads. */
export function decodeBmp(bytes: Uint8Array): Pixels | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  if (headerSize < 40) return null;
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width <= 0 || height === 0 || width * height > MAX_PIXELS) return null;
  if (bits !== 24 && bits !== 32) return null;
  if (compression !== BI_RGB && !(compression === BI_BITFIELDS && bits === 32)) return null;
  // BI_BITFIELDS: the masks follow a 40-byte header, or sit inside a larger one (V4, V5).
  let masks = { red: 0x00ff0000, green: 0x0000ff00, blue: 0x000000ff, alpha: 0xff000000 };
  if (compression === BI_BITFIELDS) {
    const at = 14 + 40;
    if (bytes.length < at + 12) return null;
    masks = {
      red: view.getUint32(at, true),
      green: view.getUint32(at + 4, true),
      blue: view.getUint32(at + 8, true),
      alpha: headerSize >= 56 && bytes.length >= at + 16 ? view.getUint32(at + 12, true) : 0,
    };
  }
  const stride = Math.ceil((width * bits) / 32) * 4;
  if (offset + stride * height > bytes.length) return null;
  const shift = (mask: number): number => (mask === 0 ? 0 : 31 - Math.clz32(mask & -mask));
  const scale = (mask: number): number => (mask === 0 ? 0 : 255 / (mask >>> shift(mask)));
  const channels = [masks.blue, masks.green, masks.red, masks.alpha].map((mask) => ({
    mask: mask >>> 0,
    shift: shift(mask >>> 0),
    scale: scale(mask >>> 0),
  }));
  const data = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let row = 0; row < height; row++) {
    const source = offset + (topDown ? row : height - 1 - row) * stride;
    for (let x = 0; x < width; x++) {
      const to = (row * width + x) * 4;
      if (bits === 24) {
        const from = source + x * 3;
        data[to] = bytes[from] ?? 0;
        data[to + 1] = bytes[from + 1] ?? 0;
        data[to + 2] = bytes[from + 2] ?? 0;
        data[to + 3] = 255;
        continue;
      }
      const pixel = view.getUint32(source + x * 4, true);
      for (let channel = 0; channel < 4; channel++) {
        const {
          mask,
          shift: by,
          scale: times,
        } = channels[channel] ?? { mask: 0, shift: 0, scale: 0 };
        data[to + channel] = mask === 0 ? 0 : Math.round(((pixel & mask) >>> by) * times);
      }
      if ((data[to + 3] ?? 0) !== 0) anyAlpha = true;
    }
  }
  // A 32-bit picture whose alpha is all zero (as screenshots come) is opaque, not invisible.
  if (bits === 32 && !anyAlpha) for (let at = 3; at < data.length; at += 4) data[at] = 255;
  return { width, height, data };
}

/**
 * The picture shrunk to fit `maxWidth` × `maxHeight` (never enlarged), each pixel the average of
 * the ones it covers.
 */
export function shrink(picture: Pixels, maxWidth: number, maxHeight: number): Pixels {
  const ratio = Math.min(1, maxWidth / picture.width, maxHeight / picture.height);
  if (ratio === 1) return picture;
  const width = Math.max(1, Math.round(picture.width * ratio));
  const height = Math.max(1, Math.round(picture.height * ratio));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * picture.height) / height);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * picture.height) / height));
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * picture.width) / width);
      const right = Math.max(left + 1, Math.floor(((x + 1) * picture.width) / width));
      const sum = [0, 0, 0, 0];
      for (let sy = top; sy < bottom; sy++)
        for (let sx = left; sx < right; sx++) {
          const from = (sy * picture.width + sx) * 4;
          for (let channel = 0; channel < 4; channel++)
            sum[channel] = (sum[channel] ?? 0) + (picture.data[from + channel] ?? 0);
        }
      const count = (bottom - top) * (right - left);
      const to = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++)
        data[to + channel] = Math.round((sum[channel] ?? 0) / count);
    }
  }
  return { width, height, data };
}
