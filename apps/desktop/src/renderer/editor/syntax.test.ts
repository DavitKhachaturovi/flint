import { readFileSync } from 'node:fs';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Tree } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { Highlight, NOTE_SYNTAX } from './syntax.js';

/**
 * D-141 Q4: numbered lines start lists. Where Flint's parser deliberately reads the spec examples
 * differently from CommonMark, the examples are listed with the reason; nothing else may change.
 */

interface Example {
  readonly example: number;
  readonly markdown: string;
}
const fixture = (name: string): Example[] =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/spec/${name}`, import.meta.url), 'utf8'),
  ) as Example[];

const base = markdownLanguage.parser as MarkdownParser;
const commonmark = base.configure([Highlight]);
const flint = base.configure([...NOTE_SYNTAX]);
const shape = (tree: Tree): string => {
  const parts: string[] = [];
  tree.iterate({ enter: (node) => void parts.push(`${node.name}@${node.from}-${node.to}`) });
  return parts.join(' ');
};

/**
 * The CommonMark examples Flint reads differently, and why: each has a line `N.` (N not 1) right
 * after a paragraph line, which CommonMark keeps in the paragraph and Flint starts a list with.
 */
const DIFFERENT: Record<number, string> = {
  304: '`14.  The number of doors…` after a paragraph line starts a list (CommonMark: one paragraph)',
};

describe('numbered lines start lists (D-141 Q4)', () => {
  it('reads the CommonMark examples as CommonMark does, except the listed ones', () => {
    const differ = fixture('commonmark-0.31.2.json')
      .filter(
        (each) => shape(commonmark.parse(each.markdown)) !== shape(flint.parse(each.markdown)),
      )
      .map((each) => each.example);
    expect(differ).toEqual(Object.keys(DIFFERENT).map(Number));
  });

  it('starts a list at any numbered line after a paragraph line, as Obsidian does', () => {
    const names = (text: string): string[] => {
      const found: string[] = [];
      flint.parse(text).iterate({ enter: (node) => void found.push(node.name) });
      return found;
    };
    expect(names('Fixed in:\n10. the parser')).toContain('OrderedList');
    expect(names('Steps\n2) second')).toContain('OrderedList');
    // Indented four spaces it stays paragraph text (a code-like continuation).
    expect(names('text\n    2. not a list')).not.toContain('OrderedList');
    // Without the extension, CommonMark keeps it in the paragraph.
    const plain: string[] = [];
    commonmark
      .parse('Fixed in:\n10. the parser')
      .iterate({ enter: (n) => void plain.push(n.name) });
    expect(plain).not.toContain('OrderedList');
  });
});
