import { describe, expect, it } from 'vitest';
import { expectLinear } from '../../test/scaling.js';
import { parseDocument, serializeDocument } from '../format/document.js';
import { applyPersonal, splitPersonal } from './personal.js';

/**
 * SPACE-09 (D-146, D-156): a line can't make the personal-field split slow. Your fields' text is
 * looked for in a line, and another member's line may hold the same text many times over (in code
 * spans, as title text): the work stays linear in the line's length.
 */
const header = '---\nflint: 1\nid: gro1\nmode: tasks\n---\n';

/** A task line with `n` characters of code spans and title text that look like your fields. */
function crowded(n: number): string {
  const noise = '`[pinned:: true]` `[muted:: true]` `[reminder:: 2026-03-11]` [pinned:: true] ';
  return `- [ ] ${noise.repeat(Math.ceil(n / noise.length))}x [today:: true] [muted:: true] [reminder:: 2026-03-11] [id:: ab01]`;
}

describe('the personal-field split, timed (SPACE-09, D-156)', () => {
  const size = 20_000;

  it('splitting a crowded line grows linearly with it', () => {
    expect(crowded(size).length).toBeGreaterThanOrEqual(size);
    expectLinear(
      (n) => parseDocument(`${header}${crowded(n)}\n`),
      (document) => {
        splitPersonal(document);
      },
      size,
    );
  }, 60_000);

  it('applying your fields to someone’s crowded line grows linearly with it', () => {
    const { mine } = splitPersonal(
      parseDocument(`${header}- [ ] x [pinned:: true] [muted:: true] [id:: ab01]\n`),
    );
    expectLinear(
      (n) => splitPersonal(parseDocument(`${header}${crowded(n)}\n`)).shared,
      (shared) => {
        serializeDocument(applyPersonal(shared, mine));
      },
      size,
    );
  }, 60_000);
});
