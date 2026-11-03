import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState, Facet, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  keymap,
  placeholder as placeholderText,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { SyntaxNode } from '@lezer/common';
import type { MarkdownConfig } from '@lezer/markdown';
import {
  announce,
  fileMenuItems,
  imageMenuItems,
  isLinkedFile,
  mediaElement,
} from '../media/media.js';
import { COPY_ICON, copyWithFeedback } from '../media/copy.js';
import { activeLinkPatterns, findShortForms, linkTitle } from '../../shared/link-patterns.js';
import { openMenu, type MenuEntry } from '../menu/menu.js';
import {
  EDITOR_COMMANDS,
  SECTION_LABELS,
  type CommandHost,
  type CommandSection,
} from './commands.js';
import { slashCommands } from './slash.js';
import { findInNote } from './find.js';

/**
 * The note editor (M5, NOTE-01, D-49, D-79): CodeMirror with an Obsidian-style live preview. The
 * markdown text is the source of truth; everything here is decoration over it. Away from the
 * cursor, the syntax marks (`**`, `#`, backticks, a link's target, fences) are hidden and the text
 * shows formatted, images show inline, bullets and checkboxes are drawn, Flint's task fields show
 * as muted chips with `id` hidden (LIST-04, D-77). On the cursor's lines the raw markdown shows,
 * its marks faint. Without focus the whole text shows formatted. Used for notes, and for task
 * bodies on their page and inline (replacing the plain fields of M4).
 */

/** What the editor's host does for clicks on rendered parts. */
export interface PreviewHandlers {
  /** A link's target (rendered text, away from the cursor). */
  readonly openLink?: (href: string) => void;
  /** An image: every image of the text (`app://media/…`) and the one clicked. */
  readonly openImage?: (images: readonly string[], index: number) => void;
}

const handlersFacet = Facet.define<PreviewHandlers, PreviewHandlers>({
  combine: (values) => values[0] ?? {},
});

/** `==highlight==`, as in Obsidian (NOTE-02, D-72): the same rules as `~~strikethrough~~`. */
const PUNCTUATION = /[!-/:-@[-`{-~¡-¿]/;
const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };
const Highlight: MarkdownConfig = {
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

/** The grayscale code tokens (UI-06, D-63, docs/09 §11) and the inline markdown styles. */
const flintHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--fl-code-keyword)', fontWeight: '600' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--fl-code-number)' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'var(--fl-code-literal)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--fl-code-string)' },
  { tag: [tags.propertyName, tags.variableName, tags.attributeName], color: 'var(--fl-code-key)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--fl-code-function)',
    fontWeight: '500',
  },
  { tag: [tags.typeName, tags.className], color: 'var(--fl-code-type)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.bracket, tags.operator], color: 'var(--fl-code-punctuation)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--fl-code-comment)',
    fontStyle: 'italic',
  },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600', color: 'var(--fl-text-highlight)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    // D-84: pictures, videos and other attachments, with the Linked badge and File not found.
    const holder = document.createElement('span');
    holder.className = 'cm-fl-image';
    holder.append(mediaElement(this.src, this.alt));
    return holder;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'cm-fl-bullet';
    return bullet;
  }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span');
    box.className = this.checked ? 'cm-fl-checkbox on' : 'cm-fl-checkbox';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A task field as a small muted chip (LIST-04, D-77): what it says, not how it is written. */
class FieldWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  override eq(other: FieldWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-fl-field';
    chip.textContent = this.text;
    return chip;
  }
}

/** A field's chip text: `high`, `30 Oct 15:00`, `Today`, `done 28 Oct`, `muted`. */
function fieldText(key: string, value: string): string {
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

/** NOTE-05, D-82: the code card's copy button, in its top-right corner, inside the editor too. */
class CopyWidget extends WidgetType {
  readonly code: string;
  constructor(code: string) {
    super();
    this.code = code;
  }
  override eq(other: CopyWidget): boolean {
    return other.code === this.code;
  }
  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-fl-code-copy';
    button.title = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    button.innerHTML = COPY_ICON;
    // The cursor stays where it is: a press on the button isn't a click in the text.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyWithFeedback(button, this.code);
    });
    return button;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** D-84 (TASK-10): a URL shown as its link pattern's short form; a click opens it. */
class ShortLinkWidget extends WidgetType {
  readonly text: string;
  readonly href: string;
  constructor(text: string, href: string) {
    super();
    this.text = text;
    this.href = href;
  }
  override eq(other: ShortLinkWidget): boolean {
    return other.text === this.text && other.href === this.href;
  }
  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-fl-link cm-fl-auto-link';
    chip.dataset['href'] = this.href;
    chip.title = this.href;
    chip.textContent = this.text;
    return chip;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const hidden = Decoration.replace({});
const mark = (className: string, attributes?: Record<string, string>): Decoration =>
  Decoration.mark({ class: className, ...(attributes && { attributes }) });
const line = (className: string): Decoration => Decoration.line({ class: className });

/** Flint's task fields in a note (LIST-04, D-77): muted chips, the `id` hidden. */
const FIELD = /\s?[[(](id|priority|reminder|today|completion|muted)::\s*([^\])\n]*?)\s*[\])]/g;

/** The lines with a cursor or selection on them, while the editor has focus. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let at = first; at <= last; at++) lines.add(at);
  }
  return lines;
}

function decorate(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(view);
  const isActive = (from: number, to = from): boolean => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let at = first; at <= last; at++) if (active.has(at)) return true;
    return false;
  };
  const ranges: Range<Decoration>[] = [];
  const hide = (from: number, to: number): void => {
    if (to > from) ranges.push(hidden.range(from, to));
  };
  const lines = (from: number, to: number, className: string): void => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let at = first; at <= last; at++) {
      let name = className;
      if (at === first) name += ` ${className}-first`;
      if (at === last) name += ` ${className}-last`;
      ranges.push(line(name).range(doc.line(at).from));
    }
  };
  const codeLines = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
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
            if (node.node.parent?.name.startsWith('ATXHeading') && !isActive(node.from)) {
              const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
              hide(node.from, node.to + after);
            } else ranges.push(mark('cm-fl-mark').range(node.from, node.to));
            return;
          }
          case 'Emphasis':
            ranges.push(mark('cm-fl-em').range(node.from, node.to));
            return;
          case 'StrongEmphasis':
            ranges.push(mark('cm-fl-strong').range(node.from, node.to));
            return;
          case 'Strikethrough':
            ranges.push(mark('cm-fl-strike').range(node.from, node.to));
            return;
          case 'Highlight':
            ranges.push(mark('cm-fl-highlight').range(node.from, node.to));
            return;
          case 'InlineCode':
            ranges.push(mark('cm-fl-inline-code').range(node.from, node.to));
            return;
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'HighlightMark':
            if (isActive(node.from)) ranges.push(mark('cm-fl-mark').range(node.from, node.to));
            else hide(node.from, node.to);
            return;
          case 'CodeMark': {
            const parent = node.node.parent?.name;
            if (parent === 'InlineCode') {
              if (isActive(node.from)) ranges.push(mark('cm-fl-mark').range(node.from, node.to));
              else hide(node.from, node.to);
            }
            return;
          }
          case 'FencedCode': {
            const open = isActive(node.from, node.to);
            lines(node.from, node.to, 'cm-fl-code');
            // Closed, the hidden closing fence is only the card's bottom edge.
            const end = doc.lineAt(node.to);
            if (
              !open &&
              end.number > doc.lineAt(node.from).number &&
              /^\s*(`{3,}|~{3,})\s*$/.test(end.text)
            )
              ranges.push(line('cm-fl-code-end').range(end.from));
            for (let at = doc.lineAt(node.from).number; at <= doc.lineAt(node.to).number; at++)
              codeLines.add(at);
            // D-87: closed and without a language, the opening fence is only the card's top edge
            // (no empty first line); a paragraph right after the card keeps its spacing.
            const start = doc.lineAt(node.from);
            if (!open && !node.node.getChild('CodeInfo') && start.number < end.number)
              ranges.push(line('cm-fl-code-start').range(start.from));
            if (end.number < doc.lines && doc.line(end.number + 1).text.trim() !== '')
              ranges.push(line('cm-fl-after-code').range(doc.line(end.number + 1).from));
            const text = node.node.getChild('CodeText');
            ranges.push(
              Decoration.widget({
                widget: new CopyWidget(text ? doc.sliceString(text.from, text.to) : ''),
                side: 1,
              }).range(doc.lineAt(node.from).to),
            );
            const cursor = node.node.cursor();
            if (cursor.firstChild())
              do {
                if (cursor.name === 'CodeMark') {
                  if (open) ranges.push(mark('cm-fl-mark').range(cursor.from, cursor.to));
                  else hide(cursor.from, cursor.to);
                } else if (cursor.name === 'CodeInfo')
                  ranges.push(mark('cm-fl-code-label').range(cursor.from, cursor.to));
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
          case 'QuoteMark':
            if (isActive(node.from)) ranges.push(mark('cm-fl-mark').range(node.from, node.to));
            else {
              const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
              hide(node.from, node.to + after);
            }
            return;
          case 'HorizontalRule':
            if (!isActive(node.from)) {
              ranges.push(line('cm-fl-hr').range(doc.lineAt(node.from).from));
              hide(node.from, node.to);
            }
            return;
          case 'ListMark': {
            const item = node.node.parent;
            const task = item?.getChild('Task');
            const bullet = item?.parent?.name === 'BulletList';
            if (isActive(node.from)) {
              ranges.push(mark('cm-fl-mark').range(node.from, node.to));
              return;
            }
            const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
            // A checklist line shows only its checkbox; a bullet a drawn bullet.
            if (task) hide(node.from, node.to + after);
            else if (bullet)
              ranges.push(
                Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
              );
            return;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            if (!checked) return;
            const taskEnd = node.node.parent?.to ?? node.to;
            ranges.push(mark('cm-fl-done').range(node.to, taskEnd));
            return;
          }
          case 'Link':
          case 'Image': {
            const url = node.node.getChild('URL');
            const target = url ? doc.sliceString(url.from, url.to) : '';
            if (name === 'Image') {
              const text = doc.sliceString(node.from, node.to);
              const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? '';
              const widget = Decoration.replace({ widget: new ImageWidget(target, alt) });
              if (!isActive(node.from)) ranges.push(widget.range(node.from, node.to));
              else
                ranges.push(
                  Decoration.widget({ widget: new ImageWidget(target, alt), side: 1 }).range(
                    node.to,
                  ),
                );
              return false;
            }
            const marks = node.node.getChildren('LinkMark');
            const open = marks[0];
            const close = marks[1];
            if (!open || !close || !url) return false;
            if (isActive(node.from)) {
              for (const each of marks) ranges.push(mark('cm-fl-mark').range(each.from, each.to));
              ranges.push(mark('cm-fl-link-url').range(url.from, url.to));
              ranges.push(mark('cm-fl-link').range(open.to, close.from));
            } else {
              hide(open.from, open.to);
              ranges.push(mark('cm-fl-link', { 'data-href': target }).range(open.to, close.from));
              hide(close.from, node.to);
            }
            return false;
          }
          case 'URL': {
            // A bare URL or an autolink (`<https://…>`), outside a link or an image.
            const parent = node.node.parent?.name;
            if (parent === 'Link' || parent === 'Image') return;
            const href = doc.sliceString(node.from, node.to);
            // TASK-10 (D-84, D-88): a bare URL shows its smart title (a link pattern's short form,
            // a built-in one, or its domain and path); the line being typed shows the URL.
            const title = linkTitle(href, activeLinkPatterns());
            const short = isActive(node.from) || title === href ? null : title;
            ranges.push(
              short
                ? Decoration.replace({ widget: new ShortLinkWidget(short, href) }).range(
                    node.from,
                    node.to,
                  )
                : mark('cm-fl-link', { 'data-href': href }).range(node.from, node.to),
            );
            return;
          }
          default:
            return;
        }
      },
    });
    // Task checkboxes (`- [ ]`), drawn away from the cursor.
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'TaskMarker' || isActive(node.from)) return;
        const checked = /x/i.test(doc.sliceString(node.from, node.to));
        ranges.push(
          Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to),
        );
      },
    });
    // D-84 (NOTE-07): typed short forms (`AB#1234`) are links, outside code and links.
    const patterns = activeLinkPatterns();
    if (patterns.length > 0)
      for (let at = doc.lineAt(from).number; at <= doc.lineAt(to).number; at++) {
        if (codeLines.has(at)) continue;
        const text = doc.line(at);
        for (const link of findShortForms(text.text, patterns)) {
          const start = text.from + link.from;
          let inside = false;
          for (
            let node: SyntaxNode | null = syntaxTree(state).resolveInner(start, 1);
            node;
            node = node.parent
          )
            if (['InlineCode', 'Link', 'URL', 'Image', 'CodeText'].includes(node.name))
              inside = true;
          if (!inside)
            ranges.push(
              mark('cm-fl-link cm-fl-auto-link', { 'data-href': link.href }).range(
                start,
                text.from + link.to,
              ),
            );
        }
      }
    // Flint's task fields (LIST-04, D-77), outside code and away from the cursor.
    for (let at = doc.lineAt(from).number; at <= doc.lineAt(to).number; at++) {
      if (codeLines.has(at) || active.has(at)) continue;
      const text = doc.line(at);
      for (const match of text.text.matchAll(FIELD)) {
        const start = text.from + match.index;
        const end = start + match[0].length;
        if (match[1] === 'id') hide(start, end);
        else
          ranges.push(
            Decoration.replace({
              widget: new FieldWidget(fieldText(match[1] ?? '', match[2] ?? '')),
            }).range(start + (match[0].startsWith(' ') ? 1 : 0), end),
          );
      }
    }
  }
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** MEDIA-02: the note's pictures in the viewer, at this one. */
function openInViewer(view: EditorView, image: HTMLImageElement): void {
  const all = [...view.contentDOM.querySelectorAll<HTMLImageElement>('.cm-fl-image img')];
  view.state.facet(handlersFacet).openImage?.(
    all.map((each) => each.dataset['src'] ?? ''),
    all.indexOf(image),
  );
}

/** Clicks on rendered parts: a link opens, an image opens the lightbox, a checkbox toggles. */
const previewClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const target = event.target as HTMLElement;
    const handlers = view.state.facet(handlersFacet);
    const link = target.closest<HTMLElement>('.cm-fl-link[data-href]');
    if (link && handlers.openLink) {
      event.preventDefault();
      handlers.openLink(link.dataset['href'] ?? '');
      return true;
    }
    const image = target.closest<HTMLImageElement>('.cm-fl-image img');
    if (image && handlers.openImage) {
      event.preventDefault();
      openInViewer(view, image);
      return true;
    }
    const box = target.closest('.cm-fl-checkbox');
    if (box && view.state.facet(EditorState.readOnly) === false) {
      event.preventDefault();
      const at = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(at, at + 3);
      if (/^\[[ xX]\]$/.test(marker))
        view.dispatch({
          changes: { from: at + 1, to: at + 2, insert: marker[1] === ' ' ? 'x' : ' ' },
        });
      return true;
    }
    return false;
  },
});

const flintTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'inherit' },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': {
      padding: '0',
      fontFamily: 'var(--fl-font-ui)',
      caretColor: 'var(--fl-accent)',
    },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fl-accent)', borderLeftWidth: '1.5px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      { backgroundColor: 'var(--fl-selection)' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
    '.cm-placeholder': { color: 'var(--fl-text-faint)' },
  },
  { dark: true },
);

export interface EditorOptions {
  readonly readOnly?: boolean;
  /** NOTE-02, NOTE-03 (D-82): the formatting menus; without it, no menus (a read-only note). */
  readonly commands?: () => CommandHost & MenuHost;
  readonly placeholder?: string;
  readonly handlers?: PreviewHandlers;
  /** Esc in the editor (a body's field saves and closes, D-49). */
  readonly onEscape?: () => boolean;
  /** Text pasted in: true when handled (code fenced, an image attached; CAP-06). */
  readonly onPaste?: (event: ClipboardEvent, view: EditorView) => boolean;
}

/** Everything the note editor is made of, for a new editor state. */
export function editorExtensions(options: EditorOptions): Extension[] {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    closeBrackets(),
    // D-84: every language CodeMirror's language data knows, each loaded when a block uses it.
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Highlight] }),
    syntaxHighlighting(flintHighlight),
    keymap.of([
      ...(options.onEscape ? [{ key: 'Escape', run: options.onEscape }] : []),
      { key: 'Tab', run: indentMore, shift: indentLess },
      ...(options.commands ? formatKeys(options.commands) : []),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    livePreview,
    previewClicks,
    findInNote(),
    ...(options.commands && !options.readOnly
      ? [slashCommands(options.commands), formatMenu(options.commands)]
      : []),
    handlersFacet.of(options.handlers ?? {}),
    flintTheme,
    EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-multiline': 'true' }),
    ...(options.placeholder ? [placeholderText(options.placeholder)] : []),
    ...(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    ...(options.onPaste
      ? [
          EditorView.domEventHandlers({
            paste: (event, view) => options.onPaste?.(event, view) ?? false,
          }),
        ]
      : []),
  ];
}

/** What the right-click menu needs besides the commands: the text field's edit commands (UI-08). */
export interface MenuHost {
  readonly edit: (command: 'cut' | 'copy' | 'paste' | 'selectAll') => void;
  /** Paste as plain text: without CAP-06's fencing. */
  readonly pastePlain: () => void;
  /** NOTE-06, D-84: a note's Monospace toggle (notes only). */
  readonly monospace?: { readonly on: boolean; readonly toggle: () => void } | undefined;
}

/** Ctrl+B and Ctrl+I (Proposed, D-82): bold and italic, as the menu's hints say. */
function formatKeys(
  host: () => CommandHost & MenuHost,
): { key: string; run: (view: EditorView) => boolean }[] {
  const run =
    (id: string) =>
    (view: EditorView): boolean => {
      const command = EDITOR_COMMANDS.find((each) => each.id === id);
      if (!command) return false;
      command.run(view, host());
      return true;
    };
  return [
    { key: 'Mod-b', run: run('bold') },
    { key: 'Mod-i', run: run('italic') },
    {
      key: 'Mod-Shift-v',
      run: () => {
        host().pastePlain();
        return true;
      },
    },
    {
      key: 'Mod-Shift-m',
      run: () => {
        const monospace = host().monospace;
        if (!monospace) return false;
        monospace.toggle();
        return true;
      },
    },
  ];
}

/**
 * The note editor's right-click menu (NOTE-02, D-72): Format ▸, Paragraph ▸ and Insert ▸, then Cut /
 * Copy / Paste / Paste as plain text / Select all. In the page like every Flint menu (UI-08).
 */
function formatMenu(host: () => CommandHost & MenuHost): Extension {
  return EditorView.domEventHandlers({
    contextmenu: (event, view) => {
      event.preventDefault();
      // Not also the window's text-field menu.
      event.stopPropagation();
      const commands = host();
      // D-84: on an attachment, its own items first: open it, copy a linked one in.
      const media = (event.target as HTMLElement).closest<HTMLElement>('.fl-media[data-link]');
      const link = media?.dataset['link'] ?? '';
      const picture = media?.querySelector('img');
      const attachment: MenuEntry[] =
        media && link !== ''
          ? [
              // MEDIA-02, D-87: a picture's menu (D-91: Open in viewer as its click does).
              ...(picture
                ? imageMenuItems(link, () => openInViewer(view, picture))
                : fileMenuItems(link, media)),
              ...(isLinkedFile(link)
                ? [
                    {
                      label: 'Copy into Flint',
                      action: () =>
                        void window.flintMain.copyIntoFlint(link).then((outcome) => {
                          if (outcome?.ok) replaceLink(view, link, outcome.link);
                          else if (outcome) announce(outcome.problem);
                        }),
                    },
                  ]
                : []),
              'divider',
            ]
          : [];
      const section = (name: CommandSection): MenuEntry => ({
        label: SECTION_LABELS[name],
        submenu: EDITOR_COMMANDS.filter((command) => command.section === name).map((command) => ({
          label: command.label,
          ...(command.hint ? { hint: command.hint } : {}),
          action: () => command.run(view, commands),
        })),
      });
      const selected = !view.state.selection.main.empty;
      openMenu(
        [
          ...attachment,
          section('format'),
          section('paragraph'),
          section('insert'),
          'divider',
          { label: 'Cut', hint: 'Ctrl+X', disabled: !selected, action: () => commands.edit('cut') },
          {
            label: 'Copy',
            hint: 'Ctrl+C',
            disabled: !selected,
            action: () => commands.edit('copy'),
          },
          { label: 'Paste', hint: 'Ctrl+V', action: () => commands.edit('paste') },
          {
            label: 'Paste as plain text',
            hint: 'Ctrl+Shift+V',
            action: () => commands.pastePlain(),
          },
          'divider',
          { label: 'Select all', hint: 'Ctrl+A', action: () => commands.edit('selectAll') },
          ...(commands.monospace
            ? [
                'divider' as const,
                {
                  label: 'Monospace',
                  hint: 'Ctrl+Shift+M',
                  checked: commands.monospace.on,
                  action: () => commands.monospace?.toggle(),
                },
              ]
            : []),
        ],
        { x: event.clientX, y: event.clientY },
      );
      return true;
    },
  });
}

/** D-84: every `](old)` in the editor's text becomes `](next)` (Copy into Flint); false if none. */
export function replaceLink(view: EditorView, old: string, next: string): boolean {
  const text = view.state.doc.toString();
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const target of [`](${old})`, `](<${old}>)`]) {
    let at = text.indexOf(target);
    while (at >= 0) {
      changes.push({ from: at, to: at + target.length, insert: `](${next})` });
      at = text.indexOf(target, at + target.length);
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: 'input.relink' });
  return true;
}
