import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockFor, classifyPaste, fencedBlock } from '@flint/core/shorthand';
import { insertBlock } from './commands.js';
import { isCellsMarkdown } from './table.js';
import {
  announce,
  announceLinked,
  isImageLink,
  isVideoLink,
  openAttachment,
} from '../media/media.js';
import { replaceLink } from './live-preview.js';
import { editorExtensions, previewMode, sourceMode, type PreviewHandlers } from './live-preview.js';
import { durationMs, reducedMotion } from '../ui/motion.js';
import { fromEditor, lineEndingOf, toEditor, type LineEnding } from './line-endings.js';

/**
 * The note editor in React (M5, D-79): notes, and task bodies on their page and inline. It owns its
 * text while it lives; `text` from outside replaces it only while nothing typed is pending (a
 * change from outside Flint, an undo), like the plain note field before it.
 *
 * Pasting follows CAP-06 (D-79): raw code, JSON and stack traces go in fenced, on lines of their
 * own; a pasted image is saved to `attachments/` and linked; markdown and plain text paste as they
 * are.
 */
export function MarkdownEditor(props: {
  readonly text: string;
  readonly className: string;
  readonly ariaLabel: string;
  readonly readOnly?: boolean;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  /** Put the cursor at the end when it starts (a body opened to be edited). */
  readonly caretAtEnd?: boolean;
  readonly handlers?: PreviewHandlers;
  /** Every change, as it is typed. */
  readonly onChange?: (text: string) => void;
  /** Leaving the editor (focus elsewhere). */
  readonly onBlur?: (text: string) => void;
  /** D-107: the editor took the focus (a caret asked for has arrived). */
  readonly onFocus?: () => void;
  /**
   * D-109: shown read-only for now (another window edits the note), yet still focusable, so a click
   * into it can take the editing over.
   */
  readonly locked?: boolean;
  /** Esc (a body's field saves and closes). */
  readonly onEscape?: (text: string) => void;
  /** NOTE-06, D-84: a note's Monospace toggle, in its menu (and Ctrl+Shift+M). */
  readonly monospace?: { readonly on: boolean; readonly toggle: () => void };
  /** NOTE-09, D-141: a note's Source mode, in its menu (and Ctrl+Shift+E); notes only. */
  readonly source?: { readonly on: boolean; readonly toggle: () => void };
}): ReactElement {
  const {
    text,
    className,
    ariaLabel,
    readOnly = false,
    placeholder,
    autoFocus,
    caretAtEnd,
    locked = false,
  } = props;
  const lock = useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  /** The note's line ending, given back with every text (D-141: byte-exact files). */
  const eol = useRef<LineEnding>(lineEndingOf(text));
  const out = (editor: EditorView): string => fromEditor(editor.state.doc.toString(), eol.current);
  /** Typed and not yet handed over with `text` (it wins over `text`). */
  const pending = useRef(false);

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: toEditor(text),
        ...(caretAtEnd ? { selection: { anchor: toEditor(text).length } } : {}),
        extensions: [
          editorExtensions({
            readOnly,
            source: props.source?.on === true,
            ...(placeholder ? { placeholder } : {}),
            handlers: {
              // D-84: a link to an attachment (a document) opens in its default app, by Flint's rules.
              openLink: (href) => {
                if (/^(https?|mailto):/i.test(href)) latest.current.handlers?.openLink?.(href);
                else void openAttachment(null, href);
              },
              openImage: (images, index) => latest.current.handlers?.openImage?.(images, index),
            },
            onEscape: () => {
              const done = latest.current.onEscape;
              if (!done) return false;
              done(out(editor));
              return true;
            },
            onPaste: (event, target) => paste(event, target),
            // NOTE-02, NOTE-03 (D-82): the formatting menus, in the main window's terms.
            commands: () => ({
              pickImage: () => window.flintMain.pickImage(),
              monospace: latest.current.monospace,
              source: latest.current.source,
              edit: (command) => window.flintMain.edit(command),
              pastePlain: () => {
                plainPaste = true;
                window.flintMain.edit('pasteAndMatchStyle');
                // A paste that brings no text fires no paste event: the next one is normal again.
                window.setTimeout(() => {
                  plainPaste = false;
                }, 500);
              },
            }),
          }),
          EditorView.updateListener.of((update) => {
            const outside = update.transactions.some((tr) => tr.annotation(fromOutside));
            if (update.docChanged && !outside) {
              pending.current = true;
              latest.current.onChange?.(out(update.view));
            }
            if (update.focusChanged && !update.view.hasFocus)
              latest.current.onBlur?.(out(update.view));
            if (update.focusChanged && update.view.hasFocus) latest.current.onFocus?.();
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          lock.current.of(locked ? EditorState.readOnly.of(true) : []),
          // MEDIA-01, D-84: files dragged in (from Explorer) go where they are dropped.
          EditorView.domEventHandlers({
            drop: (event, target) => {
              const files = [...(event.dataTransfer?.files ?? [])];
              if (files.length === 0 || readOnly || latest.current.locked) return false;
              event.preventDefault();
              const at = target.posAtCoords({ x: event.clientX, y: event.clientY });
              if (at !== null) target.dispatch({ selection: { anchor: at } });
              void addFiles(target, files);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => {
      view.current = null;
      editor.destroy();
    };
    // The editor is made once; its handlers are read through `latest`.
  }, []);

  // D-106: asked for the caret (a quick note, a new note): it takes it even when the editor was
  // there already, and again over the next frames if something took it back as the view settled.
  useEffect(() => {
    const editor = view.current;
    if (!autoFocus || !editor) return;
    if (!editor.hasFocus) editor.focus();
    // Not cancelled when the request is cleared (that happens at once); gone with the editor.
    let frames = 0;
    const check = (): void => {
      if (view.current !== editor) return;
      if (!editor.hasFocus) editor.focus();
      if (++frames < 2) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, [autoFocus]);

  // A change from outside shows when nothing typed is waiting to be saved.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    eol.current = lineEndingOf(text);
    const current = editor.state.doc.toString();
    const next = toEditor(text);
    if (current === next) {
      pending.current = false;
      return;
    }
    if (pending.current && editor.hasFocus && !latest.current.locked) return;
    pending.current = false;
    editor.dispatch({ changes: difference(current, next), annotations: fromOutside.of(true) });
  }, [text]);

  // NOTE-09, D-141: Source mode switched: the live preview off or on, the text fading over (Q12).
  const sourceOn = props.source?.on === true;
  const shownSource = useRef(sourceOn);
  useEffect(() => {
    const editor = view.current;
    if (!editor || shownSource.current === sourceOn) return;
    shownSource.current = sourceOn;
    editor.dispatch({ effects: previewMode.reconfigure(sourceMode(sourceOn)) });
    if (!reducedMotion())
      editor.contentDOM.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: durationMs('--fl-dur-state', 260),
        easing: 'ease-out',
      });
  }, [sourceOn]);

  // D-109: locked while another window edits the note, unlocked once this one may type.
  useEffect(() => {
    view.current?.dispatch({
      effects: lock.current.reconfigure(locked ? EditorState.readOnly.of(true) : []),
    });
  }, [locked]);

  return <div ref={host} className={`md-editor ${className}`} />;
}

/** D-109: a change that came from outside (a save, another window's typing): not typing here. */
const fromOutside = Annotation.define<boolean>();

/** The smallest change from `from` to `to` (the same start and end kept), so the caret stays. */
function difference(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  )
    end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/** Paste as plain text (NOTE-02): the next paste skips CAP-06's fencing. */
let plainPaste = false;

function paste(event: ClipboardEvent, view: EditorView): boolean {
  if (plainPaste) {
    plainPaste = false;
    return false;
  }
  const data = event.clipboardData;
  if (!data) return false;
  // D-84: files copied in Explorer come with their paths: copied in, or linked when large.
  const files = [...data.files].filter((file) => window.flintMain.pathFor(file) !== '');
  if (files.length > 0) {
    event.preventDefault();
    void addFiles(view, files);
    return true;
  }
  const image = [...data.items]
    .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile();
  if (image) {
    event.preventDefault();
    void image
      .arrayBuffer()
      .then((buffer) => window.flintMain.attach(new Uint8Array(buffer), image.type))
      .then((link) => {
        if (link) insertBlock(view, `![](${link})`);
      });
    return true;
  }
  // D-144 (Proposed): cells copied from a Flint table (their markdown beside the tab-separated
  // text) paste into a note as a table of their own; Ctrl+Shift+V pastes the plain text.
  const cells = data.getData('text/markdown');
  if (cells !== '' && isCellsMarkdown(cells)) {
    event.preventDefault();
    insertBlock(view, cells, cells.length, true);
    return true;
  }
  const pasted = data.getData('text/plain');
  const kind = classifyPaste(pasted);
  if (kind === 'text') return false;
  event.preventDefault();
  try {
    insertBlock(view, fencedBlock(blockFor(pasted).text, kind === 'json' ? 'json' : ''));
  } catch {
    // D-91: a paste always lands: as it is, when the code block can't be made.
    view.dispatch(view.state.replaceSelection(pasted.replace(/\r\n?/g, '\n')));
  }
  return true;
}

/**
 * MEDIA-01, MEDIA-03, D-84: files dragged or pasted in: each copied into attachments/ (or linked
 * where it is when over 25 MB, with the notice), inserted at the cursor: pictures and videos as
 * images, other files as links. Programs and scripts are refused.
 */
async function addFiles(view: EditorView, files: readonly File[]): Promise<void> {
  for (const file of files) {
    const path = window.flintMain.pathFor(file);
    if (path === '') continue;
    const outcome = await window.flintMain.attachFile(path);
    if (!outcome) continue;
    if (!outcome.ok) {
      announce(outcome.problem);
      continue;
    }
    const media = isImageLink(outcome.link) || isVideoLink(outcome.link);
    insertBlock(view, media ? `![](${outcome.link})` : `[${outcome.name}](${outcome.link})`);
    if (outcome.linked)
      announceLinked({
        name: outcome.name,
        link: outcome.link,
        relink: (next) => view.dom.isConnected && replaceLink(view, outcome.link, next),
      });
  }
}
