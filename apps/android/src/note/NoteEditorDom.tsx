'use dom';

/**
 * The note editor on the phone (MOB-07, D-165 Q3, R-A2): the desktop's CodeMirror live preview
 * (packages/editor) in a web view. The text comes in once; every change goes back to the native
 * screen, which saves it. The native keyboard bar calls `run` with a command's id.
 */
import '../../../../docs/design/tokens.css';
import '@flint/editor/editor.css';
import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EDITOR_COMMANDS, editorExtensions } from '@flint/editor';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { useEffect, useRef, type ReactElement, type Ref } from 'react';

export interface NoteEditorHandle extends DOMImperativeFactory {
  /** A keyboard-bar command: an editor command's id, or `indent`, `outdent`, `undo`, `redo`. */
  run: (...args: unknown[]) => void;
  focus: () => void;
}

const NO_PICKER = { pickImage: (): Promise<string | null> => Promise.resolve(null) };

/** How long after the last keystroke the text goes to the native side to be saved. */
const SAVE_AFTER_MS = 400;

export default function NoteEditorDom(props: {
  readonly ref: Ref<NoteEditorHandle>;
  readonly text: string;
  readonly onChange: (text: string) => Promise<void>;
  readonly dom?: DOMProps;
}): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  useEffect(() => {
    if (!host.current) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          // The live preview is part of the editor's extensions (not Source mode, NOTE-09).
          ...editorExtensions({ placeholder: 'Write something…' }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              void onChange.current(update.state.doc.toString());
            }, SAVE_AFTER_MS);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      clearTimeout(timer);
      // Leaving the note: what was typed last still goes to be saved.
      const text = editor.state.doc.toString();
      if (text !== props.text) void onChange.current(text);
      editor.destroy();
      view.current = null;
    };
    // The text is read once: later changes come from the editor itself.
  }, []);

  useDOMImperativeHandle(
    props.ref,
    () => ({
      run: (...args: unknown[]) => {
        const editor = view.current;
        const id = args[0];
        if (!editor || typeof id !== 'string') return;
        if (id === 'indent') indentMore(editor);
        else if (id === 'outdent') indentLess(editor);
        else if (id === 'undo') undo(editor);
        else if (id === 'redo') redo(editor);
        else EDITOR_COMMANDS.find((command) => command.id === id)?.run(editor, NO_PICKER);
        editor.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return (
    <>
      <style>{PAGE_CSS}</style>
      <div ref={host} className="fl-phone-note" />
    </>
  );
}

const PAGE_CSS = `
html, body { margin: 0; background: var(--fl-ground-window); color: var(--fl-text-body); }
body { font-family: var(--fl-font-ui); -webkit-text-size-adjust: 100%; }
.fl-phone-note { min-height: 100vh; }
.fl-phone-note .cm-editor { font-size: 16px; line-height: 1.6; }
.fl-phone-note .cm-content { padding: 8px 20px 40vh 20px; }
.fl-phone-note .cm-editor.cm-focused { outline: none; }
/* The checklist's checkbox (the desktop's .check, app.css), a little larger for a finger. */
.fl-phone-note .check {
  width: 20px; height: 20px; box-sizing: border-box; display: inline-flex;
  align-items: center; justify-content: center; vertical-align: -4px;
  border-radius: var(--fl-radius-check); border: 1.5px solid var(--fl-checkbox-border);
  color: var(--fl-strong-fg);
  transition: background-color var(--fl-dur-fast), border-color var(--fl-dur-fast);
}
.fl-phone-note .check.on { background: var(--fl-accent); border-color: var(--fl-accent); }
.fl-phone-note .check svg { width: 12px; height: 12px; }
`;
