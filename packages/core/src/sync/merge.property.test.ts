/**
 * Never lose either side (SYNC-01, D-161 Q5): whatever two PCs do to a text, every line either of
 * them added is in the merge, and resolving each conflict as "mine" keeps every line this PC added.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findConflicts, resolveConflict } from './conflict.js';
import { mergeText } from './text-merge.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
const labels = { mine: 'WORK-PC', theirs: 'DAVIT-LAPTOP', when: '10 Nov 14:02' };
const line = fc.constantFrom<string>('a', 'b', 'c', 'd', '', '# Head', '- item', '```', 'x y');
const lines = fc.array(line, { maxLength: 12 });

/** An edit: replace a range of lines with new ones. */
const edited = (base: string[]) =>
  fc
    .record({
      at: fc.nat({ max: base.length }),
      remove: fc.nat({ max: 3 }),
      insert: fc.array(fc.constantFrom('m1', 'm2', 'n1', 'n2', ''), { maxLength: 3 }),
    })
    .map(({ at, remove, insert }) => [...base.slice(0, at), ...insert, ...base.slice(at + remove)]);

describe('mergeText never loses a line (SYNC-01)', () => {
  it('keeps every added line of both sides', () => {
    fc.assert(
      fc.property(
        lines.chain((base) => fc.tuple(fc.constant(base), edited(base), edited(base))),
        ([base, mine, theirs]) => {
          const join = (text: string[]) => (text.length > 0 ? text.join('\n') + '\n' : '');
          const result = mergeText(join(base), join(mine), join(theirs), labels).text;
          const out = result.split('\n').map((entry) => entry.replace(/^> ?/, ''));
          for (const added of [...mine, ...theirs].filter((entry) => !base.includes(entry))) {
            expect(out).toContain(added);
          }
          // Taking "mine" for every conflict keeps every line this PC added.
          let resolved = result;
          while (findConflicts(resolved.split('\n')).length > 0)
            resolved = resolveConflict(resolved, 0, 'mine');
          const kept = resolved.split('\n');
          for (const entry of mine.filter((entry) => entry !== '' && !base.includes(entry)))
            expect(kept).toContain(entry);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
