import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Flint's additions to CodeMirror's markdown parser (GFM), shared by the note editor, its tests and
 * the outline (so they read a note alike). No DOM.
 */

/** `==highlight==`, as in Obsidian (NOTE-02, D-72): the same rules as `~~strikethrough~~`. */
const PUNCTUATION = /[!-/:-@[-`{-~¡-¿]/;
const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.special(tags.content) } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = PUNCTUATION.test(before);
        const punctAfter = PUNCTUATION.test(after);
        return cx.addDelimiter(
          highlightDelimiter,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
      after: 'Emphasis',
    },
  ],
};

/**
 * Numbered lines start lists (D-141 Q4, docs/04 §4): a line `N.` or `N)` followed by a space ends
 * the paragraph above it, so it starts or continues a list as in Obsidian's editor (a bare `2.`
 * waits for its space, so typing it doesn't flip the line). CommonMark lets only `1.` interrupt a paragraph; GitHub and Obsidian's Reading view show
 * `text` + `2. item` as one paragraph (a known difference). Display only: the file never changes.
 */
export const NumberedLines: MarkdownConfig = {
  parseBlock: [
    {
      name: 'NumberedLine',
      parse: () => false,
      endLeaf: (_cx, line, leaf) =>
        leaf.content !== '' &&
        line.indent < line.baseIndent + 4 &&
        /^\d{1,9}[.)][ \t]/.test(line.text.slice(line.pos)),
    },
  ],
};

/** The extensions every Flint markdown parser uses. */
export const NOTE_SYNTAX: readonly MarkdownConfig[] = [Highlight, NumberedLines];
