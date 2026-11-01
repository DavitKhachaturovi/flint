import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { blockFor, type BlockKind } from '@flint/core/shorthand';
import { bodyHtml } from '../../shared/body-markdown.js';
import { highlightLines } from '../highlight/highlight.js';

/** D-53: a body up to about this many rendered lines opens inline; a larger one as a page. */
const INLINE_LINES = 8;

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
 * Whether a body fits inline (D-53): its rendered height, images included, measured in `column`
 * against about eight lines of body text.
 */
export async function bodyFits(body: string, column: HTMLElement): Promise<boolean> {
  const probe = document.createElement('div');
  probe.className = 'body-view body-probe';
  probe.innerHTML = bodyHtml(body);
  highlightCode(probe);
  column.append(probe);
  try {
    await Promise.all(
      [...probe.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)),
    );
    const line = parseFloat(getComputedStyle(probe).lineHeight) || 24;
    return probe.getBoundingClientRect().height <= line * INLINE_LINES + 1;
  } finally {
    probe.remove();
  }
}

/**
 * A task's body, rendered (TASK-05, D-49): markdown, highlighted code, images from the Flint
 * folder. A click on a link opens it in the browser; a click anywhere else starts editing.
 */
export function BodyView(props: {
  readonly body: string;
  readonly onEdit: () => void;
}): ReactElement {
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
 * A body in its plain monospace field until the note editor (D-49, M5). Esc or leaving the field
 * saves what was typed; Enter is a new line.
 */
export function BodyEditor(props: {
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
