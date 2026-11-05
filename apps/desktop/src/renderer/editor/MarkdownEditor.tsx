import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockFor, classifyPaste, fencedBlock } from '@flint/core/shorthand';
import { insertBlock } from './commands.js';
import {
  announce,
  announceLinked,
  isImageLink,
  isVideoLink,
  openAttachment,
} from '../media/media.js';
import { replaceLink } from './live-preview.js';
import { editorExtensions, type PreviewHandlers } from './live-preview.js';

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
  /** Esc (a body's field saves and closes). */
  readonly onEscape?: (text: string) => void;
  /** NOTE-06, D-84: a note's Monospace toggle, in its menu (and Ctrl+Shift+M). */
  readonly monospace?: { readonly on: boolean; readonly toggle: () => void };
}): ReactElement {
  const {
    text,
    className,
    ariaLabel,
    readOnly = false,
    placeholder,
    autoFocus,
    caretAtEnd,
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  /** Typed and not yet handed over with `text` (it wins over `text`). */
  const pending = useRef(false);

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        ...(caretAtEnd ? { selection: { anchor: text.length } } : {}),
        extensions: [
          editorExtensions({
            readOnly,
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
              done(editor.state.doc.toString());
              return true;
            },
            onPaste: (event, target) => paste(event, target),
            // NOTE-02, NOTE-03 (D-82): the formatting menus, in the main window's terms.
            commands: () => ({
              pickImage: () => window.flintMain.pickImage(),
              monospace: latest.current.monospace,
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
            if (update.docChanged) {
              pending.current = true;
              latest.current.onChange?.(update.state.doc.toString());
            }
            if (update.focusChanged && !update.view.hasFocus)
              latest.current.onBlur?.(update.state.doc.toString());
            if (update.focusChanged && update.view.hasFocus) latest.current.onFocus?.();
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          // MEDIA-01, D-84: files dragged in (from Explorer) go where they are dropped.
          EditorView.domEventHandlers({
            drop: (event, target) => {
              const files = [...(event.dataTransfer?.files ?? [])];
              if (files.length === 0 || readOnly) return false;
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
    const current = editor.state.doc.toString();
    if (current === text) {
      pending.current = false;
      return;
    }
    if (pending.current && editor.hasFocus) return;
    pending.current = false;
    editor.dispatch({ changes: { from: 0, to: current.length, insert: text } });
    pending.current = false;
  }, [text]);

  return <div ref={host} className={`md-editor ${className}`} />;
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
