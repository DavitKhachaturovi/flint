import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { findShortForms, linkTitle, type CompiledPattern } from '../../shared/link-patterns.js';

/**
 * The live preview's decisions as plain data (NOTE-01, D-141 Q13): what each part of the markdown
 * looks like for an editor state, its focus and the ranges on screen. No DOM and no CodeMirror view,
 * so Vitest checks it directly; `live-preview.ts` turns the items into decorations and widgets.
 */

/** One decision about a range of the text. */
export type PreviewItem =
  /** The text is not shown. */
  | { readonly kind: 'hide'; readonly from: number; readonly to: number }
  /** The text is styled (`className`); `href` makes a click open it. */
  | {
      readonly kind: 'mark';
      readonly from: number;
      readonly to: number;
      readonly className: string;
      readonly href?: string;
    }
  /** The line starting at `at` gets `className`. */
  | { readonly kind: 'line'; readonly at: number; readonly className: string }
  /** A bullet list's marker, drawn as a bullet. */
  | { readonly kind: 'bullet'; readonly from: number; readonly to: number }
  /** A task marker (`[ ]`, `[x]`), drawn as a checkbox. */
  | {
      readonly kind: 'checkbox';
      readonly from: number;
      readonly to: number;
      readonly checked: boolean;
    }
  /** An image, video or file link, shown in place of its markdown (`replace`) or after it. */
  | {
      readonly kind: 'image';
      readonly from: number;
      readonly to: number;
      readonly src: string;
      readonly alt: string;
      readonly replace: boolean;
    }
  /** One of Flint's task fields as a muted chip (LIST-04, D-77). */
  | { readonly kind: 'field'; readonly from: number; readonly to: number; readonly text: string }
  /** The code card's copy button, at the end of its first line (NOTE-05). */
  | { readonly kind: 'copy'; readonly at: number; readonly code: string }
  /** A URL shown as its short form (TASK-10, D-84). */
  | {
      readonly kind: 'shortLink';
      readonly from: number;
      readonly to: number;
      readonly text: string;
      readonly href: string;
    };

export interface PreviewInput {
  readonly state: EditorState;
  /** Without focus, everything shows formatted. */
  readonly focused: boolean;
  /** The ranges to decorate (the view's visible ranges); the whole text when omitted. */
  readonly visible?: readonly { readonly from: number; readonly to: number }[];
  /** The link patterns in use (NOTE-07). */
  readonly patterns: readonly CompiledPattern[];
}

/** Flint's task fields in a note (LIST-04, D-77): muted chips, the `id` hidden. */
const FIELD = /\s?[[(](id|priority|reminder|today|completion|muted)::\s*([^\])\n]*?)\s*[\])]/g;

/** A field's chip text: `high`, `30 Oct 15:00`, `Today`, `done 28 Oct`, `muted`. */
export function fieldText(key: string, value: string): string {
  const when = (raw: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(raw);
    if (!match) return raw;
    const month = new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleString('en-GB', {
      month: 'short',
    });
    return `${Number(match[3])} ${month}${match[4] ? ` ${match[4]}` : ''}`;
  };
  switch (key) {
    case 'reminder':
      return when(value);
    case 'completion':
      return `done ${when(value)}`;
    case 'today':
      return /^true$/i.test(value) ? 'Today' : 'not Today';
    case 'muted':
      return /^true$/i.test(value) ? 'muted' : 'not muted';
    default:
      return value;
  }
}

/** A block marker or an embedded object (D-141 Q3): drawn unless an empty caret is inside it. */
export interface BlockMarker {
  readonly kind:
    'bullet' | 'checkbox' | 'number' | 'heading' | 'quote' | 'rule' | 'image' | 'field';
  /** The marker and the space after it (`- `, `- [ ] `, `12. `, `## `, `> `), or the object. */
  readonly from: number;
  readonly to: number;
}

/** The block markers and embedded objects in these ranges (the whole text when omitted). */
export function blockMarkers(
  state: EditorState,
  visible?: readonly { readonly from: number; readonly to: number }[],
): BlockMarker[] {
  const doc = state.doc;
  const space = (at: number): number => (doc.sliceString(at, at + 1) === ' ' ? 1 : 0);
  const found: BlockMarker[] = [];
  const codeLines = new Set<number>();
  for (const { from, to } of visible ?? [{ from: 0, to: doc.length }]) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case 'FencedCode':
          case 'CodeBlock':
            for (let at = doc.lineAt(node.from).number; at <= doc.lineAt(node.to).number; at++)
              codeLines.add(at);
            return false;
          case 'HeaderMark':
            if (node.node.parent?.name.startsWith('ATXHeading'))
              found.push({ kind: 'heading', from: node.from, to: node.to + space(node.to) });
            return;
          case 'QuoteMark':
            found.push({ kind: 'quote', from: node.from, to: node.to + space(node.to) });
            return;
          case 'HorizontalRule':
            found.push({ kind: 'rule', from: node.from, to: node.to });
            return;
          case 'ListMark': {
            const item = node.node.parent;
            const task = item?.getChild('Task')?.getChild('TaskMarker');
            if (task)
              found.push({ kind: 'checkbox', from: node.from, to: task.to + space(task.to) });
            else
              found.push({
                kind: item?.parent?.name === 'OrderedList' ? 'number' : 'bullet',
                from: node.from,
                to: node.to + space(node.to),
              });
            return;
          }
          case 'Image':
            // One spanning lines (a line break in its text) always shows its markdown.
            if (doc.lineAt(node.from).number === doc.lineAt(node.to).number)
              found.push({ kind: 'image', from: node.from, to: node.to });
            return false;
          default:
            return;
        }
      },
    });
    // Flint's task fields (LIST-04, D-77), outside code.
    for (let at = doc.lineAt(from).number; at <= doc.lineAt(to).number; at++) {
      if (codeLines.has(at)) continue;
      const text = doc.line(at);
      for (const match of text.text.matchAll(FIELD)) {
        const start = text.from + match.index + (match[0].startsWith(' ') ? 1 : 0);
        found.push({ kind: 'field', from: start, to: text.from + match.index + match[0].length });
      }
    }
  }
  return found;
}

/** The live preview's items for these ranges, in no particular order. */
export function buildPreview(input: PreviewInput): PreviewItem[] {
  const { state, focused, patterns } = input;
  const doc = state.doc;
  const tree = syntaxTree(state);
  // D-141 Q3: only an empty caret reveals (a selection never does). A block marker or an object
  // shows raw only with the caret strictly inside it; inline formatting also at its edge.
  const carets = focused
    ? state.selection.ranges.filter((range) => range.empty).map((range) => range.head)
    : [];
  const strictlyInside = (from: number, to: number): boolean =>
    carets.some((caret) => caret > from && caret < to);
  const atOrInside = (from: number, to: number): boolean =>
    carets.some((caret) => caret >= from && caret <= to);
  const markers = new Map<number, BlockMarker>();
  for (const marker of blockMarkers(state, input.visible)) markers.set(marker.from, marker);
  const items: PreviewItem[] = [];
  // Line by line: CodeMirror can't hide a line break from a view plugin (a link's address can
  // start on the next line, CommonMark example 510).
  const hide = (from: number, to: number): void => {
    while (to > from) {
      const end = Math.min(to, doc.lineAt(from).to);
      if (end > from) items.push({ kind: 'hide', from, to: end });
      from = end + 1;
    }
  };
  const mark = (from: number, to: number, className: string, href?: string): void => {
    items.push({ kind: 'mark', from, to, className, ...(href !== undefined && { href }) });
  };
  const line = (at: number, className: string): void => {
    items.push({ kind: 'line', at, className });
  };
  const lines = (from: number, to: number, className: string): void => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let at = first; at <= last; at++) {
      let name = className;
      if (at === first) name += ` ${className}-first`;
      if (at === last) name += ` ${className}-last`;
      line(doc.line(at).from, name);
    }
  };
  const codeLines = new Set<number>();
  for (const { from, to } of input.visible ?? [{ from: 0, to: doc.length }]) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lines(node.from, node.to, `cm-fl-h${Math.min(3, Number(heading[1]))}`);
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            // The `#` marks and the space after them.
            const marker = markers.get(node.from);
            if (marker && !strictlyInside(marker.from, marker.to)) hide(marker.from, marker.to);
            else mark(node.from, node.to, 'cm-fl-mark');
            return;
          }
          case 'Emphasis':
            mark(node.from, node.to, 'cm-fl-em');
            return;
          case 'StrongEmphasis':
            mark(node.from, node.to, 'cm-fl-strong');
            return;
          case 'Strikethrough':
            mark(node.from, node.to, 'cm-fl-strike');
            return;
          case 'Highlight':
            mark(node.from, node.to, 'cm-fl-highlight');
            return;
          case 'InlineCode':
            mark(node.from, node.to, 'cm-fl-inline-code');
            return;
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HighlightMark':
          case 'CodeMark': {
            // Inline formatting: raw while the caret is inside its span or at its edge.
            const span = node.node.parent;
            if (!span || (name === 'CodeMark' && span.name !== 'InlineCode')) return;
            if (atOrInside(span.from, span.to)) mark(node.from, node.to, 'cm-fl-mark');
            else hide(node.from, node.to);
            return;
          }
          case 'FencedCode': {
            // A code card opens while an empty caret is in it.
            const open = atOrInside(node.from, node.to);
            lines(node.from, node.to, 'cm-fl-code');
            // Closed, the hidden closing fence is only the card's bottom edge.
            const end = doc.lineAt(node.to);
            if (
              !open &&
              end.number > doc.lineAt(node.from).number &&
              /^\s*(`{3,}|~{3,})\s*$/.test(end.text)
            )
              line(end.from, 'cm-fl-code-end');
            for (let at = doc.lineAt(node.from).number; at <= end.number; at++) codeLines.add(at);
            // D-87: closed and without a language, the opening fence is only the card's top edge
            // (no empty first line); a paragraph right after the card keeps its spacing.
            const start = doc.lineAt(node.from);
            if (!open && !node.node.getChild('CodeInfo') && start.number < end.number)
              line(start.from, 'cm-fl-code-start');
            if (end.number < doc.lines && doc.line(end.number + 1).text.trim() !== '')
              line(doc.line(end.number + 1).from, 'cm-fl-after-code');
            const text = node.node.getChild('CodeText');
            items.push({
              kind: 'copy',
              at: start.to,
              code: text ? doc.sliceString(text.from, text.to) : '',
            });
            const cursor = node.node.cursor();
            if (cursor.firstChild())
              do {
                if (cursor.name === 'CodeMark') {
                  if (open) mark(cursor.from, cursor.to, 'cm-fl-mark');
                  else hide(cursor.from, cursor.to);
                } else if (cursor.name === 'CodeInfo')
                  mark(cursor.from, cursor.to, 'cm-fl-code-label');
              } while (cursor.nextSibling());
            return false;
          }
          case 'CodeBlock':
            lines(node.from, node.to, 'cm-fl-code');
            for (let at = doc.lineAt(node.from).number; at <= doc.lineAt(node.to).number; at++)
              codeLines.add(at);
            return false;
          case 'Blockquote':
            lines(node.from, node.to, 'cm-fl-quote');
            return;
          case 'QuoteMark': {
            const marker = markers.get(node.from);
            if (marker && !strictlyInside(marker.from, marker.to)) hide(marker.from, marker.to);
            else mark(node.from, node.to, 'cm-fl-mark');
            return;
          }
          case 'HorizontalRule':
            if (!strictlyInside(node.from, node.to)) {
              line(doc.lineAt(node.from).from, 'cm-fl-hr');
              hide(node.from, node.to);
            }
            return;
          case 'ListMark': {
            const marker = markers.get(node.from);
            if (!marker) return;
            // D-141 (after Davit's test): a number is plain text in the note's font, the same
            // with the caret on its line or not.
            if (marker.kind === 'number') return;
            if (strictlyInside(marker.from, marker.to)) {
              mark(node.from, node.to, 'cm-fl-mark');
              return;
            }
            // A checklist line shows only its checkbox; a bullet a drawn bullet.
            if (marker.kind === 'checkbox') {
              const task = node.node.parent?.getChild('Task')?.getChild('TaskMarker');
              if (!task) return;
              hide(node.from, task.from);
              const checked = /x/i.test(doc.sliceString(task.from, task.to));
              items.push({ kind: 'checkbox', from: task.from, to: task.to, checked });
            } else items.push({ kind: 'bullet', from: node.from, to: node.to });
            return;
          }
          case 'TaskMarker': {
            // Dimmed and struck through from the text on (D-142), not the space before it.
            if (/x/i.test(doc.sliceString(node.from, node.to))) {
              const end = node.node.parent?.to ?? node.to;
              const gap = /^\s*/.exec(doc.sliceString(node.to, end))?.[0].length ?? 0;
              if (node.to + gap < end) mark(node.to + gap, end, 'cm-fl-done');
            }
            return;
          }
          case 'Link':
          case 'Image': {
            const url = node.node.getChild('URL');
            const target = url ? doc.sliceString(url.from, url.to) : '';
            if (name === 'Image') {
              const text = doc.sliceString(node.from, node.to);
              const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? '';
              // Raw only with the caret strictly inside (then the picture shows after it); one
              // spanning lines (a line break in its text) always keeps its markdown.
              const replace = markers.has(node.from) && !strictlyInside(node.from, node.to);
              items.push({
                kind: 'image',
                from: node.from,
                to: node.to,
                src: target,
                alt,
                replace,
              });
              return false;
            }
            const marks = node.node.getChildren('LinkMark');
            const open = marks[0];
            const close = marks[1];
            // The link's text is formatted too (`[*foo* bar](/url)`, an image in a link).
            if (!open || !close || !url) return;
            if (atOrInside(node.from, node.to)) {
              for (const each of marks) mark(each.from, each.to, 'cm-fl-mark');
              mark(url.from, url.to, 'cm-fl-link-url');
              mark(open.to, close.from, 'cm-fl-link');
            } else {
              hide(open.from, open.to);
              mark(open.to, close.from, 'cm-fl-link', target);
              hide(close.from, node.to);
            }
            return;
          }
          case 'URL': {
            // A bare URL or an autolink (`<https://…>`), outside a link or an image.
            const parent = node.node.parent?.name;
            if (parent === 'Link' || parent === 'Image') return;
            const href = doc.sliceString(node.from, node.to);
            // TASK-10 (D-84, D-88): a bare URL shows its smart title (a link pattern's short form,
            // a built-in one, or its domain and path). D-105: as soon as the cursor isn't inside
            // it (just pasted, the caret after it, it shows short already); inside, the URL.
            const title = linkTitle(href, patterns);
            const inside = strictlyInside(node.from, node.to);
            if (!inside && title !== href)
              items.push({ kind: 'shortLink', from: node.from, to: node.to, text: title, href });
            else mark(node.from, node.to, 'cm-fl-link', href);
            return;
          }
          default:
            return;
        }
      },
    });
    // D-84 (NOTE-07): typed short forms (`AB#1234`) are links, outside code and links.
    if (patterns.length > 0)
      for (let at = doc.lineAt(from).number; at <= doc.lineAt(to).number; at++) {
        if (codeLines.has(at)) continue;
        const text = doc.line(at);
        for (const link of findShortForms(text.text, patterns)) {
          const start = text.from + link.from;
          let inside = false;
          for (let node: SyntaxNode | null = tree.resolveInner(start, 1); node; node = node.parent)
            if (['InlineCode', 'Link', 'URL', 'Image', 'CodeText'].includes(node.name))
              inside = true;
          if (!inside) mark(start, text.from + link.to, 'cm-fl-link cm-fl-auto-link', link.href);
        }
      }
  }
  // Flint's task fields (LIST-04, D-77) as chips, the `id` hidden with the space before it; raw
  // with the caret strictly inside.
  for (const marker of markers.values()) {
    if (marker.kind !== 'field' || strictlyInside(marker.from, marker.to)) continue;
    const match = new RegExp(FIELD.source).exec(doc.sliceString(marker.from, marker.to));
    if (!match) continue;
    if (match[1] === 'id') {
      const before = marker.from > 0 && doc.sliceString(marker.from - 1, marker.from) === ' ';
      hide(before ? marker.from - 1 : marker.from, marker.to);
    } else
      items.push({
        kind: 'field',
        from: marker.from,
        to: marker.to,
        text: fieldText(match[1] ?? '', match[2] ?? ''),
      });
  }
  return items;
}
