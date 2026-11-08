import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noteState, preview, problems, treeProblems } from './preview-checks.js';

/**
 * The live preview on the CommonMark 0.31.2 examples and GFM's extension examples (D-141 Q13):
 * checked against the syntax tree without focus, and at every caret position with focus for the
 * invariants a drawn editor depends on.
 */

interface Example {
  readonly example: number;
  readonly section: string;
  readonly markdown: string;
}
const fixture = (name: string): Example[] =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/spec/${name}`, import.meta.url), 'utf8'),
  ) as Example[];
const COMMONMARK = fixture('commonmark-0.31.2.json');
const GFM = fixture('gfm-0.29-extensions.json');

describe.each([
  ['CommonMark 0.31.2', COMMONMARK],
  ['GFM 0.29 extensions', GFM],
])('the live preview on %s (D-141 Q13)', (_name, examples) => {
  it('draws what the syntax tree holds, without focus', () => {
    const failures: string[] = [];
    for (const each of examples) {
      const state = noteState(each.markdown);
      const items = preview(state, false);
      for (const problem of [...problems(state, items), ...treeProblems(state, items)])
        failures.push(`example ${each.example} (${each.section}): ${problem}`);
    }
    expect(failures).toEqual([]);
  });

  it('stays drawable with the caret at every position', () => {
    const failures: string[] = [];
    for (const each of examples) {
      const base = noteState(each.markdown);
      for (let at = 0; at <= base.doc.length; at++) {
        const state = base.update({ selection: { anchor: at } }).state;
        for (const problem of problems(state, preview(state, true)))
          failures.push(`example ${each.example} (${each.section}), caret ${at}: ${problem}`);
      }
    }
    expect([...new Set(failures)]).toEqual([]);
  });
});
