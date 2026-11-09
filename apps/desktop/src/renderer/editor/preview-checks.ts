import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { buildPreview, type PreviewItem } from './preview.js';
import { NOTE_SYNTAX } from './syntax.js';

/**
 * Checks on the live preview's items, shared by its tests (D-141 Q13). Test code: never imported by
 * the app. Problems name node kinds and offsets only, never the text (real notes, Q2).
 */

/** An editor state as the note editor parses it (the whole text parsed). */
export function noteState(
  doc: string,
  anchor = 0,
  head = anchor,
  extra: readonly Extension[] = [],
): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] }), ...extra],
  });
  parseFully(state);
  return state;
}

/**
 * D-156: the whole document parsed, however long it takes. A time budget (`ensureSyntaxTree`'s
 * third argument) on a busy machine left a test with half a syntax tree, the budget's failure
 * unnoticed: no table found, a cell or a marker missing.
 */
export function parseFully(state: EditorState): void {
  if (!ensureSyntaxTree(state, state.doc.length, Infinity))
    throw new Error('the syntax tree could not be parsed');
}

export const preview = (state: EditorState, focused: boolean): PreviewItem[] =>
  buildPreview({ state, focused, patterns: [] });

/** Kinds that take the place of their text: CodeMirror can't draw them across a line break. */
const REPLACING = new Set<PreviewItem['kind']>([
  'hide',
  'bullet',
  'checkbox',
  'field',
  'shortLink',
]);

/** What a drawn editor depends on; the problem as text, or null. */
export function itemProblem(state: EditorState, item: PreviewItem): string | null {
  const { doc } = state;
  if ('at' in item) {
    if (item.at < 0 || item.at > doc.length) return `${item.kind} outside the text`;
    if (item.kind === 'line' && doc.lineAt(item.at).from !== item.at)
      return `line class not at a line start (${item.at})`;
    return null;
  }
  if (item.from < 0 || item.to > doc.length || item.from > item.to)
    return `${item.kind} ${item.from}-${item.to} outside the text`;
  const replacing = REPLACING.has(item.kind) || (item.kind === 'image' && item.replace);
  if (replacing && doc.lineAt(item.from).number !== doc.lineAt(item.to).number)
    return `${item.kind} ${item.from}-${item.to} replaces a line break`;
  return null;
}

export const problems = (state: EditorState, items: readonly PreviewItem[]): string[] =>
  items.flatMap((item) => itemProblem(state, item) ?? []);

/** Without focus, what the syntax tree says must be drawn is drawn. */
export function treeProblems(state: EditorState, items: readonly PreviewItem[]): string[] {
  const found: string[] = [];
  const has = (test: (item: PreviewItem) => boolean): boolean => items.some(test);
  const styled: Record<string, string> = {
    Emphasis: 'cm-fl-em',
    StrongEmphasis: 'cm-fl-strong',
    Strikethrough: 'cm-fl-strike',
    Highlight: 'cm-fl-highlight',
    InlineCode: 'cm-fl-inline-code',
  };
  syntaxTree(state).iterate({
    enter: (node): false | undefined => {
      const { name, from, to } = node;
      // What an image's alt text holds is covered by the picture (a multi-line one shows raw).
      for (let up = node.node.parent; up; up = up.parent) if (up.name === 'Image') return false;
      const className = styled[name];
      if (
        className &&
        !has(
          (i) => i.kind === 'mark' && i.className === className && i.from === from && i.to === to,
        )
      )
        found.push(`${name} ${from}-${to} not styled`);
      const hidden = (): boolean => has((i) => i.kind === 'hide' && i.from <= from && i.to >= to);
      if (
        (['EmphasisMark', 'StrikethroughMark', 'HighlightMark'].includes(name) ||
          (name === 'CodeMark' && node.node.parent?.name === 'InlineCode')) &&
        !hidden()
      )
        found.push(`${name} ${from}-${to} not hidden`);
      if (name === 'TaskMarker' && !has((i) => i.kind === 'checkbox' && i.from === from))
        found.push(`TaskMarker ${from} not a checkbox`);
      if (
        name === 'ListMark' &&
        node.node.parent?.parent?.name === 'BulletList' &&
        !node.node.parent.getChild('Task') &&
        !has((i) => i.kind === 'bullet' && i.from === from)
      )
        found.push(`ListMark ${from} not a bullet`);
      if (name === 'Image' && !has((i) => i.kind === 'image' && i.replace && i.from === from))
        found.push(`Image ${from} not drawn`);
      if (name === 'HeaderMark' && node.node.parent?.name.startsWith('ATXHeading') && !hidden())
        found.push(`HeaderMark ${from} not hidden`);
      return undefined;
    },
  });
  return found;
}
