import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockFor, classifyPaste, fencedBlock } from '@flint/core/shorthand';
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
  /** Esc (a body's field saves and closes). */
  readonly onEscape?: (text: string) => void;
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
              openLink: (href) => latest.current.handlers?.openLink?.(href),
              openImage: (images, index) => latest.current.handlers?.openImage?.(images, index),
            },
            onEscape: () => {
              const done = latest.current.onEscape;
              if (!done) return false;
              done(editor.state.doc.toString());
              return true;
            },
            onPaste: (event, target) => paste(event, target),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              pending.current = true;
              latest.current.onChange?.(update.state.doc.toString());
            }
            if (update.focusChanged && !update.view.hasFocus)
              latest.current.onBlur?.(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
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

/** CAP-06 in the editor: a block on lines of its own at the cursor. */
function insertBlock(view: EditorView, block: string): void {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, from - 2), from);
  const after = doc.sliceString(to, to + 1);
  const lead = from === 0 || before === '\n\n' ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after === '\n' ? '' : '\n';
  const insert = lead + block + trail;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
  });
}

function paste(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  if (!data) return false;
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
  insertBlock(view, fencedBlock(blockFor(pasted).text, kind === 'json' ? 'json' : ''));
  return true;
}
