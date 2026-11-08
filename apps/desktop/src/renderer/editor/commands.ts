import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * The note editor's formatting commands (M5, NOTE-02, NOTE-03, D-72, D-82): one set for the
 * right-click menu and the slash menu. Each changes the markdown text, nothing else; undo takes any
 * of them back in one step.
 */

export type CommandSection = 'format' | 'paragraph' | 'insert';

export interface EditorCommand {
  readonly id: string;
  readonly label: string;
  /** The slash menu's word (NOTE-03): `/code`. */
  readonly word: string;
  readonly section: CommandSection;
  /** A key shown in the right-click menu. */
  readonly hint?: string;
  /** The slash menu's tile: a short glyph in mono, or an icon (constant SVG markup). */
  readonly glyph: string;
  readonly run: (view: EditorView, host: CommandHost) => void;
}

/** What a command needs from outside the editor. */
export interface CommandHost {
  /** Insert ▸ Image (D-82): the Windows file picker; the picture copied into attachments/. */
  readonly pickImage: () => Promise<string | null>;
}

const LINK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>';
const IMAGE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="m3.5 17 5-5 4 4 2.5-2.5 5.5 5.5"></path><circle cx="15.5" cy="9" r="1.5"></circle></svg>';
const TABLE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M3 15h18M10 4v16"></path></svg>';
const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="m8.5 12 2.5 2.5 4.5-5"></path></svg>';

/** The marks a format wraps text in. */
const MARKS = {
  bold: '**',
  italic: '*',
  strike: '~~',
  highlight: '==',
  code: '`',
} as const;

/**
 * Wraps each selection (or the word at the cursor) in `mark`, or unwraps it when it already has
 * that format; with nothing there, inserts the marks with the cursor between them.
 */
function toggleWrap(view: EditorView, mark: string): void {
  const { state } = view;
  const doc = state.doc;
  const transaction = state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const before = doc.sliceString(from - mark.length, from);
    const after = doc.sliceString(to, to + mark.length);
    // `*` must not count the inside of a `**`.
    const single = mark.length === 1;
    const wrapped =
      before === mark &&
      after === mark &&
      (!single ||
        (doc.sliceString(from - 2, from - 1) !== mark && doc.sliceString(to + 1, to + 2) !== mark));
    if (wrapped) {
      return {
        changes: [
          { from: from - mark.length, to: from },
          { from: to, to: to + mark.length },
        ],
        range: EditorSelection.range(from - mark.length, to - mark.length),
      };
    }
    const inner = doc.sliceString(from, to);
    if (inner.length >= mark.length * 2 && inner.startsWith(mark) && inner.endsWith(mark)) {
      return {
        changes: { from, to, insert: inner.slice(mark.length, inner.length - mark.length) },
        range: EditorSelection.range(from, to - mark.length * 2),
      };
    }
    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range:
        from === to
          ? EditorSelection.cursor(from + mark.length)
          : EditorSelection.range(from + mark.length, to + mark.length),
    };
  });
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
}

/** Clear formatting: the inline marks in the selection go; links keep their text. */
function clearFormatting(view: EditorView): void {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    const from = range.empty ? state.doc.lineAt(range.from).from : range.from;
    const to = range.empty ? state.doc.lineAt(range.to).to : range.to;
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (
          ['EmphasisMark', 'StrikethroughMark', 'HighlightMark'].includes(node.name) ||
          (node.name === 'CodeMark' && node.node.parent?.name === 'InlineCode')
        )
          changes.push({ from: node.from, to: node.to });
        if (node.name === 'Link') {
          const marks = node.node.getChildren('LinkMark');
          const open = marks[0];
          const close = marks[1];
          if (open && close)
            changes.push({ from: open.from, to: open.to }, { from: close.from, to: node.to });
          return false;
        }
        return undefined;
      },
    });
  }
  if (changes.length > 0) view.dispatch({ changes, userEvent: 'input.format' });
  view.focus();
}

/** A line's markdown prefix: its indentation, then a heading, quote, checkbox, bullet or number. */
const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

type LineKind = 'bullet' | 'number' | 'task' | 'h1' | 'h2' | 'h3' | 'body' | 'quote';

/** Paragraph ▸ (NOTE-02): the selected lines become this kind, replacing what they were. */
function setLineKind(view: EditorView, kind: LineKind): void {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  let count = 0;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let at = first; at <= last; at++) {
      if (seen.has(at)) continue;
      seen.add(at);
      const line = state.doc.line(at);
      const match = PREFIX.exec(line.text);
      const indent = match?.[1] ?? '';
      const old = match?.[2] ?? '';
      count++;
      const prefix =
        kind === 'bullet'
          ? '- '
          : kind === 'number'
            ? `${count}. `
            : kind === 'task'
              ? '- [ ] '
              : kind === 'h1'
                ? '# '
                : kind === 'h2'
                  ? '## '
                  : kind === 'h3'
                    ? '### '
                    : kind === 'quote'
                      ? '> '
                      : '';
      // Headings stand at the line's start, without indentation.
      const lead = kind.startsWith('h') ? '' : indent;
      changes.push({
        from: line.from,
        to: line.from + indent.length + old.length,
        insert: lead + prefix,
      });
    }
  }
  // A cursor where a prefix goes in ends up after it, ready to type.
  const set = state.changes(changes);
  view.dispatch({
    changes: set,
    selection: state.selection.map(set, 1),
    // D-141 Q6: a structural edit (a numbered list it touches is renumbered).
    userEvent: 'input.format.line',
  });
  view.focus();
}

/** A block on lines of its own at the cursor; `caret` is where the cursor goes inside it. */
export function insertBlock(view: EditorView, raw: string, caret?: number): void {
  // D-91: the editor keeps `\n` only; a `\r` would put the caret past the end (and throw).
  const block = raw.replace(/\r\n?/g, '\n');
  const at = Math.min(caret ?? block.length, block.length);
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, from - 2), from);
  const after = doc.sliceString(to, to + 1);
  const lead = from === 0 || before === '\n\n' ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after === '\n' ? '' : '\n';
  view.dispatch({
    changes: { from, to, insert: lead + block + trail },
    selection: { anchor: from + lead.length + at },
    scrollIntoView: true,
    userEvent: 'input.format',
  });
  view.focus();
}

/** Insert ▸ Link: the selection as the link's text, the cursor in its address. */
function insertLink(view: EditorView): void {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + (text === '' ? 1 : insert.length - 1)),
    };
  });
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }));
  view.focus();
}

const TABLE = '| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |';

export const EDITOR_COMMANDS: readonly EditorCommand[] = [
  {
    id: 'bold',
    label: 'Bold',
    word: 'bold',
    section: 'format',
    hint: 'Ctrl+B',
    glyph: 'B',
    run: (view) => toggleWrap(view, MARKS.bold),
  },
  {
    id: 'italic',
    label: 'Italic',
    word: 'italic',
    section: 'format',
    hint: 'Ctrl+I',
    glyph: 'I',
    run: (view) => toggleWrap(view, MARKS.italic),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    word: 'strike',
    section: 'format',
    glyph: 'S',
    run: (view) => toggleWrap(view, MARKS.strike),
  },
  {
    id: 'highlight',
    label: 'Highlight',
    word: 'highlight',
    section: 'format',
    glyph: 'H',
    run: (view) => toggleWrap(view, MARKS.highlight),
  },
  {
    id: 'code',
    label: 'Code',
    // D-106, D-141 Q5.
    hint: 'Ctrl+E',
    word: 'code',
    section: 'format',
    glyph: '`',
    run: (view) => toggleWrap(view, MARKS.code),
  },
  {
    id: 'clear',
    label: 'Clear formatting',
    word: 'clear',
    section: 'format',
    glyph: 'Tx',
    run: clearFormatting,
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    word: 'bullet',
    section: 'paragraph',
    glyph: '•',
    run: (view) => setLineKind(view, 'bullet'),
  },
  {
    id: 'number',
    label: 'Numbered list',
    word: 'number',
    section: 'paragraph',
    glyph: '1.',
    run: (view) => setLineKind(view, 'number'),
  },
  {
    id: 'task',
    label: 'Task list',
    word: 'check',
    section: 'paragraph',
    glyph: CHECK_ICON,
    run: (view) => setLineKind(view, 'task'),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    word: 'h1',
    section: 'paragraph',
    glyph: 'H1',
    run: (view) => setLineKind(view, 'h1'),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    word: 'h2',
    section: 'paragraph',
    glyph: 'H2',
    run: (view) => setLineKind(view, 'h2'),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    word: 'h3',
    section: 'paragraph',
    glyph: 'H3',
    run: (view) => setLineKind(view, 'h3'),
  },
  {
    id: 'body',
    label: 'Body',
    word: 'body',
    section: 'paragraph',
    glyph: '¶',
    run: (view) => setLineKind(view, 'body'),
  },
  {
    id: 'quote',
    label: 'Quote',
    word: 'quote',
    section: 'paragraph',
    glyph: '"',
    run: (view) => setLineKind(view, 'quote'),
  },
  { id: 'link', label: 'Link', word: 'link', section: 'insert', glyph: LINK_ICON, run: insertLink },
  {
    id: 'image',
    label: 'Image',
    word: 'image',
    section: 'insert',
    glyph: IMAGE_ICON,
    run: (view, host) => {
      void host.pickImage().then((link) => {
        if (link) insertBlock(view, `![](${link})`);
        else view.focus();
      });
    },
  },
  {
    id: 'table',
    label: 'Table',
    word: 'table',
    section: 'insert',
    glyph: TABLE_ICON,
    run: (view) => insertBlock(view, TABLE, TABLE.length - 7),
  },
  {
    id: 'codeblock',
    label: 'Code block',
    word: 'codeblock',
    section: 'insert',
    glyph: '{ }',
    run: (view) => insertBlock(view, '```\n\n```', 4),
  },
  {
    id: 'rule',
    label: 'Horizontal rule',
    word: 'rule',
    section: 'insert',
    glyph: '—',
    run: (view) => insertBlock(view, '---'),
  },
];

export const SECTION_LABELS: Readonly<Record<CommandSection, string>> = {
  format: 'Format',
  paragraph: 'Paragraph',
  insert: 'Insert',
};

/** Whether `pos` is inside code (a fenced or indented block, or inline code): no slash menu there. */
export function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(
      state,
    ).resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText'].includes(node.name)) return true;
  return false;
}
