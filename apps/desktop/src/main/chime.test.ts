import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REM-06, D-95, D-96: the bundled chime is Davit's file and the source of truth. Nothing in the
 * build or the tests regenerates it (scripts/make-chime.mjs refuses to write over it); this check
 * fails if anything does. Replaced on purpose: update the hash here and the note in D-96.
 */
const CHIME_SHA256 = 'a4a96c6a23747e1a51c009833b2eb6b67e949599150e9c23825e1dd197702111';

describe('the bundled reminder chime (REM-06, D-96)', () => {
  it('is the file Davit chose, unchanged', async () => {
    const file = await readFile(
      join(import.meta.dirname, '../renderer/main-window/sounds/chime.wav'),
    );
    expect(file.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(file.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(createHash('sha256').update(file).digest('hex')).toBe(CHIME_SHA256);
  });
});
