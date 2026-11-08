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
import {
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  StateEffect,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  WidgetType,
  layer,
  keymap,
  placeholder as placeholderText,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';
import {
  announce,
  fileMenuItems,
  imageMenuItems,
  isLinkedFile,
  mediaElement,
} from '../media/media.js';
import { COPY_ICON, copyWithFeedback } from '../media/copy.js';
import { activeLinkPatterns } from '../../shared/link-patterns.js';
import { openMenu, type MenuEntry } from '../menu/menu.js';
import {
  EDITOR_COMMANDS,
  SECTION_LABELS,
  type CommandHost,
  type CommandSection,
} from './commands.js';
import { slashCommands } from './slash.js';
import { findInNote } from './find.js';
import { matchFlash } from './match-flash.js';
import { blockMarkers, buildPreview } from './preview.js';
import { keepTextOutOfTables, tables } from './table-view.js';
import { durationMs, reducedMotion } from '../ui/motion.js';
import { checkSvg } from '../ui/check.js';
import { NOTE_SYNTAX } from './syntax.js';

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

/**
 * D-144: a picture or video has its size only once it has loaded (until then the 64 px
 * placeholder). Its load says so, so the caret drawn beside it (`pictureCaret`) and the editor's
 * line heights are measured again at once, not on the next key or click.
 */
const mediaSized = StateEffect.define<null>();

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
  toDOM(view: EditorView): HTMLElement {
    // D-84: pictures, videos and other attachments, with the Linked badge and File not found.
    const holder = document.createElement('span');
    holder.className = 'cm-fl-image';
    holder.append(mediaElement(this.src, this.alt));
    const sized = (): void => {
      if (holder.isConnected) view.dispatch({ effects: mediaSized.of(null) });
    };
    holder.querySelector('img')?.addEventListener('load', sized, { once: true });
    holder.querySelector('video')?.addEventListener('loadedmetadata', sized, { once: true });
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
  // D-141 Q3: a click on the bullet places the caret (after it: `clicksDontReveal`).
  override ignoreEvent(): boolean {
    return false;
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
    // D-141 Q8: the task row's shared checkbox in its compact size, the same tick.
    const holder = document.createElement('span');
    holder.className = 'fl-compact cm-fl-task-box';
    const box = document.createElement('span');
    box.className = this.checked ? 'check on' : 'check';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    if (this.checked) box.append(checkSvg(12));
    holder.append(box);
    return holder;
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

/** The live preview's items (preview.ts) as CodeMirror decorations and widgets. */
function decorate(view: EditorView): DecorationSet {
  const items = buildPreview({
    state: view.state,
    focused: view.hasFocus,
    visible: view.visibleRanges,
    patterns: activeLinkPatterns(),
  });
  const ranges: Range<Decoration>[] = [];
  for (const item of items)
    switch (item.kind) {
      case 'hide':
        ranges.push(hidden.range(item.from, item.to));
        break;
      case 'mark':
        ranges.push(
          Decoration.mark({
            class: item.className,
            ...(item.href !== undefined && { attributes: { 'data-href': item.href } }),
          }).range(item.from, item.to),
        );
        break;
      case 'line':
        ranges.push(Decoration.line({ class: item.className }).range(item.at));
        break;
      case 'bullet':
        ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(item.from, item.to));
        break;
      case 'checkbox':
        ranges.push(
          Decoration.replace({ widget: new CheckboxWidget(item.checked) }).range(
            item.from,
            item.to,
          ),
        );
        break;
      case 'image': {
        const widget = new ImageWidget(item.src, item.alt);
        ranges.push(
          item.replace
            ? Decoration.replace({ widget }).range(item.from, item.to)
            : Decoration.widget({ widget, side: 1 }).range(item.to),
        );
        break;
      }
      case 'field':
        ranges.push(
          Decoration.replace({ widget: new FieldWidget(item.text) }).range(item.from, item.to),
        );
        break;
      case 'copy':
        ranges.push(
          Decoration.widget({ widget: new CopyWidget(item.code), side: 1 }).range(item.at),
        );
        break;
      case 'shortLink':
        ranges.push(
          Decoration.replace({ widget: new ShortLinkWidget(item.text, item.href) }).range(
            item.from,
            item.to,
          ),
        );
        break;
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

/**
 * D-141 (after Davit's test of 1.1.0): right before or after a drawn picture the browser draws its
 * own caret badly (at both ends of the picture). There Flint hides it and draws one caret, where
 * the cursor really is. Only while the live preview is on (Source mode shows the markdown).
 */
function caretBesidePicture(view: EditorView): number | null {
  const { state } = view;
  const caret = state.selection.main;
  if (!view.hasFocus || state.selection.ranges.length > 1 || !caret.empty) return null;
  if (!view.plugin(livePreview)) return null;
  const line = state.doc.lineAt(caret.head);
  for (const marker of blockMarkers(state, [{ from: line.from, to: line.to }]))
    if (marker.kind === 'image' && (caret.head === marker.from || caret.head === marker.to))
      return caret.head;
  return null;
}

/** The height of the browser's caret in this note's body text: a body character's box (headings
 * and code cards skipped), else the font size's usual box. */
function textCaretHeight(view: EditorView): number {
  const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const line = node.parentElement?.closest('.cm-line');
    if (!line || /cm-fl-(h[1-3]|code)/.test(line.className)) continue;
    const text = node.textContent ?? '';
    const at = text.search(/\S/);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const height = range.getBoundingClientRect().height / (view.scaleY || 1);
    if (height > 0) return height;
  }
  const size = parseFloat(getComputedStyle(view.contentDOM).fontSize);
  return Math.round((Number.isFinite(size) ? size : 15) * 1.25);
}

const pictureCaret: Extension = [
  layer({
    above: true,
    class: 'cm-fl-caret-layer',
    markers: (view) => {
      const at = caretBesidePicture(view);
      if (at === null) return [];
      // Where CodeMirror would put the cursor (the picture's edge), but as tall as a text caret
      // (D-142: not the picture's height), on the line's first text line, where typing goes.
      const [edge] = RectangleMarker.forRange(
        view,
        'cm-fl-caret',
        EditorSelection.cursor(at, view.state.selection.main.assoc || 1),
      );
      if (!edge) return [];
      const height = textCaretHeight(view);
      const top = edge.top + Math.max(0, (view.defaultLineHeight - height) / 2);
      return [new RectangleMarker('cm-fl-caret', edge.left, top, null, height)];
    },
    update: (update) =>
      update.selectionSet ||
      update.docChanged ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(mediaSized)),
      ),
  }),
  EditorView.contentAttributes.of((view) =>
    caretBesidePicture(view) === null ? null : { class: 'cm-fl-caret-hidden' },
  ),
];

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
    const box = target.closest('.cm-fl-task-box');
    if (box && view.state.facet(EditorState.readOnly) === false) {
      event.preventDefault();
      const at = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(at, at + 3);
      if (/^\[[ xX]\]$/.test(marker)) {
        const ticking = marker[1] === ' ';
        view.dispatch({ changes: { from: at + 1, to: at + 2, insert: ticking ? 'x' : ' ' } });
        tickMotion(view, at, ticking);
      }
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
  /** NOTE-09, D-141: Source mode: the whole note as raw markdown (no live preview). */
  readonly source?: boolean;
}

/** NOTE-09, D-141: the live preview, or none in Source mode (switched with `sourceMode`). */
export const previewMode = new Compartment();

/** The live preview's parts: none in Source mode, where every line is its raw markdown (text
 * typed under a table still stays out of it there, D-144). */
export const sourceMode = (on: boolean): Extension =>
  on
    ? [keepTextOutOfTables]
    : [livePreview, previewClicks, clicksDontReveal, pictureCaret, tables()];

/** Everything the note editor is made of, for a new editor state. */
export function editorExtensions(options: EditorOptions): Extension[] {
  return [
    history(),
    // D-111: the browser's own selection (styled by selection.css, UI-11), which covers only the
    // characters, as in text fields; CodeMirror's drawn one fills whole lines.
    EditorView.lineWrapping,
    closeBrackets(),
    // D-84: every language CodeMirror's language data knows, each loaded when a block uses it.
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [...NOTE_SYNTAX] }),
    syntaxHighlighting(flintHighlight),
    keymap.of([
      ...(options.onEscape ? [{ key: 'Escape', run: options.onEscape }] : []),
      { key: 'Tab', run: indentMore, shift: indentLess },
      // D-141 Q3: ← from just after a drawn marker or object, → from just before it, step in.
      { key: 'ArrowLeft', run: stepInto(-1) },
      { key: 'ArrowRight', run: stepInto(1) },
      // D-106 (docs/03 §3): Ctrl+K with text selected makes it a link, the caret where its address
      // goes; with nothing selected the palette opens (the window has it).
      {
        key: 'Mod-k',
        run: (view: EditorView): boolean => {
          const { from, to } = view.state.selection.main;
          if (from === to) return false;
          const text = view.state.sliceDoc(from, to);
          view.dispatch({
            changes: { from, to, insert: `[${text}]()` },
            selection: { anchor: from + text.length + 3 },
          });
          return true;
        },
      },
      ...(options.commands ? formatKeys(options.commands) : []),
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    previewMode.of(sourceMode(options.source === true)),
    findInNote(),
    // D-143: what Ctrl+K found in the note's line, lit like find's current match.
    matchFlash(),
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
  /** NOTE-09, D-141: a note's Source mode toggle (notes only, also in mini mode). */
  readonly source?: { readonly on: boolean; readonly toggle: () => void } | undefined;
}

/** Ctrl+B and Ctrl+I (Proposed, D-82): bold and italic, as the menu's hints say; Ctrl+E inline
 * code (D-106, D-141 Q5); Ctrl+Shift+M Monospace, Ctrl+Shift+E Source mode. */
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
    { key: 'Mod-e', run: run('code') },
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
    {
      key: 'Mod-Shift-e',
      run: () => {
        const source = host().source;
        if (!source) return false;
        source.toggle();
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
              // D-141 Q3: its raw markdown, the caret in its address.
              { label: 'Edit markdown', action: () => editMarkdown(view, media) },
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
          ...(commands.monospace || commands.source ? ['divider' as const] : []),
          ...(commands.monospace
            ? [
                {
                  label: 'Monospace',
                  hint: 'Ctrl+Shift+M',
                  checked: commands.monospace.on,
                  action: () => commands.monospace?.toggle(),
                },
              ]
            : []),
          // NOTE-09, D-141: next to Monospace.
          ...(commands.source
            ? [
                {
                  label: 'Source mode',
                  hint: 'Ctrl+Shift+E',
                  checked: commands.source.on,
                  action: () => commands.source?.toggle(),
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

/** D-141 Q8, D-89: ticking pops the box (as a task row's) and fades the line's text to muted;
 * unticking brings the text back. Off with reduce-motion. */
function tickMotion(view: EditorView, at: number, ticking: boolean): void {
  if (reducedMotion()) return;
  const line = lineElement(view, at);
  if (!line) return;
  if (ticking)
    line
      .querySelector('.cm-fl-task-box .check')
      ?.animate([{ scale: '1' }, { scale: '1.15' }, { scale: '1' }], {
        duration: 180,
        easing: 'cubic-bezier(.2, .9, .3, 1.5)',
      });
  const timing = { duration: durationMs('--fl-dur-state', 260), easing: 'ease-out' };
  const body = 'var(--fl-text-body)';
  const muted = 'var(--fl-text-muted)';
  // The strike fades in with the dimming (D-142).
  if (ticking)
    for (const done of line.querySelectorAll('.cm-fl-done'))
      done.animate(
        [
          { color: body, textDecorationColor: 'transparent' },
          { color: muted, textDecorationColor: muted },
        ],
        timing,
      );
  else line.animate([{ color: muted }, { color: body }], timing);
}

/** The `.cm-line` element showing a position. */
function lineElement(view: EditorView, at: number): HTMLElement | null {
  const { node } = view.domAtPos(at);
  return (
    (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('.cm-line') ??
    null
  );
}

/** D-141 Q3: ← from just after a drawn block marker or object, → from just before it, put the caret
 * one character into it, so its raw markdown shows; further presses walk through it. */
function stepInto(direction: -1 | 1): (view: EditorView) => boolean {
  return (view) => {
    const { state } = view;
    const caret = state.selection.main;
    if (state.selection.ranges.length > 1 || !caret.empty) return false;
    const line = state.doc.lineAt(caret.head);
    for (const marker of blockMarkers(state, [{ from: line.from, to: line.to }])) {
      // Numbers are never hidden; a one-character marker has no inside.
      if (marker.kind === 'number' || marker.to - marker.from < 2) continue;
      if (caret.head !== (direction < 0 ? marker.to : marker.from)) continue;
      view.dispatch({
        selection: { anchor: direction < 0 ? marker.to - 1 : marker.from + 1 },
        scrollIntoView: true,
        userEvent: 'select',
      });
      return true;
    }
    return false;
  };
}

/** The line prefixes a click never reveals: the caret goes after them, to the text (D-141 Q3). */
const PREFIXES = new Set(['bullet', 'checkbox', 'heading', 'quote']);

/** D-141 Q3: clicks don't reveal. A click landing before or inside a hidden line prefix (the
 * bullet, a quote's `>`, a heading's `#`) puts the caret after it, at the text. */
const clicksDontReveal = EditorState.transactionFilter.of((tr) => {
  if (!tr.isUserEvent('select.pointer') || tr.docChanged) return tr;
  const caret = tr.newSelection.main;
  if (tr.newSelection.ranges.length > 1 || !caret.empty) return tr;
  const line = tr.startState.doc.lineAt(caret.head);
  const prefixes = blockMarkers(tr.startState, [{ from: line.from, to: line.to }]).filter(
    (marker) => PREFIXES.has(marker.kind),
  );
  let at = caret.head;
  for (let moved = true; moved;) {
    moved = false;
    for (const marker of prefixes)
      if (at >= marker.from && at < marker.to) {
        at = marker.to;
        moved = true;
      }
  }
  if (at === caret.head) return tr;
  return { selection: EditorSelection.cursor(at), userEvent: 'select.pointer' };
});

/** D-141 Q3: an embedded object's Edit markdown: its raw markdown, the caret where its address
 * starts (**Proposed**). */
function editMarkdown(view: EditorView, element: HTMLElement): void {
  let node = syntaxTree(view.state).resolveInner(view.posAtDOM(element), 1) as SyntaxNode | null;
  while (node && node.name !== 'Image') node = node.parent;
  if (!node) return;
  const address = node.getChild('URL');
  view.focus();
  view.dispatch({
    selection: { anchor: address ? address.from : node.from + 2 },
    scrollIntoView: true,
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
