/**
 * UTF-8 without the platform's TextEncoder (core runs on plain ECMAScript, docs/05 §2): list and
 * bookkeeping files travel to Drive as bytes.
 */

export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0) ?? 0;
    // A lone surrogate is written as U+FFFD, as TextEncoder does.
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
}

/** Decodes UTF-8; invalid sequences become U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  const chunk: number[] = [];
  const flush = (): void => {
    out += String.fromCodePoint(...chunk);
    chunk.length = 0;
  };
  const cont = (at: number): number | null => {
    const byte = bytes[at];
    return byte !== undefined && (byte & 0xc0) === 0x80 ? byte & 0x3f : null;
  };
  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    let code = 0xfffd;
    let length = 1;
    if (first < 0x80) {
      code = first;
    } else if (first >= 0xc2 && first < 0xe0) {
      const a = cont(index + 1);
      if (a !== null) {
        code = ((first & 0x1f) << 6) | a;
        length = 2;
      }
    } else if (first >= 0xe0 && first < 0xf0) {
      const a = cont(index + 1);
      const b = cont(index + 2);
      if (a !== null && b !== null) {
        const value = ((first & 0x0f) << 12) | (a << 6) | b;
        if (value >= 0x800 && (value < 0xd800 || value > 0xdfff)) {
          code = value;
          length = 3;
        }
      }
    } else if (first >= 0xf0 && first < 0xf5) {
      const a = cont(index + 1);
      const b = cont(index + 2);
      const c = cont(index + 3);
      if (a !== null && b !== null && c !== null) {
        const value = ((first & 0x07) << 18) | (a << 12) | (b << 6) | c;
        if (value >= 0x10000 && value <= 0x10ffff) {
          code = value;
          length = 4;
        }
      }
    }
    chunk.push(code);
    if (chunk.length >= 4096) flush();
    index += length;
  }
  flush();
  return out;
}
