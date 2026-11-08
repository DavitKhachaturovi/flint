import { readFileSync } from 'node:fs';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { noteState, preview } from './preview-checks.js';
import { blockMarkers, type PreviewItem } from './preview.js';

/**
 * The reveal rule (D-141 Q3) on every CommonMark and GFM example at every caret position: block
 * markers and embedded objects stay drawn unless an empty caret is strictly inside them; inline
 * formatting shows raw exactly while the caret is inside it or at its edge; a selection reveals
 * nothing; numbered markers are plain text in the note's font (Davit, after testing 1.1.0).
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
const EXAMPLES = [
  ...fixture('commonmark-0.31.2.json'),
  ...fixture('gfm-0.29-extensions.json').map((each) => ({
    ...each,
    section: `GFM ${each.section}`,
  })),
];

/** Is the range [from, to) shown as raw markdown by these items? (Nothing hides or replaces it.) */
function drawn(items: readonly PreviewItem[], from: number, to: number): boolean {
  return items.some(
    (item) =>
      !('at' in item) &&
      item.kind !== 'mark' &&
      !(item.kind === 'image' && !item.replace) &&
      item.from < to &&
      item.to > from,
  );
}

/** What's wrong with the reveal rule for this state; offsets and kinds only. */
function revealProblems(state: EditorState): string[] {
  const found: string[] = [];
  const items = preview(state, true);
  const selection = state.selection.main;
  const caret = selection.empty ? selection.head : null;
  for (const marker of blockMarkers(state)) {
    const inside = caret !== null && caret > marker.from && caret < marker.to;
    if (marker.kind === 'number') {
      // Plain text in the note's font, with the caret on its line or not: nothing touches it.
      const touched = items.some(
        (i) =>
          !('at' in i) &&
          i.from < marker.to &&
          i.to > marker.from &&
          !(i.kind === 'mark' && i.from < marker.from),
      );
      if (touched) found.push(`number ${marker.from} styled, hidden or replaced`);
      continue;
    }
    const isDrawn = drawn(items, marker.from, marker.to);
    if (inside && isDrawn)
      found.push(`${marker.kind} ${marker.from}-${marker.to} drawn with the caret inside`);
    if (!inside && !isDrawn)
      found.push(`${marker.kind} ${marker.from}-${marker.to} raw with the caret outside`);
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!['EmphasisMark', 'StrikethroughMark', 'HighlightMark'].includes(node.name)) {
        if (node.name !== 'CodeMark' || node.node.parent?.name !== 'InlineCode') return;
      }
      const span = node.node.parent;
      if (!span) return;
      for (let up = span.parent; up; up = up.parent) if (up.name === 'Image') return;
      const atOrIn = caret !== null && caret >= span.from && caret <= span.to;
      const hidden = drawn(items, node.from, node.to);
      if (atOrIn && hidden)
        found.push(`${node.name} ${node.from} hidden with the caret at its span`);
      if (!atOrIn && !hidden) found.push(`${node.name} ${node.from} raw with the caret away`);
    },
  });
  return found;
}

describe('the reveal rule (D-141 Q3)', () => {
  it('holds at every caret position of every spec example', () => {
    const failures = new Set<string>();
    for (const each of EXAMPLES) {
      const base = noteState(each.markdown);
      for (let at = 0; at <= base.doc.length; at++) {
        const state = base.update({ selection: { anchor: at } }).state;
        for (const problem of revealProblems(state))
          failures.add(`example ${each.example} (${each.section}), caret ${at}: ${problem}`);
      }
    }
    expect([...failures].slice(0, 40)).toEqual([]);
  });

  it('reveals nothing for a selection', () => {
    const failures = new Set<string>();
    for (const each of EXAMPLES) {
      const base = noteState(each.markdown);
      const length = base.doc.length;
      for (let at = 0; at + 2 <= length; at += 2) {
        const state = base.update({ selection: EditorSelection.single(at, at + 2) }).state;
        const unfocused = preview(state, false).filter(
          (i) => i.kind !== 'mark' && i.kind !== 'line',
        );
        const focused = preview(state, true).filter((i) => i.kind !== 'mark' && i.kind !== 'line');
        if (JSON.stringify(focused) !== JSON.stringify(unfocused))
          failures.add(`example ${each.example} (${each.section}), selection ${at}-${at + 2}`);
      }
    }
    expect([...failures].slice(0, 40)).toEqual([]);
  });

  it('steps into a bullet, a heading and a picture only with the caret strictly inside', () => {
    const doc = '- item\n## Head\n![p](attachments/image-01.png)';
    const at = (caret: number): PreviewItem[] => preview(noteState(doc, caret), true);
    // The caret at the item's text (after `- `): the bullet stays drawn.
    expect(at(2).some((i) => i.kind === 'bullet')).toBe(true);
    // Between `-` and its space: raw.
    expect(at(1).some((i) => i.kind === 'bullet')).toBe(false);
    // At the heading's text (after `## `): its marks stay hidden; between them, raw.
    expect(drawn(at(10), 7, 10)).toBe(true);
    expect(drawn(at(8), 7, 10)).toBe(false);
    // Right before and right after the picture: drawn; inside its markdown: raw.
    expect(at(15).some((i) => i.kind === 'image' && i.replace)).toBe(true);
    expect(at(doc.length).some((i) => i.kind === 'image' && i.replace)).toBe(true);
    expect(at(18).some((i) => i.kind === 'image' && i.replace)).toBe(false);
  });
});
