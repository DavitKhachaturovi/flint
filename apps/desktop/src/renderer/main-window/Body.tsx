import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { blockFor, classifyPaste, fencedBlock, type BlockKind } from '@flint/core/shorthand';
import { bodyHtml } from '../../shared/body-markdown.js';
import { highlightLines } from '../highlight/highlight.js';

/** The code blocks of rendered body HTML, highlighted in place (UI-06): JSON and stack traces. */
function highlightCode(root: HTMLElement): void {
  for (const pre of root.querySelectorAll<HTMLElement>('pre.body-code')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const text = code.textContent ?? '';
    const kind: BlockKind =
      (pre.dataset['lang'] ?? '').toLowerCase() === 'json' ? 'json' : blockFor(text).kind;
    code.replaceChildren(...highlightLines(kind, text.split('\n')));
  }
}

/**
 * A task's body, rendered (TASK-05, D-49): markdown with its line breaks (D-76), highlighted code,
 * images from the Flint folder. A click on a link opens it in the browser; a click anywhere else
 * starts editing.
 */
function BodyView(props: { readonly body: string; readonly onEdit: () => void }): ReactElement {
  const { body, onEdit } = props;
  const box = useRef<HTMLDivElement>(null);
  const html = useMemo(() => bodyHtml(body), [body]);
  useLayoutEffect(() => {
    if (box.current) highlightCode(box.current);
  }, [html]);
  return (
    <div
      ref={box}
      className="body-view"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (link) {
          event.preventDefault();
          window.flintMain.openLink(link.href);
          return;
        }
        // Selecting text in the body doesn't start editing.
        if (window.getSelection()?.isCollapsed !== false) onEdit();
      }}
    />
  );
}

/**
 * A body in its plain field until the note editor (D-49, M5), in the rendered text's place, padding
 * and type, so starting to edit moves nothing (D-76). Esc or leaving the field saves; Enter is a new
 * line. JSON, code and stack traces pasted into it are fenced, as in the capture popup (CAP-06).
 */
function BodyEditor(props: {
  readonly initial: string;
  readonly placeholder?: string;
  readonly onDone: (body: string) => void;
}): ReactElement {
  const { initial, placeholder, onDone } = props;
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const leave = (): void => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <textarea
      className="body-editor"
      aria-label="Body"
      autoFocus
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text/plain');
        const kind = classifyPaste(text);
        if (kind === 'text') return;
        event.preventDefault();
        const field = event.currentTarget;
        const before = field.value.slice(0, field.selectionStart);
        const after = field.value.slice(field.selectionEnd);
        // The fence stands on its own lines.
        const lead =
          before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        const trail = after === '' || after.startsWith('\n') ? '' : '\n';
        const block = fencedBlock(blockFor(text).text, kind === 'json' ? 'json' : '');
        field.setRangeText(lead + block + trail, field.selectionStart, field.selectionEnd, 'end');
        setValue(field.value);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={leave}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        leave();
      }}
    />
  );
}

/**
 * A task's body in its place (TASK-05, D-49, D-76): rendered, or in its plain field while edited.
 * Inline under a row it sits in a subtle well, and a body longer than about eight lines shows only
 * its top lines, fading out, with "Open as page"; on the task's page it shows in full.
 */
export function BodyBlock(props: {
  readonly body: string;
  readonly inline: boolean;
  readonly editing: boolean;
  readonly editable: boolean;
  readonly onEdit: () => void;
  readonly onDone: (body: string) => void;
  readonly onOpenPage?: () => void;
  readonly placeholder?: string;
}): ReactElement {
  const { body, inline, editing, editable, onEdit, onDone, onOpenPage, placeholder } = props;
  const clip = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const box = clip.current;
    if (!inline || editing || !box) {
      setLong(false);
      return;
    }
    // Images loading change the height: measured again whenever the content resizes.
    const measure = (): void => setLong(box.scrollHeight > box.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [body, inline, editing]);
  const classes = ['body-block', inline ? 'inline' : 'full'];
  if (editing) classes.push('editing');
  if (long) classes.push('long');
  return (
    <div className={classes.join(' ')}>
      {editing ? (
        <BodyEditor initial={body} onDone={onDone} {...(placeholder ? { placeholder } : {})} />
      ) : (
        <div className="body-clip" ref={clip}>
          <BodyView body={body} onEdit={() => editable && onEdit()} />
        </div>
      )}
      {long && onOpenPage && (
        <button type="button" className="body-open-page" onClick={onOpenPage}>
          Open as page
        </button>
      )}
    </div>
  );
}
